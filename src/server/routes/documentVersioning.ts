// Praeventio Guard — Sprint 41 F.23 HTTP surface.
//
// 5 endpoints:
//   GET  /:projectId/documents/:documentId/chain
//   GET  /:projectId/documents/:documentId/active     → current active version
//   POST /:projectId/documents/:documentId/versions   → bump + draft new version
//   POST /:projectId/documents/:documentId/versions/:versionId/status
//   GET  /:projectId/documents/:documentId/changelog
//
// The engine in `services/documents/documentVersioning.ts` does:
//   - semver bump + DRAFT_PENDING guard via buildNextVersion()
//   - chain validation
//   - diff + changelog
//
// This router wraps it with Firestore persistence + project-member guard.

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
  buildChangelog,
  buildNextVersion,
  pickActiveVersion,
  pickLatestVersion,
  VersionImmutabilityError,
} from '../../services/documents/documentVersioning.js';
import {
  DocumentVersioningAdapter,
  DocumentVersionImmutabilityViolation,
} from '../../services/documents/documentVersioningFirestoreAdapter.js';

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

router.get(
  '/:projectId/documents/:documentId/chain',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, documentId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new DocumentVersioningAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const chain = await adapter.getChain(documentId);
      return res.json({ chain });
    } catch (err) {
      logger.error?.('documentVersioning.chain.error', err);
      captureRouteError(err, 'documentVersioning.chain');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/:projectId/documents/:documentId/active',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, documentId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new DocumentVersioningAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const chain = await adapter.getChain(documentId);
      if (!chain) return res.json({ active: null, latest: null });
      const active = pickActiveVersion(chain);
      const latest = pickLatestVersion(chain);
      return res.json({ active, latest });
    } catch (err) {
      logger.error?.('documentVersioning.active.error', err);
      captureRouteError(err, 'documentVersioning.active');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const createVersionSchema = z.object({
  newContent: z.string().min(1).max(200000),
  newContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  bumpKind: z.enum(['patch', 'minor', 'major']),
  changeNotes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/documents/:documentId/versions',
  verifyAuth,
  validate(createVersionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, documentId } = req.params;
    const body = req.body as z.infer<typeof createVersionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new DocumentVersioningAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const existing = (await adapter.getChain(documentId)) ?? {
        documentId,
        versions: [],
      };
      const next = buildNextVersion({
        chain: existing,
        newContent: body.newContent,
        newContentHash: body.newContentHash,
        authorUid: callerUid,
        bumpKind: body.bumpKind,
        changeNotes: body.changeNotes,
      });
      await adapter.saveNewVersion(next);
      // CLAUDE.md #3: persisting a new document version is a state-changing write.
      await auditServerEvent(
        req,
        'documentVersioning.createVersion',
        'documentVersioning',
        {
          projectId,
          documentId,
          versionId: next.versionId,
          bumpKind: body.bumpKind,
        },
        { projectId },
      );
      return res.status(201).json({ version: next });
    } catch (err) {
      if (err instanceof VersionImmutabilityError) {
        return res.status(409).json({
          error: 'version_immutability',
          code: err.message,
        });
      }
      if (err instanceof DocumentVersionImmutabilityViolation) {
        return res
          .status(409)
          .json({ error: 'version_already_exists', versionId: err.versionId });
      }
      logger.error?.('documentVersioning.create.error', err);
      captureRouteError(err, 'documentVersioning.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const statusTransitionSchema = z.object({
  status: z.enum(['draft', 'in_review', 'approved', 'superseded', 'retired']),
  approverUid: z.string().min(1).optional(),
  /**
   * When status === 'superseded', also set the supersededByVersionId on
   * the previous version atomically. The route mirrors this with an
   * adapter call.
   */
  supersededByVersionId: z.string().optional(),
});

router.post(
  '/:projectId/documents/:documentId/versions/:versionId/status',
  verifyAuth,
  validate(statusTransitionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, documentId, versionId } = req.params;
    const body = req.body as z.infer<typeof statusTransitionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new DocumentVersioningAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      // Caller's uid wins over body approverUid — defensive against
      // client tampering. The 'approved' transition records who approved.
      const approverUid =
        body.status === 'approved' ? callerUid : body.approverUid;
      await adapter.setStatus(documentId, versionId, body.status, approverUid);
      if (body.status === 'superseded' && body.supersededByVersionId) {
        await adapter.supersedeVersion(
          documentId,
          versionId,
          body.supersededByVersionId,
        );
      }
      // CLAUDE.md #3: a version status transition (approve/supersede/retire/…)
      // is a state-changing compliance write and must be audited.
      await auditServerEvent(
        req,
        'documentVersioning.setStatus',
        'documentVersioning',
        {
          projectId,
          documentId,
          versionId,
          status: body.status,
          ...(approverUid ? { approverUid } : {}),
          ...(body.supersededByVersionId
            ? { supersededByVersionId: body.supersededByVersionId }
            : {}),
        },
        { projectId },
      );
      return res.status(204).end();
    } catch (err) {
      if (err instanceof DocumentVersionImmutabilityViolation) {
        return res
          .status(409)
          .json({ error: 'immutability', detail: err.message });
      }
      logger.error?.('documentVersioning.setStatus.error', err);
      captureRouteError(err, 'documentVersioning.setStatus');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/:projectId/documents/:documentId/changelog',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, documentId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new DocumentVersioningAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const chain = await adapter.getChain(documentId);
      if (!chain) return res.json({ changelog: [] });
      return res.json({ changelog: buildChangelog(chain) });
    } catch (err) {
      logger.error?.('documentVersioning.changelog.error', err);
      captureRouteError(err, 'documentVersioning.changelog');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
