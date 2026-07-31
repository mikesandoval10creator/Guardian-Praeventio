// Praeventio Guard — Auditoría Express Bundle (PDF index) HTTP surface.
//
// P0 (ticket 39baa66d-73fe-81ac-a2f3-fdb273b54a08): the legacy contract
// accepted documents, iperMatrix, trainings, eppAssignments, activeWorkers,
// applicableProtocols, photoEvidences, recentAuditLogs and
// complianceSnapshot in the request body — any project member could
// fabricate a green bundle with invented workers/RUT/capacitaciones/EPP/
// fotos/audit logs. The handler only overrode `generatedBy.uid` and
// `generatedAt`, trusting everything else.
//
// New contract: the request body is scoped to UI hints only.
//
//   POST /:projectId/express-bundle/build
//     body: {
//       projectName: string,
//       format?: 'json' | 'pdf' | 'zip' (default 'pdf'),
//       workerRut?: string (filter — only one worker when set)
//     }
//     200: { manifest: { generatedAt, complianceSnapshot, summary, indexPdfBase64 } }
//
// The server rebuilds the entire bundle from Firestore (and Storage for
// photoEvidences) scoped to the URL :projectId. The caller MUST be a
// project member (`assertProjectMember`). The callerUid replaces
// `generatedBy.uid`; the server clock stamps `generatedAt`. Any attempt
// to inject client-side evidence via `data`, `documents`, `trainings`,
// etc. is rejected by Zod (strict object) and never reaches the builder.
//
// Pure-compute builder is unchanged (`src/services/audit/expressBundleBuilder.ts`):
// it still receives a fully-populated `ExpressBundleInput` and is responsible
// only for the summary computation and the index PDF.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  buildExpressBundleManifest,
  type ExpressBundleInput,
  type BundleDoc,
  type BundleIper,
  type BundleTraining,
  type BundleEpp,
  type BundleWorker,
  type BundlePhoto,
  type BundleAuditLog,
} from '../../services/audit/expressBundleBuilder.js';
import type {
  ComplianceTrafficLightResult,
} from '../../services/compliance/trafficLightEngine.js';
import type { LegalRequirement } from '../../services/legal/legalRuleEngine.js';

const router = Router();

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

// P0 (39baa66d-73fe-81ac): the body is UI hints only. The server is the
// SOLE source of bundle evidence. `data` / `documents` / `trainings` /
// `iperMatrix` / etc. are deliberately not in this schema — Zod's
// `.strict()` (via passing additional fields would 400 the request).
// Since the schema only allows the three keys below, any attempt to
// inject evidence via the legacy `data` block is rejected at the gate.
const BUNDLE_FORMATS = ['json', 'pdf', 'zip'] as const;
const buildSchema = z
  .object({
    projectName: z.string().min(1).max(500),
    format: z.enum(BUNDLE_FORMATS).optional(),
    workerRut: z.string().min(1).max(50).optional(),
  })
  .strict();

// ─── Server-side reconstruction ───────────────────────────────────────
// Read every input from Firestore scoped to :projectId. The caller cannot
// influence any field. The optional `workerRut` filter narrows the
// `activeWorkers` slice but does not change any other count.

interface FirestoreBundleData {
  documents: BundleDoc[];
  iperMatrix: BundleIper[];
  trainings: BundleTraining[];
  eppAssignments: BundleEpp[];
  activeWorkers: BundleWorker[];
  applicableProtocols: LegalRequirement[];
  photoEvidences: BundlePhoto[];
  recentAuditLogs: BundleAuditLog[];
  complianceSnapshot: ComplianceTrafficLightResult;
}

