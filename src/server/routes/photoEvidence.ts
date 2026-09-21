// Praeventio Guard — Fase F.19 Photo Evidence HTTP endpoints.
//
// 3 endpoints:
//   POST /:projectId/photo-evidence                           → record metadata
//   GET  /:projectId/photo-evidence/by-node/:kind/:id         → list for parent
//   POST /:projectId/photo-evidence/:artifactId/linkage       → append linkage
//
// Bytes upload separately to Cloud Storage at the path returned by
// `buildStoragePath()`. This router only persists metadata + linkages so the
// graph (incidents, inspections, audits) can render evidence cards without
// re-hashing payloads on every request.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  isAdminRole,
  isSupervisorRole,
} from '../../types/roles.js';
import {
  buildArtifact,
  PhotoEvidenceValidationError,
  EvidenceArtifactNotFoundError,
  type LinkedNodeKind,
} from '../../services/photoEvidence/photoEvidenceEngine.js';
import { PhotoEvidenceAdapter, type PhotoEvidenceFirestoreDb } from '../../services/photoEvidence/photoEvidenceFirestoreAdapter.js';

const router = Router();

async function resolveTenantId(
  _callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

const LINKED_NODE_KINDS = [
  'incident',
  'inspection',
  'audit',
  'finding',
  'work_permit',
  'training_session',
  'corrective_action',
] as const;

const linkageSchema = z.object({
  nodeKind: z.enum(LINKED_NODE_KINDS),
  nodeId: z.string().min(1).max(120),
});

const recordSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  payload: z.object({
    originalFilename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(60),
    byteSize: z.number().int().nonnegative(),
    capturedAt: z.string().min(10),
    capturedLocation: z
      .object({ lat: z.number(), lng: z.number() })
      .optional(),
    capturedByUid: z.string().min(1).optional(),
    notes: z.string().max(2000).optional(),
  }),
  linkages: z.array(linkageSchema).min(1).max(10),
});

router.post(
  '/:projectId/photo-evidence',
  verifyAuth,
  validate(recordSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recordSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    try {
      // Caller uid wins over body uid — defensive against client tampering.
      const payload = {
        ...body.payload,
        capturedByUid: callerUid,
      };
      const artifact = buildArtifact({
        payload,
        contentHash: body.contentHash,
        linkages: body.linkages,
      });
      const adapter = new PhotoEvidenceAdapter(
        // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidenceAdapter —
        // merge read-then-set puede perder linkages concurrentes. The
        // adapter now uses `runTransaction` for atomic appendLinkage; the
        // Firestore Admin SDK exposes the full PhotoEvidenceFirestoreDb
        // surface (collection/doc/where/orderBy/limit/get/runTransaction).
        admin.firestore() as unknown as PhotoEvidenceFirestoreDb,
        g.tenantId,
        projectId,
      );
      // Also persist `linkageKeys` for the array-contains query path. The
      // engine doesn't know about Firestore indexes so we add it here at
      // the boundary.
      const linkageKeys = artifact.linkages.map(
        (l) => `${l.nodeKind}:${l.nodeId}`,
      );
      await adapter.save({
        ...artifact,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ linkageKeys } as any),
      });
      await auditServerEvent(
        req,
        'photoEvidence.record',
        'photoEvidence',
        { artifactId: artifact.id, linkageKeys },
        { projectId },
      );
      return res.status(201).json({ artifact });
    } catch (err) {
      if (err instanceof PhotoEvidenceValidationError) {
        return res.status(422).json({
          error: 'invalid_payload',
          code: err.code,
          detail: err.message,
        });
      }
      logger.error?.('photoEvidence.record.error', err);
      captureRouteError(err, 'photoEvidence.record');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/:projectId/photo-evidence/by-node/:kind/:id',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, kind, id } = req.params;
    if (!LINKED_NODE_KINDS.includes(kind as LinkedNodeKind)) {
      return res.status(400).json({ error: 'invalid_node_kind' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // [Audit-2026-08-31] Supervisor-only gate — firestore.rules:2535-2538 only
    // grants `read` of `photo_evidence/{contentHash}` to isSupervisorOfTenant.
    // Because this route uses Admin SDK directly, the rule does NOT apply;
    // we replicate the supervisor-only check here. Project membership alone
    // is insufficient: a worker could otherwise enumerate photo evidence
    // for any node, which IncidentBundle.tsx exposes in its feed.
    const callerRole = (req.user as { role?: string } | undefined)?.role ?? null;
    if (!isSupervisorRole(callerRole) && !isAdminRole(callerRole)) {
      return res.status(403).json({ error: 'supervisor_only' });
    }
    try {
      const adapter = new PhotoEvidenceAdapter(
        // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidenceAdapter —
        // merge read-then-set puede perder linkages concurrentes. The
        // adapter now uses `runTransaction` for atomic appendLinkage; the
        // Firestore Admin SDK exposes the full PhotoEvidenceFirestoreDb
        // surface (collection/doc/where/orderBy/limit/get/runTransaction).
        admin.firestore() as unknown as PhotoEvidenceFirestoreDb,
        g.tenantId,
        projectId,
      );
      const artifacts = await adapter.listForNode(kind as LinkedNodeKind, id);
      return res.json({ artifacts });
    } catch (err) {
      logger.error?.('photoEvidence.listByNode.error', err);
      captureRouteError(err, 'photoEvidence.listByNode');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/photo-evidence/:artifactId/linkage',
  verifyAuth,
  validate(linkageSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, artifactId } = req.params;
    const link = req.body as z.infer<typeof linkageSchema>;
    if (!/^[a-f0-9]{64}$/i.test(artifactId)) {
      return res.status(400).json({ error: 'invalid_artifact_id' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new PhotoEvidenceAdapter(
        // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidenceAdapter —
        // merge read-then-set puede perder linkages concurrentes. The
        // adapter now uses `runTransaction` for atomic appendLinkage; the
        // Firestore Admin SDK exposes the full PhotoEvidenceFirestoreDb
        // surface (collection/doc/where/orderBy/limit/get/runTransaction).
        admin.firestore() as unknown as PhotoEvidenceFirestoreDb,
        g.tenantId,
        projectId,
      );
      await adapter.appendLinkage(artifactId, link);
      await auditServerEvent(
        req,
        'photoEvidence.appendLinkage',
        'photoEvidence',
        { artifactId, nodeKind: link.nodeKind, nodeId: link.nodeId },
        { projectId },
      );
      return res.status(204).end();
    } catch (err) {
      // [Hy3-audit] Resolves [Audit-2026-08-31] PhotoEvidence linkage —
      // artifact inexistente devuelve 204. The adapter now throws
      // EvidenceArtifactNotFoundError when the artifact does not
      // exist; we map it to HTTP 404 so the client gets a real signal
      // instead of a misleading 204.
      if (err instanceof EvidenceArtifactNotFoundError) {
        return res.status(404).json({ error: 'artifact_not_found' });
      }
      logger.error?.('photoEvidence.appendLinkage.error', err);
      captureRouteError(err, 'photoEvidence.appendLinkage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