async function reconstructFromFirestore(
  db: admin.firestore.Firestore,
  projectId: string,
  options: { workerRut?: string },
): Promise<FirestoreBundleData> {
  const projectBase = `projects/${projectId}`;

  // Documents — top-level collection `projects/{pid}/documents/{did}`.
  const docsSnap = await db.collection(`${projectBase}/documents`).get().catch((err) => {
    logger.warn?.('expressBundle.docs.fetch_failed', err);
    return null;
  });
  const documents = (docsSnap?.docs ?? [])
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const status = String(data.status ?? '');
      if (status !== 'vigente' && status !== 'vencido' && status !== 'pendiente_firma') {
        return null;
      }
      return {
        id: d.id,
        type: String(data.type ?? ''),
        title: String(data.title ?? ''),
        status: status as 'vigente' | 'vencido' | 'pendiente_firma',
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  // IPER matrix — top-level collection `projects/{pid}/iper/{id}`.
  const iperSnap = await db.collection(`${projectBase}/iper`).get().catch((err) => {
    logger.warn?.('expressBundle.iper.fetch_failed', err);
    return null;
  });
  const iperMatrix = (iperSnap?.docs ?? [])
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const severity = String(data.severity ?? '');
      if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
        return null;
      }
      return {
        id: d.id,
        risk: String(data.risk ?? ''),
        severity: severity as 'low' | 'medium' | 'high' | 'critical',
        mitigation: typeof data.mitigation === 'string' ? data.mitigation : undefined,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  // Trainings — top-level collection `projects/{pid}/trainings/{id}`.
  const trainingsSnap = await db.collection(`${projectBase}/trainings`).get().catch((err) => {
    logger.warn?.('expressBundle.trainings.fetch_failed', err);
    return null;
  });
  const trainings = (trainingsSnap?.docs ?? [])
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const status = String(data.status ?? '');
      if (status !== 'vigente' && status !== 'vencido') {
        return null;
      }
      const workerRut = String(data.workerRut ?? '');
      if (options.workerRut && workerRut !== options.workerRut) {
        return null;
      }
      return {
        id: d.id,
        course: String(data.course ?? ''),
        workerName: String(data.workerName ?? ''),
        workerRut,
        validUntil: typeof data.validUntil === 'string' ? data.validUntil : undefined,
        status: status as 'vigente' | 'vencido',
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  // EPP assignments — top-level collection `projects/{pid}/epp/{id}`.
  const eppSnap = await db.collection(`${projectBase}/epp`).get().catch((err) => {
    logger.warn?.('expressBundle.epp.fetch_failed', err);
    return null;
  });
  const eppAssignments = (eppSnap?.docs ?? [])
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const workerRut = String(data.workerRut ?? '');
      if (options.workerRut && workerRut !== options.workerRut) {
        return null;
      }
      const items = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
            .map((it) => {
              if (typeof it?.label !== 'string' || typeof it?.receivedAt !== 'string') {
                return null;
              }
              return {
                label: it.label,
                receivedAt: it.receivedAt,
                expiresAt: typeof it.expiresAt === 'string' ? it.expiresAt : undefined,
              };
            })
            .filter((it): it is NonNullable<typeof it> => it !== null)
        : [];
      return {
        workerName: String(data.workerName ?? ''),
        workerRut,
        items,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  // Active workers — top-level collection `projects/{pid}/workers/{uid}`.
  const workersSnap = await db.collection(`${projectBase}/workers`).get().catch((err) => {
    logger.warn?.('expressBundle.workers.fetch_failed', err);
    return null;
  });
  const activeWorkers = (workersSnap?.docs ?? [])
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const rut = String(data.rut ?? '');
      if (options.workerRut && rut !== options.workerRut) {
        return null;
      }
      return {
        uid: d.id,
        fullName: String(data.fullName ?? ''),
        rut,
        role: String(data.role ?? ''),
        startDate: typeof data.startDate === 'string' ? data.startDate : undefined,
      };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null);

  // Legal requirements — top-level collection `projects/{pid}/legal/requirements/{id}`.
  const legalSnap = await db.collection(`${projectBase}/legal/requirements`).get().catch((err) => {
    logger.warn?.('expressBundle.legal.fetch_failed', err);
    return null;
  });
  const applicableProtocols: FirestoreBundleData['applicableProtocols'] = (
    legalSnap?.docs ?? []
  )
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const category = String(data.category ?? '');
      const urgency = String(data.urgency ?? '');
      if (
        !['committee', 'training', 'process', 'document', 'medical', 'epp'].includes(category) ||
        !['critical', 'recommended'].includes(urgency)
      ) {
        return null;
      }
      return {
        ruleId: d.id,
        category: category as 'committee' | 'training' | 'process' | 'document' | 'medical' | 'epp',
        recommendation: String(data.recommendation ?? ''),
        legalCitation: String(data.legalCitation ?? ''),
        urgency: urgency as 'critical' | 'recommended',
        suggestedDeadline: typeof data.suggestedDeadline === 'string' ? data.suggestedDeadline : undefined,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // Photo evidences — `projects/{pid}/photo_evidences/{id}` with `storagePath`.
  // The full download URL is resolved by the (future) signed-URL server
  // endpoint; here we surface the storagePath + a stable `storageUrl`
  // placeholder the caller resolves via that endpoint.
  const photosSnap = await db.collection(`${projectBase}/photo_evidences`).get().catch((err) => {
    logger.warn?.('expressBundle.photos.fetch_failed', err);
    return null;
  });
  const photoEvidences = (photosSnap?.docs ?? [])
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        caption: String(data.caption ?? ''),
        storageUrl: String(data.storagePath ?? ''),
        takenAt: String(data.takenAt ?? ''),
      };
    })
    .filter((p): p is NonNullable<typeof p> => p.storageUrl.length > 0);

  // Recent audit logs — `projects/{pid}/audit/{docId}` where docId is the timestamp.
  const auditSnap = await db.collection(`${projectBase}/audit`).get().catch((err) => {
    logger.warn?.('expressBundle.audit.fetch_failed', err);
    return null;
  });
  const recentAuditLogs = (auditSnap?.docs ?? [])
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        action: String(data.action ?? ''),
        timestamp: String(data.timestamp ?? d.id),
        userId: (typeof data.userId === 'string' ? data.userId : null) as string | null,
        details: typeof data.details === 'object' && data.details !== null
          ? (data.details as Record<string, unknown>)
          : undefined,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a.action.length > 0);

  // Compliance snapshot — the project-level `compliance/{projectId}` doc
  // carries the latest traffic-light state. If the doc is missing the
  // field is rendered as a red "no data" snapshot so the bundle never
  // claims green without evidence.
  const complianceSnap = await db.doc(`${projectBase}/compliance`).get().catch((err) => {
    logger.warn?.('expressBundle.compliance.fetch_failed', err);
    return null;
  });
  const complianceData = (complianceSnap?.data() ?? {}) as Record<string, unknown>;
  const overall = String(complianceData.overall ?? 'red');
  const scoreNum = Number(complianceData.score ?? 0);
  const byCategory = Array.isArray(complianceData.byCategory)
    ? (complianceData.byCategory as Array<Record<string, unknown>>).map((c) => {
        const cat = String(c.category ?? '');
        const light = String(c.light ?? 'red');
        return {
          category: cat as ComplianceTrafficLightResult['byCategory'][number]['category'],
          light: (light === 'green' || light === 'yellow' || light === 'red'
            ? light
            : 'red') as ComplianceTrafficLightResult['byCategory'][number]['light'],
          summary: String(c.summary ?? ''),
          criticalItemIds: Array.isArray(c.criticalItemIds)
            ? (c.criticalItemIds as unknown[]).map((id) => String(id))
            : [],
          warningCount: Number(c.warningCount ?? 0),
        };
      })
    : [];
  const complianceSnapshot: ComplianceTrafficLightResult = {
    overall: overall === 'green' || overall === 'yellow' || overall === 'red' ? overall : 'red',
    byCategory,
    score: Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, scoreNum)) : 0,
    computedAt: new Date().toISOString(),
  };

  return {
    documents,
    iperMatrix,
    trainings,
    eppAssignments,
    activeWorkers,
    applicableProtocols,
    photoEvidences,
    recentAuditLogs,
    complianceSnapshot,
  };
}

router.post(
  '/:projectId/express-bundle/build',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const data = await reconstructFromFirestore(db, projectId, {
        workerRut: body.workerRut,
      });
      const input: ExpressBundleInput = {
        projectId,
        projectName: body.projectName,
        generatedBy: {
          // P0: uid is the verified caller. fullName/role come from
          // a server-side lookup of the caller's profile (Firestore
          // `users/{uid}`), not from the body. Until that lookup exists
          // the role default is 'Usuario' — the bundle never claims a
          // fabricated role.
          uid: callerUid,
          fullName: callerUid, // placeholder until users/{uid}.fullName lookup
          role: 'Usuario',
        },
        generatedAt: new Date(),
        data,
      };
      const manifest = await buildExpressBundleManifest(input);
      return res.json({
        manifest: {
          generatedAt: manifest.generatedAt,
          complianceSnapshot: manifest.complianceSnapshot,
          summary: manifest.summary,
          indexPdfBase64: manifest.indexPdf.toString('base64'),
        },
      });
    } catch (err) {
      logger.error?.('expressBundle.build.error', err);
      captureRouteError(err, 'expressBundle.build');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
