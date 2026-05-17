// Praeventio Guard â€” Sprint K endpoints bridge.
//
// Endpoints HTTP que exponen los servicios Sprint L/K al frontend.
// PatrÃ³n consistente con insights.ts: verifyAuth + projectMember +
// adapter por demand.
//
//   GET  /api/sprint-k/:projectId/vulnerability/latest
//   GET  /api/sprint-k/:projectId/sif/pending-review
//   POST /api/sprint-k/:projectId/sif/:id/executive-review
//   GET  /api/sprint-k/:projectId/positive-observations/worker/:workerUid
//   POST /api/sprint-k/:projectId/positive-observations
//   GET  /api/sprint-k/:projectId/waste/inventory
//   GET  /api/sprint-k/:projectId/visitors/active
//
// Cada handler reusa los adapters ya construidos.

import { createHash } from 'node:crypto';
import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { VulnerabilityAdapter } from '../../services/vulnerability/vulnerabilityFirestoreAdapter.js';
import { SIFAdapter } from '../../services/sif/sifFirestoreAdapter.js';
import { PositiveObservationsAdapter } from '../../services/positiveObservations/positiveObservationsFirestoreAdapter.js';
import { WasteAdapter } from '../../services/environmental/wasteFirestoreAdapter.js';
import { VisitorAdapter } from '../../services/visitors/visitorFirestoreAdapter.js';
import { LessonsAdapter } from '../../services/lessonsLearned/lessonsFirestoreAdapter.js';
import { CorrectiveActionsAdapter } from '../../services/correctiveActions/correctiveActionsFirestoreAdapter.js';
import { LotoAdapter } from '../../services/loto/lotoFirestoreAdapter.js';
import { EquipmentAdapter } from '../../services/equipment/equipmentFirestoreAdapter.js';
import {
  WorkPermitAdapter,
  WorkPermitDuplicateError,
} from '../../services/workPermits/workPermitFirestoreAdapter.js';
import {
  createPendingPermit,
  attestAndIssuePermit,
  cancelPermit,
  fulfillPermit,
  deriveStatus,
  WorkPermitValidationError,
  type WorkPermit,
  type WorkPermitKind,
  type WorkPermitStatus,
} from '../../services/workPermits/workPermitEngine.js';
import {
  rankSuppliersByScore,
  scoreSupplier,
  type SupplierKpis,
  type SupplierRecord,
  type ScoredSupplier,
} from '../../services/suppliers/supplierScoring.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';

const router = Router();

/**
 * Codex P2 PR #317: utilidad compartida para coercer scores que vienen
 * de Firestore a un entero 0-100. Cualquier valor fuera de rango se
 * "clampa" — el motor F.2 garantiza esto pero datos legacy pueden
 * haberse guardado con floats o valores >100 (ej. proyectos migrados
 * desde la métrica antigua).
 */
function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const claims = (await admin.auth().getUser(callerUid)).customClaims ?? {};
  if (typeof claims.tenantId === 'string' && claims.tenantId.length > 0) {
    return claims.tenantId;
  }
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Vulnerability map
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/vulnerability/latest', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new VulnerabilityAdapter(admin.firestore() as any, g.tenantId, projectId);
    const latest = await adapter.getLatest();
    return res.json({ snapshot: latest });
  } catch (err) {
    logger.error?.('sprintK.vulnerability.latest.error', err);
    captureRouteError(err, 'sprintK.vulnerability.latest');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SIF precursors
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/sif/pending-review', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new SIFAdapter(admin.firestore() as any, g.tenantId, projectId);
    const pending = await adapter.listPendingExecutiveReview();
    return res.json({ precursors: pending });
  } catch (err) {
    logger.error?.('sprintK.sif.pending.error', err);
    captureRouteError(err, 'sprintK.sif.pending');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const sifReviewSchema = z.object({
  reviewedByUid: z.string().min(1),
  reviewedAt: z.string().min(10),
  reviewNotes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/sif/:id/executive-review',
  verifyAuth,
  validate(sifReviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof sifReviewSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new SIFAdapter(admin.firestore() as any, g.tenantId, projectId);
      await adapter.recordExecutiveReview(
        id,
        body.reviewedByUid,
        body.reviewedAt,
        body.reviewNotes,
      );
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.sif.review.error', err);
      captureRouteError(err, 'sprintK.sif.review');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Positive observations
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get(
  '/:projectId/positive-observations/worker/:workerUid',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, workerUid } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new PositiveObservationsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const list = await adapter.listForWorker(workerUid);
      return res.json({ observations: list });
    } catch (err) {
      logger.error?.('sprintK.positive.error', err);
      captureRouteError(err, 'sprintK.positive.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const positiveObsSchema = z.object({
  id: z.string().min(1),
  observedWorkerUid: z.string().min(1),
  kind: z.enum([
    'safe_behavior',
    'improvement_idea',
    'helpful_intervention',
    'creative_workaround',
    'mentoring_action',
  ]),
  description: z.string().min(5).max(2000),
  observedAt: z.string().min(10),
  location: z.string().min(1).max(200),
  shared: z.boolean().optional(),
});

router.post(
  '/:projectId/positive-observations',
  verifyAuth,
  validate(positiveObsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerRole = req.user!.role ?? 'worker';
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof positiveObsSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new PositiveObservationsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      await adapter.save({
        ...body,
        observerUid: callerUid,
        observerRole: callerRole,
        shared: body.shared ?? false,
      });
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('sprintK.positive.create.error', err);
      captureRouteError(err, 'sprintK.positive.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Waste inventory
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/waste/inventory', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new WasteAdapter(admin.firestore() as any, g.tenantId, projectId);
    const [stock, pendingManifests, permits] = await Promise.all([
      adapter.listInStock(),
      adapter.listManifestsPendingReception(),
      adapter.listPermits(),
    ]);
    return res.json({ wastes: stock, pendingManifests, permits });
  } catch (err) {
    logger.error?.('sprintK.waste.error', err);
    captureRouteError(err, 'sprintK.waste');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Visitors
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/visitors/active', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new VisitorAdapter(admin.firestore() as any, g.tenantId, projectId);
    const list = await adapter.listActive();
    return res.json({ visitors: list });
  } catch (err) {
    logger.error?.('sprintK.visitors.error', err);
    captureRouteError(err, 'sprintK.visitors');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Lessons learned (tenant-scoped, but still gated by project membership)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/lessons', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new LessonsAdapter(admin.firestore() as any, g.tenantId);
    const scope = typeof req.query.scope === 'string' ? req.query.scope : null;
    const riskCategory =
      typeof req.query.riskCategory === 'string' ? req.query.riskCategory : null;
    let lessons;
    if (riskCategory) {
      lessons = await adapter.listByRiskCategory(riskCategory);
    } else if (
      scope === 'global' ||
      scope === 'industry' ||
      scope === 'project' ||
      scope === 'crew'
    ) {
      lessons = await adapter.listByScope(scope);
    } else {
      lessons = await adapter.listTopAdopted();
    }
    return res.json({ lessons });
  } catch (err) {
    logger.error?.('sprintK.lessons.list.error', err);
    captureRouteError(err, 'sprintK.lessons.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const lessonSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(3).max(2000),
  preventiveAction: z.string().min(3).max(2000),
  riskCategories: z.array(z.string().min(1)).max(50),
  tags: z.array(z.string().min(1)).max(50),
  scope: z.enum(['global', 'industry', 'project', 'crew']),
  industry: z.string().min(1).max(200).optional(),
  derivedFromIncidentId: z.string().min(1).optional(),
  publishedAt: z.string().min(10),
  adoptionCount: z.number().int().nonnegative(),
});

router.post(
  '/:projectId/lessons',
  verifyAuth,
  validate(lessonSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof lessonSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new LessonsAdapter(admin.firestore() as any, g.tenantId);
      await adapter.save(body);
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('sprintK.lessons.create.error', err);
      captureRouteError(err, 'sprintK.lessons.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Corrective actions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/corrective-actions', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new CorrectiveActionsAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    // Codex P2 round 3 (PR #309): accept the full F.4 status set so
    // the page's "En curso" and "Reabiertas" filters can actually
    // fetch records. The adapter signature was widened in tandem.
    const status =
      typeof req.query.status === 'string' ? req.query.status : 'open';
    type AnyStatus =
      | 'open'
      | 'in_progress'
      | 'closed'
      | 'verified'
      | 'reopened';
    const ALL_STATUSES: ReadonlySet<AnyStatus> = new Set([
      'open',
      'in_progress',
      'closed',
      'verified',
      'reopened',
    ]);
    const validStatus: AnyStatus = ALL_STATUSES.has(status as AnyStatus)
      ? (status as AnyStatus)
      : 'open';
    const [byStatus, systemic] = await Promise.all([
      adapter.listByStatus(validStatus),
      adapter.listSystemic(),
    ]);
    return res.json({ actions: byStatus, systemic });
  } catch (err) {
    logger.error?.('sprintK.correctiveActions.list.error', err);
    captureRouteError(err, 'sprintK.correctiveActions.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Codex P2 round 4 (PR #309): persist scheduled effectiveness review.
// Otherwise the F.4 "Programar review" CTA has no observable effect:
// page only logged, panel doesn't mutate, F.11 cron sees nothing.
const scheduleReviewSchema = z.object({
  actionId: z.string().min(1),
  reviewAt: z.string().min(10),
});

router.post(
  '/:projectId/corrective-actions/:actionId/effectiveness-review',
  verifyAuth,
  validate(scheduleReviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, actionId } = req.params;
    const body = req.body as z.infer<typeof scheduleReviewSchema>;
    if (body.actionId !== actionId) {
      return res.status(400).json({ error: 'actionId_mismatch' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new CorrectiveActionsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      // The legacy adapter doesn't have a `setEffectivenessReviewAt`
      // method — write directly. Path matches the adapter's PATH().
      await admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/corrective_actions`,
        )
        .doc(actionId)
        .set(
          {
            effectivenessReviewAt: body.reviewAt,
            effectivenessReviewScheduledBy: callerUid,
            effectivenessReviewScheduledAt: new Date().toISOString(),
          },
          { merge: true },
        );
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.correctiveActions.scheduleReview.error', err);
      captureRouteError(err, 'sprintK.correctiveActions.scheduleReview');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const correctiveActionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(3).max(4000),
  level: z
    .enum([
      'elimination',
      'engineering',
      'administrative',
      'training',
      'epp',
      'supervision',
      'communication',
    ])
    .optional(),
  status: z.enum(['open', 'closed', 'verified']),
  isSystemic: z.boolean(),
  sourceCause: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/corrective-actions',
  verifyAuth,
  validate(correctiveActionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof correctiveActionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new CorrectiveActionsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      await adapter.save(body);
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('sprintK.correctiveActions.create.error', err);
      captureRouteError(err, 'sprintK.correctiveActions.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LOTO digital
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/loto', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new LotoAdapter(admin.firestore() as any, g.tenantId, projectId);
    const equipmentId =
      typeof req.query.equipmentId === 'string' ? req.query.equipmentId : null;
    const applications = equipmentId
      ? await adapter.listForEquipment(equipmentId)
      : await adapter.listActive();
    return res.json({ applications });
  } catch (err) {
    logger.error?.('sprintK.loto.list.error', err);
    captureRouteError(err, 'sprintK.loto.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Equipment
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/equipment', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new EquipmentAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    const status =
      typeof req.query.status === 'string' ? req.query.status : 'operativo';
    const equipment = await adapter.listByStatus(status as any);
    return res.json({ equipment });
  } catch (err) {
    logger.error?.('sprintK.equipment.list.error', err);
    captureRouteError(err, 'sprintK.equipment.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Data Quality (Fase F.9) — pre-IA gap detector
// ─────────────────────────────────────────────────────────────────────
//
// Lee colecciones canónicas del proyecto (workers, projects, EPP
// assignments, documents, incidents, machines, trainings) y corre el
// scanner determinístico `scanAll()`. Devuelve un `DataQualityReport`
// con score 0-100 + breakdown por dominio + top gaps para el panel
// `<DataQualityCard>`.
//
// El scanner no requiere proyecto context — es puramente data-driven.
// Pero scopeamos los reads por projectId para que cada faena vea solo
// sus propios gaps.

router.get('/:projectId/data-quality', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { scanAll, pickTopGaps } = await import(
      '../../services/dataQuality/incompletenessScanner.js'
    );

    const db = admin.firestore();

    // Best-effort parallel reads. Each query wrapped so one failure
    // doesn't blank the whole report — the user sees partial data
    // and can still drill into the populated domains.
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.dataQuality.read.${label}.failed`, err);
        return [];
      }
    };

    // Codex P2 (PR #309): collection paths matched the UI writes.
    //
    // - workers       → nested `projects/{projectId}/workers`
    //                   (LaborManagementModal.tsx line 42)
    // - documents     → top-level `project_documents` filtered by projectId
    //                   (ProjectDocuments.tsx line 103)
    // - assets        → top-level `assets` filtered by projectId
    //                   (MaquinariaManager.tsx line 70)
    // - training      → top-level `training` filtered by projectId
    //                   (Training.tsx line 141)
    // - incidents     → top-level `incidents` filtered by projectId (idem)
    // - epp_assignments → nested fallback (no top-level writer found)
    //
    // Earlier this endpoint scanned everything under
    // `projects/{projectId}/...` which always returned empty arrays for
    // the three top-level collections — the data-quality card reported
    // a clean 100 even when the project had hundreds of documents/assets
    // with real gaps.
    const projectRef = db.collection('projects').doc(projectId);
    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const [
      workers,
      epps,
      documents,
      incidents,
      machines,
      trainings,
      thisProject,
    ] = await Promise.all([
      safeRead('workers', async () =>
        (await projectRef.collection('workers').get()).docs.map(
          (d) => ({ id: d.id, ...d.data() }),
        ),
      ),
      safeRead('epps', async () =>
        (await projectRef.collection('epp_assignments').get()).docs.map(
          (d) => ({ id: d.id, ...d.data() }),
        ),
      ),
      safeRead('documents', async () =>
        (await byProject('project_documents').get()).docs.map(
          (d) => ({ id: d.id, ...d.data() }),
        ),
      ),
      safeRead('incidents', async () => {
        // Codex P2 round 3 (PR #309): scanIncidents looks for
        // `description` and `rootCauseCategory`, but the existing
        // close flow (backgroundTriggers.ts:385) writes `rootCause`
        // as a STRING, and the bundle endpoint also reads `summary`
        // as a narrative alias. Normalize both at the boundary so
        // the scanner doesn't falsely flag missing fields when the
        // narrative/RCA actually exists.
        const snap = await byProject('incidents').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ...data,
            description: data.description ?? data.summary,
            // Accept any of: explicit category, string rootCause, or
            // object-shape rootCause.primaryCauseKind. Casts via
            // unknown because Firestore data is untyped.
            rootCauseCategory:
              data.rootCauseCategory ??
              (typeof data.rootCause === 'string'
                ? data.rootCause
                : (data.rootCause as { primaryCauseKind?: string } | undefined)?.primaryCauseKind),
          };
        });
      }),
      safeRead('machines', async () => {
        // Codex P2 round 2 (PR #309): MaquinariaManager.tsx writes
        // assets with `name` + `nextMaintenance`. The scanner
        // (`scanMachines`) checks `code` + `nextMaintenanceAt`. Without
        // normalization every asset shows as missing both fields and
        // the score collapses falsely. Map at the edge.
        const snap = await byProject('assets').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ...data,
            code: data.code ?? data.name,
            nextMaintenanceAt: data.nextMaintenanceAt ?? data.nextMaintenance,
          };
        });
      }),
      safeRead('trainings', async () => {
        // Codex P2 round 2 + 4 (PR #309): trainings live in THREE
        // sources:
        //   1. Top-level `training` collection (Training.tsx)
        //   2. Nested `projects/{id}/trainings` (TrainingRecommendations.tsx)
        //   3. Nested `projects/{id}/training_assignments` (the live
        //      collection that `runConsistencyAudit.ts` treats as active
        //      training data)
        // Union all three so the F.9 scanner sees every record. De-dupe
        // by id with first-wins precedence (top-level → nested →
        // assignments) since the same training can be referenced from
        // multiple paths.
        const [topSnap, nestedSnap, assignSnap] = await Promise.all([
          byProject('training').get(),
          projectRef.collection('trainings').get(),
          projectRef.collection('training_assignments').get(),
        ]);
        const map = new Map<string, Record<string, unknown>>();
        for (const d of topSnap.docs) {
          map.set(d.id, { id: d.id, ...d.data() });
        }
        for (const d of nestedSnap.docs) {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }
        for (const d of assignSnap.docs) {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }
        return Array.from(map.values());
      }),
      safeRead('project', async () => {
        const snap = await projectRef.get();
        return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      }),
    ]);

    const report = scanAll({
      workers: workers as any,
      projects: thisProject as any,
      eppAssignments: epps as any,
      documents: documents as any,
      incidents: incidents as any,
      machines: machines as any,
      trainings: trainings as any,
    });

    const topGaps = pickTopGaps(report, 10);

    return res.json({ report, topGaps });
  } catch (err) {
    logger.error?.('sprintK.dataQuality.error', err);
    captureRouteError(err, 'sprintK.dataQuality');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Incident evidence bundle (Fase F.3)
// ─────────────────────────────────────────────────────────────────────
//
// Construye el "expediente automático" de un incidente: cruza
// incidents, audit_logs y los registros vinculados para producir un
// `IncidentBundleManifest` con score de completitud + gaps detectados.
// El caller (fiscalizador, abogado, SUSESO) ve de un vistazo qué falta
// para cerrar el caso.
//
// Este endpoint deja explícito el contrato — los feeds más caros
// (evidencia foto/video, EPP/training del trabajador afectado,
// custody chain) viajan en sub-PRs siguientes. La versión actual
// popula incident + audit_log y deja arrays vacíos honestos para los
// demás, que el scorer entonces clasifica como gaps. Eso es
// honestidad arquitectónica: el panel muestra el bundle real con sus
// huecos reales, no un 100% falso.

router.get(
  '/:projectId/incidents/:incidentId/bundle',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { buildIncidentBundle, normalizeSeverity } = await import(
        '../../services/incidentBundle/incidentEvidenceBundle.js'
      );

      const db = admin.firestore();

      // 1. Incident itself. Stored top-level by IncidentReport.tsx,
      //    filtered by projectId.
      const incidentDoc = await db
        .collection('incidents')
        .doc(incidentId)
        .get();
      if (!incidentDoc.exists) {
        return res.status(404).json({ error: 'incident_not_found' });
      }
      const incidentData = incidentDoc.data() ?? {};
      // Cross-tenant safety: the docId is global; assert the incident
      // belongs to the project the caller can read.
      //
      // Codex P2 round 2 (PR #309): a legacy / partially-imported
      // incident may not carry a `projectId` field. The earlier check
      // `if (incidentData.projectId && ...)` short-circuited on the
      // missing field and let the caller see ANY tenant's incident
      // bundle. Tighten: require the field AND match it. Records
      // without projectId can't be authorized through this route.
      if (
        typeof incidentData.projectId !== 'string' ||
        incidentData.projectId !== projectId
      ) {
        return res.status(403).json({ error: 'cross_project_forbidden' });
      }

      // Codex P2 round 3 (PR #309): the legal evidence bundle must
      // never fabricate timestamps. Previously we fell back to
      // `new Date().toISOString()` when both `occurredAt` and
      // `createdAt` were missing — that silently invented a
      // "ocurred at right now" claim for a legacy incident, which
      // would be perjury in a SUSESO submission. Reject explicitly
      // and let the caller fix the upstream record.
      const occurredAt =
        typeof incidentData.occurredAt === 'string'
          ? incidentData.occurredAt
          : typeof incidentData.createdAt === 'string'
            ? incidentData.createdAt
            : null;
      if (!occurredAt) {
        return res.status(422).json({
          error: 'incident_missing_timestamp',
          detail:
            'El incidente no tiene `occurredAt` ni `createdAt`. Corregir el registro origen antes de construir el expediente.',
        });
      }
      const reportedAt =
        typeof incidentData.reportedAt === 'string'
          ? incidentData.reportedAt
          : occurredAt;

      const severity =
        normalizeSeverity(String(incidentData.severity ?? 'medium')) ?? 'medium';

      // 2. Audit log entries scoped to this incident AND project.
      //
      // Codex P2 round 3 (PR #309): audit_logs is a global collection;
      // filtering only by `details.incidentId` would surface rows from
      // OTHER tenants/projects that happen to reference the same
      // incidentId (collision possible since incidentId is per-tenant
      // not globally unique in the legacy schema). Scope to projectId
      // too. The audit-log writer (audit.ts route) stamps `projectId`
      // at the top level when known.
      const auditSnap = await db
        .collection('audit_logs')
        .where('details.incidentId', '==', incidentId)
        .where('projectId', '==', projectId)
        .limit(200)
        .get()
        .catch((err) => {
          logger.warn?.('sprintK.bundle.audit.fetch_failed', err);
          return null;
        });
      const auditLog =
        auditSnap?.docs.map((d) => {
          const data = d.data();
          const ts =
            data.timestamp?.toDate?.()?.toISOString() ??
            (typeof data.timestamp === 'string'
              ? data.timestamp
              : new Date().toISOString());
          return {
            at: ts,
            actorUid: String(data.userId ?? 'unknown'),
            actorRole: String(data.actorRole ?? 'unknown'),
            action: String(data.action ?? 'unknown'),
            context: typeof data.details === 'object' ? data.details : undefined,
          };
        }) ?? [];

      const manifest = buildIncidentBundle({
        incident: {
          id: incidentDoc.id,
          projectId,
          occurredAt,
          severity,
          summary: String(
            incidentData.summary ?? incidentData.description ?? incidentDoc.id,
          ),
          location: incidentData.location ?? undefined,
          reportedByUid: String(
            incidentData.reportedByUid ?? incidentData.userId ?? 'unknown',
          ),
          reportedAt,
        },
        // Empty arrays — these are the OUTSTANDING data sources to be
        // wired in sub-PRs. The bundle's gap detector reports them as
        // missing, which is the honest signal we want surfacing.
        affectedWorkers: [],
        evidence: [],
        appliedControls: [],
        requiredEpp: [],
        requiredTrainings: [],
        normativeRefs: [],
        // Codex P2 round 2 + 3 (PR #309): if the incident doc already
        // carries a `rootCause` payload, preserve it so the bundle
        // scorer doesn't emit a false `no_root_cause_assigned` gap
        // and tank completeness.
        //
        // The field can be either:
        // - STRING (set by backgroundTriggers.ts:385 on close flow)
        // - OBJECT (set by F.4 rootCauseClassifier)
        //
        // Map both shapes into the builder input. Strings become a
        // minimal { analyzed: true, primaryCauseKind: stringValue }
        // so the gap detector recognizes the analysis happened.
        rootCause: ((): typeof undefined | {
          analyzed: boolean;
          primaryCauseKind?: string;
          contributingFactors?: string[];
          pendingOwnerUid?: string;
          pendingDueDate?: string;
        } => {
          const rc = incidentData.rootCause;
          if (typeof rc === 'string' && rc.trim().length > 0) {
            return { analyzed: true, primaryCauseKind: rc };
          }
          if (typeof rc === 'object' && rc !== null) {
            const obj = rc as Record<string, unknown>;
            return {
              analyzed: Boolean(obj.analyzed ?? true),
              primaryCauseKind:
                typeof obj.primaryCauseKind === 'string'
                  ? obj.primaryCauseKind
                  : undefined,
              contributingFactors: Array.isArray(obj.contributingFactors)
                ? (obj.contributingFactors as string[])
                : undefined,
              pendingOwnerUid:
                typeof obj.pendingOwnerUid === 'string'
                  ? obj.pendingOwnerUid
                  : undefined,
              pendingDueDate:
                typeof obj.pendingDueDate === 'string'
                  ? obj.pendingDueDate
                  : undefined,
            };
          }
          return undefined;
        })(),
        auditLog,
      });

      return res.json({ manifest });
    } catch (err) {
      logger.error?.('sprintK.bundle.error', err);
      captureRouteError(err, 'sprintK.bundle');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Inbox del prevencionista (Fase F.8)
// ─────────────────────────────────────────────────────────────────────
//
// Agrega N feeds heterogéneos en una única lista ordenada por urgencia,
// reusando los adapters Sprint K/L ya wireados (corrective actions, SIF,
// equipment) + la collection legacy `audit_logs`/`incidents` para los
// canales que el plan F.8 lista pero aún no tienen su propio adapter
// (documents_pending_approval, repeating_risk_alerts, workers_onboarding).
//
// Output: { items: InboxItem[], summary: InboxSummary } — listo para
// renderizar con <InboxPrevencionistaPanel>.

router.get('/:projectId/inbox', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { aggregateInbox, summarizeInbox } = await import(
      '../../services/inbox/inboxAggregator.js'
    );

    const correctiveAdapter = new CorrectiveActionsAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    const sifAdapter = new SIFAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );

    // Best-effort parallel fetch. Each adapter is wrapped so one failure
    // doesn't blank out the whole inbox — the user still gets the feeds
    // that succeeded.
    //
    // Codex P2 round 4 (PR #309): include `in_progress` and `reopened`
    // statuses too — they're unresolved work that belongs in the
    // prevencionista's queue exactly like `open`. The F.4 status model
    // and the corrective-actions center page already load all 5; the
    // inbox was lagging.
    const [openActions, inProgressActions, reopenedActions, sifPending] = await Promise.all([
      correctiveAdapter.listByStatus('open').catch((err) => {
        logger.warn?.('sprintK.inbox.corrective.open.fetch_failed', err);
        return [] as Awaited<ReturnType<typeof correctiveAdapter.listByStatus>>;
      }),
      correctiveAdapter.listByStatus('in_progress').catch((err) => {
        logger.warn?.('sprintK.inbox.corrective.in_progress.fetch_failed', err);
        return [] as Awaited<ReturnType<typeof correctiveAdapter.listByStatus>>;
      }),
      correctiveAdapter.listByStatus('reopened').catch((err) => {
        logger.warn?.('sprintK.inbox.corrective.reopened.fetch_failed', err);
        return [] as Awaited<ReturnType<typeof correctiveAdapter.listByStatus>>;
      }),
      sifAdapter.listPendingExecutiveReview().catch((err) => {
        logger.warn?.('sprintK.inbox.sif.fetch_failed', err);
        return [] as Awaited<
          ReturnType<typeof sifAdapter.listPendingExecutiveReview>
        >;
      }),
    ]);

    // Codex P2 (PR #309): filter corrective actions by responsibleUid
    // so the prevencionista's inbox shows their OWN pending work, not
    // every action in the project. Extended F.4 records carry
    // `responsibleUid`; legacy weakActionDetector records don't —
    // those collapse into the inbox by default (the safer fallback,
    // since "unassigned" actions need someone to claim them).
    const unresolvedActions = [...openActions, ...inProgressActions, ...reopenedActions];
    const actionsForCaller = unresolvedActions.filter((a) => {
      const extra = a as unknown as { responsibleUid?: string };
      // If the record has an explicit responsibleUid, only include it
      // when it matches the caller. Otherwise include it (legacy data
      // that needs assignment + a prevencionista to triage it).
      if (typeof extra.responsibleUid === 'string' && extra.responsibleUid.length > 0) {
        return extra.responsibleUid === callerUid;
      }
      return true;
    });

    const items = aggregateInbox(
      {
        documentsPending: [],
        incidentsPending: [],
        correctiveActionsOpen: actionsForCaller.map((a) => {
          // Promote legacy weakActionDetector shape to the dueDate/
          // daysOverdue projection the inbox wants. Legacy actions
          // don't carry dueDate; we synthesize a conservative window
          // (created + 30d) so the inbox doesn't classify everything
          // overdue. Records that already have dueDate (F.4 shape)
          // override via the spread inside the helper.
          const extra = a as unknown as { dueDate?: string };
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          const synthDue = new Date(Date.now() + thirtyDaysMs).toISOString();
          return {
            id: a.id,
            label: a.description.slice(0, 80),
            dueDate: extra.dueDate ?? synthDue,
          };
        }),
        eppPendingValidation: [],
        workersPendingOnboarding: [],
        repeatingRiskAlerts: [],
        dataQualityGaps: [],
        sifPrecursorsPending: sifPending.map((p) => ({
          id: p.id,
          kind: p.kind,
          // SIFPrecursor carries `rationale: string[]` (the justification
          // chain of triggers). Join into a short summary for the inbox
          // card — the user clicks "Revisión ejecutiva" to see the full
          // detail anyway.
          summary: Array.isArray(p.rationale) ? p.rationale.join(' · ') : '',
          createdAt: p.occurredAt,
        })),
        legalObligationsDueSoon: [],
        exceptionsExpiringSoon: [],
        responsibleUid: callerUid,
      },
      // Sprint 40 Codex pre-empt: the aggregator throws on `now`-less
      // calls in dev only. Server-side we always pass `new Date()` so
      // the urgency calc is deterministic relative to wall-clock.
      { now: new Date() },
    );

    const summary = summarizeInbox(items, new Date().toISOString());

    return res.json({ items, summary });
  } catch (err) {
    logger.error?.('sprintK.inbox.error', err);
    captureRouteError(err, 'sprintK.inbox');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fase F.5 — Firma de Recepción Digital con QR
// ─────────────────────────────────────────────────────────────────────
//
// Cierra el wire end-to-end del flujo F.5:
//   1) POST /qr-signature/challenge — supervisor genera challenge HMAC
//      (server firma con QR_SIG_SECRET). El payload incluye TTL corto
//      (5 min default, cap 30 min) y un nonce 16-byte para anti-replay.
//      El challenge se PERSISTE en
//      `tenants/{tid}/projects/{pid}/qr_signature_challenges/{challengeId}`
//      para que /acknowledge pueda re-leerlo y verificar el HMAC
//      server-side (NUNCA confiamos en el client para re-enviar el
//      challenge firmado; eso permitiría adivinar `challengeId` y forjar
//      firmas).
//   2) POST /qr-signature/acknowledge — al finalizar el escaneo + firma
//      biométrica del trabajador, persistimos la confirmación en
//      `tenants/{tid}/projects/{pid}/qr_acknowledgements/{challengeId}`.
//      La escritura es ATÓMICA via Firestore transaction:
//         a) lee el challenge → 401 si no existe
//         b) verifica HMAC + TTL via verifyChallenge() (timing-safe)
//         c) si ya existe ack en la misma transacción → return existing
//            (idempotente); si no, crea con create() para que dos
//            scans simultáneos no se pisen.
//      El doc ack DENORMALIZA `itemId`, `kind`, `supervisorUid` y
//      `signatureHex` del challenge — el challenge puede rotarse o
//      caducar, pero la auditoría queda autocontenida en el ack.
//
// Directiva del usuario (product_signing_no_blocking_directives_2026-05-06):
// el documento queda con la empresa firmado, NO empujamos a
// SUSESO/MINSAL/SII. Generamos el comprobante; la entrega al organismo
// la hace la empresa.

const qrSignatureKindEnum = z.enum([
  'epp_delivery',
  'safety_talk',
  'document_read',
  'training_completion',
  'permit_acknowledgement',
  'inspection_handover',
]);

// Codex P2 (PR #313, line 1108): /qr-signature/challenge solo puede ser
// invocado por roles que crean firmas de recepción — supervisor de
// faena, prevencionista (HSE pro) o admin del tenant. Workers no pueden
// emitir challenges por su cuenta (de hacerlo se autoasignarían
// entregas de EPP sin supervisor presente). Mantiene la directiva
// "supervisor es quien firma + cita la entrega".
const QR_SIG_CHALLENGE_ROLES = new Set([
  'supervisor',
  'prevencionista',
  'admin',
]);

function callerHasSupervisorRole(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && QR_SIG_CHALLENGE_ROLES.has(u.role)) {
    return true;
  }
  // Tenant-scoped role claim: tenants[tenantId].role — algunas org
  // estructuras emiten el role a nivel tenant. Soportamos ambas formas.
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (tenants && typeof tenants === 'object' && typeof u.tenantId === 'string') {
    const t = tenants[u.tenantId];
    if (t && typeof t.role === 'string' && QR_SIG_CHALLENGE_ROLES.has(t.role)) {
      return true;
    }
  }
  return false;
}

router.post(
  '/:projectId/qr-signature/challenge',
  verifyAuth,
  validate(
    z.object({
      itemId: z.string().min(1),
      kind: qrSignatureKindEnum,
      ttlMinutes: z.number().int().min(1).max(30).optional(),
    }),
  ),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as {
      itemId: string;
      kind: z.infer<typeof qrSignatureKindEnum>;
      ttlMinutes?: number;
    };
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 (PR #313, line 1108): role gate antes de mintear el
    // challenge HMAC. assertProjectMember ya verificó pertenencia al
    // proyecto; aquí filtramos el role específico.
    if (!callerHasSupervisorRole(req)) {
      return res
        .status(403)
        .json({ error: 'forbidden_role', allowed: Array.from(QR_SIG_CHALLENGE_ROLES) });
    }
    try {
      const { buildChallenge } = await import(
        '../../services/qrSignature/qrSignatureService.js'
      );
      const nodeCrypto = await import('node:crypto');
      const secret = process.env.QR_SIG_SECRET ?? '';
      if (secret.length < 16) {
        return res
          .status(500)
          .json({ error: 'qr_signature_secret_not_configured' });
      }
      const challenge = buildChallenge(
        {
          challengeId: nodeCrypto.randomUUID(),
          itemId: body.itemId,
          kind: body.kind,
          projectId,
          initiatedByUid: callerUid,
          nonceHex: nodeCrypto.randomBytes(16).toString('hex'),
          ttlMinutes: body.ttlMinutes,
        },
        secret,
      );
      // Codex P1 (PR #313, line 1166): PERSIST el challenge — sin esto
      // /acknowledge no puede verificar el HMAC server-side y cualquiera
      // con un challengeId adivinado forjaría firmas válidas.
      const db = admin.firestore();
      const challengePath = `tenants/${g.tenantId}/projects/${projectId}/qr_signature_challenges`;
      await db
        .collection(challengePath)
        .doc(challenge.challengeId)
        .set({
          ...challenge,
          // Audit fields — quién lo emitió + cuándo.
          createdAt: new Date().toISOString(),
          createdByCallerUid: callerUid,
        });
      return res.status(201).json({ challenge });
    } catch (err) {
      logger.error?.('sprintK.qrSignature.challenge.error', err);
      captureRouteError(err, 'sprintK.qrSignature.challenge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/qr-signature/acknowledge',
  verifyAuth,
  validate(
    z.object({
      challengeId: z.string().min(1),
      workerUid: z.string().min(1),
      biometricUsed: z.boolean().optional(),
      signedAt: z.string().min(10),
    }),
  ),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as {
      challengeId: string;
      workerUid: string;
      biometricUsed?: boolean;
      signedAt: string;
    };
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { verifyChallenge } = await import(
        '../../services/qrSignature/qrSignatureService.js'
      );
      const secret = process.env.QR_SIG_SECRET ?? '';
      if (secret.length < 16) {
        return res
          .status(500)
          .json({ error: 'qr_signature_secret_not_configured' });
      }
      const db = admin.firestore();
      const challengeRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/qr_signature_challenges`)
        .doc(body.challengeId);
      const ackRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/qr_acknowledgements`)
        .doc(body.challengeId);

      // Codex P1 (PR #313, line 1166) + P2 #4 (line 1182):
      // Toda la verificación + escritura va en UNA transacción. Esto:
      //  1) Cierra la race condition entre check-existe → write (dos
      //     scans concurrentes ya no pueden ambos pasar el check y
      //     escribir; Firestore aborta la 2da txn).
      //  2) Asegura que el challenge existe + verifica HMAC ANTES de
      //     emitir el ack.
      // verifyChallenge() re-computa el HMAC con QR_SIG_SECRET y
      // compara constant-time (constantTimeEqual interno). Si el
      // challenge fue tampered / expiró / no existe → 401.
      const txnResult = await db.runTransaction(async (txn) => {
        const challengeSnap = await txn.get(challengeRef);
        if (!challengeSnap.exists) {
          return { kind: 'unauthorized' as const, reason: 'challenge_not_found' };
        }
        const challengeData = challengeSnap.data() as
          | import('../../services/qrSignature/qrSignatureService.js').QrSignatureChallenge
          | undefined;
        if (!challengeData) {
          return { kind: 'unauthorized' as const, reason: 'challenge_malformed' };
        }
        // Project mismatch (defense-in-depth: route param vs stored payload).
        if (challengeData.projectId !== projectId) {
          return { kind: 'unauthorized' as const, reason: 'challenge_project_mismatch' };
        }
        // Verify HMAC + TTL (timing-safe internal).
        const verification = verifyChallenge({
          challenge: challengeData,
          serverSecret: secret,
        });
        if (!verification.valid) {
          return {
            kind: 'unauthorized' as const,
            reason: `challenge_${verification.reason ?? 'invalid'}`,
          };
        }
        // Idempotency: if ack already exists, return it (don't overwrite).
        const ackSnap = await txn.get(ackRef);
        if (ackSnap.exists) {
          return {
            kind: 'idempotent' as const,
            acknowledgement: ackSnap.data(),
          };
        }
        // Codex P2 #3 (PR #313, line 1176): denormalize challenge fields
        // (itemId, kind, signatureHex, supervisorUid) into the ack
        // document so audit/forensic exports remain self-contained even
        // if the challenge doc is rotated/deleted.
        const acknowledgement = {
          challengeId: body.challengeId,
          itemId: challengeData.itemId,
          kind: challengeData.kind,
          supervisorUid: challengeData.initiatedByUid,
          challengeSignatureHex: challengeData.signatureHex,
          challengeExpiresAt: challengeData.expiresAt,
          workerUid: body.workerUid,
          acknowledgedByCallerUid: callerUid,
          biometricUsed: Boolean(body.biometricUsed),
          signedAt: body.signedAt,
          recordedAt: new Date().toISOString(),
        };
        // create() throws if doc exists — txn already guarded that, but
        // belt-and-suspenders: any race outside txn (somehow) aborts.
        txn.create(ackRef, acknowledgement);
        return { kind: 'created' as const, acknowledgement };
      });

      if (txnResult.kind === 'unauthorized') {
        return res
          .status(401)
          .json({ error: 'invalid_challenge', reason: txnResult.reason });
      }
      if (txnResult.kind === 'idempotent') {
        return res.status(200).json({ acknowledgement: txnResult.acknowledgement });
      }
      return res.status(201).json({ acknowledgement: txnResult.acknowledgement });
    } catch (err) {
      logger.error?.('sprintK.qrSignature.acknowledge.error', err);
      captureRouteError(err, 'sprintK.qrSignature.acknowledge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Fase F.26 — Indicador de Madurez Preventiva
// ─────────────────────────────────────────────────────────────────────
//
// Sintetiza señales objetivas a partir de las colecciones canónicas del
// proyecto (training_assignments, corrective_actions, cphs_meetings,
// incidents, leading-indicator-like feeds) y corre el servicio
// determinístico `computeMaturityLevel` + `recommendNextSteps`. Devuelve
// el `MaturityReport` con sub-puntajes por categoría + 3 recomendaciones
// concretas para subir de nivel.
//
// El servicio NO requiere contexto de proyecto (es puro), pero
// scopeamos los reads por projectId para que cada faena vea su propia
// madurez. Cuando la data es insuficiente (proyecto recién creado,
// <3 meses de actividad) devolvemos `{ insufficientData: true }` con
// el motivo, y la UI muestra el empty-state explicativo.

router.get('/:projectId/maturity-index', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { computeMaturityLevel, recommendNextSteps } = await import(
      '../../services/maturity/preventionMaturityIndex.js'
    );

    const db = admin.firestore();
    const tenantId = g.tenantId;

    // Best-effort parallel reads — patrón sprintK.data-quality: si una
    // colección falla el reporte sigue construyéndose con la data que
    // sí cargó (el caller ve un score más bajo en la categoría afectada,
    // no un 500 opaco).
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.maturity.read.${label}.failed`, err);
        return [];
      }
    };

    const projectRef = db.collection('projects').doc(projectId);
    const tenantProjectPath = `tenants/${tenantId}/projects/${projectId}`;
    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    // Ventana de tiempo: últimos 12 meses para incidents (frecuencia
    // de reporte, indicador inverso) y últimos 6 meses para meetings
    // CPHS (frecuencia de reuniones).
    const now = Date.now();
    const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
    const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;
    const twelveMonthsAgoIso = new Date(now - TWELVE_MONTHS_MS).toISOString();
    const sixMonthsAgoIso = new Date(now - SIX_MONTHS_MS).toISOString();

    // Ventana de 90 días para señales de voz del trabajador (positive
    // observations + confidential reports) — F.211 / F.214. Window
    // alineada a Codex P2#3.
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgoIso = new Date(now - NINETY_DAYS_MS).toISOString();

    const [
      trainings,
      correctiveActions,
      cphsMeetings,
      incidents,
      criticalControls,
      positiveObservations,
      confidentialReports,
      projectDoc,
    ] = await Promise.all([
      safeRead('trainings', async () => {
        const snap = await projectRef.collection('training_assignments').get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      }),
      safeRead('correctiveActions', async () => {
        const snap = await db
          .collection(`${tenantProjectPath}/corrective_actions`)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      }),
      safeRead('cphsMeetings', async () => {
        // Codex P2 fix: cphs_meetings es top-level pero su FK a proyecto
        // pasa por `committeeId` (ver `cphsService.ts`: meetings llevan
        // `committeeId` + `scheduledAt`/`heldAt`, NO `projectId` ni
        // `date`). El path canónico es:
        //   cphs_committees where projectId == X
        //     → cphs_meetings where committeeId IN (committee_ids)
        // Resolvemos en dos pasos para no requerir un índice
        // (projectId, scheduledAt) que no existe.
        const committeesSnap = await db
          .collection('cphs_committees')
          .where('projectId', '==', projectId)
          .get();
        const committeeIds = committeesSnap.docs.map((d) => d.id);
        if (committeeIds.length === 0) return [];

        // Firestore `in` admite hasta 30 valores; en la práctica los
        // proyectos tienen 1-2 comités vigentes. Si por algún motivo
        // hubiera >30 partimos en chunks.
        const chunkSize = 30;
        const meetingDocs: Array<{ id: string; data: () => unknown }> = [];
        for (let i = 0; i < committeeIds.length; i += chunkSize) {
          const chunk = committeeIds.slice(i, i + chunkSize);
          const snap = await db
            .collection('cphs_meetings')
            .where('committeeId', 'in', chunk)
            .get();
          meetingDocs.push(...snap.docs);
        }
        return meetingDocs.map(
          (d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as Record<string, unknown>),
        );
      }),
      safeRead('incidents', async () => {
        const snap = await byProject('incidents').get();
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
          .filter((rec) => {
            const ts =
              (typeof rec.occurredAt === 'string' && rec.occurredAt) ||
              (typeof rec.createdAt === 'string' && rec.createdAt) ||
              '';
            return ts >= twelveMonthsAgoIso;
          });
      }),
      safeRead('criticalControls', async () => {
        // critical_controls nested under tenants/{tid}/projects/{pid}.
        // El path se especifica en el plan F.26; si no existe la
        // colección Firestore devuelve snapshot vacío, no error.
        const snap = await db
          .collection(`${tenantProjectPath}/critical_controls`)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      }),
      safeRead('positiveObservations', async () => {
        // Codex P2 fix: F.214 — observaciones positivas como señal de
        // voz del trabajador. Path canónico (ver
        // `positiveObservationsFirestoreAdapter.ts`):
        //   tenants/{tid}/projects/{pid}/positive_observations
        // Filtramos por `observedAt >= 90d` en server-side query para
        // no traer historial completo.
        const snap = await db
          .collection(`${tenantProjectPath}/positive_observations`)
          .where('observedAt', '>=', ninetyDaysAgoIso)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      }),
      safeRead('confidentialReports', async () => {
        // Codex P2 fix: F.211 — reportes confidenciales como señal de
        // voz del trabajador. Path canónico (ver
        // `confidentialReportsFirestoreAdapter.ts`):
        //   tenants/{tid}/projects/{pid}/confidential_reports
        // Filtramos por `submittedAt >= 90d`.
        const snap = await db
          .collection(`${tenantProjectPath}/confidential_reports`)
          .where('submittedAt', '>=', ninetyDaysAgoIso)
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
      }),
      safeRead('project', async () => {
        const snap = await projectRef.get();
        return snap.exists ? [{ id: snap.id, ...snap.data() } as Record<string, unknown>] : [];
      }),
    ]);

    // Gate de insuficiencia de datos: necesitamos al menos 3 meses de
    // proyecto + diversidad mínima de fuentes para que el score no sea
    // ruido. El criterio es conservador — preferimos mostrar
    // empty-state honesto que un nivel 1 alarmista para una faena que
    // recién arrancó.
    //
    // Codex P2 fix: contamos fuentes (feeds) DISTINTAS que devolvieron
    // ≥1 doc, no la suma de docs. Si una faena tiene 3 trainings y nada
    // más, su score no debe sobrevivir el gate — el avg de las 5
    // categorías sale inflado por defaults cuando solo hay 1 feed.
    // Incluimos incidents (omitido antes) porque alimenta RCA + leading
    // indicators.
    const project = projectDoc[0];
    const projectCreatedAt =
      project &&
      ((typeof project.createdAt === 'string' && project.createdAt) ||
        (typeof project.startDate === 'string' && project.startDate) ||
        null);
    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
    const projectAgeMs = projectCreatedAt
      ? now - Date.parse(projectCreatedAt)
      : Number.POSITIVE_INFINITY;
    const populatedFeeds: string[] = [];
    if (trainings.length > 0) populatedFeeds.push('trainings');
    if (correctiveActions.length > 0) populatedFeeds.push('corrective_actions');
    if (cphsMeetings.length > 0) populatedFeeds.push('cphs_meetings');
    if (criticalControls.length > 0) populatedFeeds.push('critical_controls');
    if (incidents.length > 0) populatedFeeds.push('incidents');
    if (positiveObservations.length > 0) populatedFeeds.push('positive_observations');
    if (confidentialReports.length > 0) populatedFeeds.push('confidential_reports');
    const feedsAvailable = populatedFeeds.length;
    // Mantener `signalsCount` (suma de docs) en metadata para back-compat
    // con consumers existentes, pero NO usarlo como gate.
    const totalSignals =
      trainings.length +
      correctiveActions.length +
      cphsMeetings.length +
      criticalControls.length +
      incidents.length;
    // Gate honesto: al menos 2 fuentes distintas pobladas. 1 sola fuente
    // no es evidencia suficiente para grader cultura preventiva.
    const insufficient =
      (projectCreatedAt !== null && projectAgeMs < THREE_MONTHS_MS) ||
      feedsAvailable < 2;
    if (insufficient) {
      return res.json({
        insufficientData: true,
        reason:
          projectCreatedAt && projectAgeMs < THREE_MONTHS_MS
            ? 'project_too_new'
            : 'not_enough_signals',
        signalsCount: totalSignals,
        feedsAvailable,
        populatedFeeds,
        projectAgeDays: Number.isFinite(projectAgeMs)
          ? Math.round(projectAgeMs / (24 * 60 * 60 * 1000))
          : null,
      });
    }

    // ─── Derivar señales objetivas ───────────────────────────────────
    //
    // El servicio espera 10 señales 0..1 (excepto leadingIndicatorsUsed
    // que es string[]). Mapeo a partir de la data disponible. Cuando
    // una señal no tiene fuente clara (BBS, executiveEngagement,
    // workerEmpowerment, integrationWithOperations) usamos heurísticos
    // conservadores basados en metadata del proyecto o defaults
    // documentados en `MaturitySignals`.

    // 1. trainingCoverage: % de assignments con status='active' y no
    //    expirados sobre el total.
    let trainingCoverage = 0;
    if (trainings.length > 0) {
      const nowIso = new Date(now).toISOString();
      const active = trainings.filter((t) => {
        const status = String(t.status ?? '');
        const expiresAt = typeof t.expiresAt === 'string' ? t.expiresAt : null;
        return status === 'active' && (!expiresAt || expiresAt >= nowIso);
      }).length;
      trainingCoverage = active / trainings.length;
    }

    // 2. ipersCompleted: % de critical_controls con validación reciente.
    //    Si no hay critical_controls poblados, usamos 0 (señal honesta).
    let ipersCompleted = 0;
    if (criticalControls.length > 0) {
      const validated = criticalControls.filter((c) => {
        const validated = c.validated ?? c.lastValidatedAt;
        return Boolean(validated);
      }).length;
      ipersCompleted = validated / criticalControls.length;
    }

    // 3. cphsMeetingFrequency: reuniones/mes en últimos 6m. Esperado
    //    es 1 por mes → meetings / 6.
    //
    // Codex P2 fix: el shape canónico de `CphsMeeting` (ver
    // `services/cphs/types.ts`) usa `heldAt` (cuando se realizó) y
    // `scheduledAt` (cuando se agendó). NO existe `m.date`. Preferimos
    // `heldAt` cuando está poblado (la reunión efectivamente se hizo),
    // con fallback a `scheduledAt` si quedó en estado scheduled dentro
    // de la ventana.
    const recentMeetings = cphsMeetings.filter((m) => {
      const heldAt = typeof m.heldAt === 'string' ? m.heldAt : null;
      const scheduledAt = typeof m.scheduledAt === 'string' ? m.scheduledAt : null;
      const when = heldAt ?? scheduledAt;
      return when !== null && when >= sixMonthsAgoIso;
    }).length;
    const cphsMeetingFrequency = Math.min(1, recentMeetings / 6);

    // 4. leadingIndicatorsUsed: catalogo de feeds activos. Cada fuente
    //    de datos que el proyecto tiene poblada cuenta como un leading
    //    indicator efectivamente medido.
    const leadingIndicatorsUsed: string[] = [];
    if (correctiveActions.length > 0) leadingIndicatorsUsed.push('corrective_actions');
    if (cphsMeetings.length > 0) leadingIndicatorsUsed.push('cphs_meetings');
    if (trainings.length > 0) leadingIndicatorsUsed.push('training_assignments');
    if (criticalControls.length > 0) leadingIndicatorsUsed.push('critical_controls');
    if (incidents.length > 0) leadingIndicatorsUsed.push('incident_reporting');
    if (positiveObservations.length > 0) leadingIndicatorsUsed.push('positive_observations');
    if (confidentialReports.length > 0) leadingIndicatorsUsed.push('confidential_reports');
    // El servicio normaliza con LEADING_INDICATORS_TARGET=6, así que
    // 5 fuentes ≈ 0.83. Marketing-honest: más fuentes = nivel mayor.

    // 5. rootCauseAnalysisRate: % de incidents con rootCause poblado.
    let rootCauseAnalysisRate = 0;
    if (incidents.length > 0) {
      const withRoot = incidents.filter((i) => {
        const rc = i.rootCause ?? i.rootCauseCategory;
        if (typeof rc === 'string' && rc.trim().length > 0) return true;
        if (typeof rc === 'object' && rc !== null) return true;
        return false;
      }).length;
      rootCauseAnalysisRate = withRoot / incidents.length;
    }

    // 6. correctiveActionsClosureRate: % de acciones correctivas en
    //    estado closed/verified. Es un leading indicator interno
    //    (proxy de behaviorBasedSafety): equipos que cierran su loop
    //    PDCA tienden a tener cultura más sólida.
    let behaviorBasedSafety = 0;
    if (correctiveActions.length > 0) {
      const closed = correctiveActions.filter((a) => {
        const status = String(a.status ?? '');
        return status === 'closed' || status === 'verified';
      }).length;
      behaviorBasedSafety = closed / correctiveActions.length;
    }

    // 7. executiveEngagement: heurística conservadora. Si el proyecto
    //    tiene executiveSponsorUid + safety walks documentados (que
    //    rastreamos en `audit_logs` action='safety_walk') le damos
    //    crédito. Sin fuente clara, default 0.4 (cumplimiento mínimo).
    const executiveEngagement = project && project.executiveSponsorUid ? 0.6 : 0.4;

    // 8. workerEmpowerment: voz del trabajador. Codex P2 fix — los
    //    feeds reales que evidencian participación son
    //    `positive_observations` (F.214) y `confidential_reports`
    //    (F.211). Heurística calibrada:
    //      - 1.0 si ambas colecciones tienen ≥5 docs en 90d
    //      - 0.5 si solo una tiene ≥5 docs en 90d
    //      - 0.2 default (sin evidencia)
    //    El flag declarativo `project.anonymousReportingEnabled` actúa
    //    como piso suave (0.7) — si el proyecto declara el canal abierto
    //    pero aún no hay reportes, le damos crédito al sistema instalado
    //    sin permitir que entierre la evidencia real cuando existe.
    const OBS_THRESHOLD = 5;
    const obsReachThreshold = positiveObservations.length >= OBS_THRESHOLD;
    const reportsReachThreshold = confidentialReports.length >= OBS_THRESHOLD;
    let workerEmpowerment: number;
    if (obsReachThreshold && reportsReachThreshold) {
      workerEmpowerment = 1.0;
    } else if (obsReachThreshold || reportsReachThreshold) {
      workerEmpowerment = 0.5;
    } else {
      workerEmpowerment = 0.2;
    }
    if (project && project.anonymousReportingEnabled === true) {
      workerEmpowerment = Math.max(workerEmpowerment, 0.7);
    }

    // 9. integrationWithOperations: heurística — proyectos con
    //    `safetyPlanApproved` o `prevencionPlanId` están integrados.
    const integrationWithOperations =
      project && (project.safetyPlanApproved === true || project.prevencionPlanId)
        ? 0.7
        : 0.4;

    // 10. continuousImprovement: ratio de acciones correctivas
    //     cerradas+verified sobre el total — mismo proxy que BBS pero
    //     reutilizado para integration. Las dos métricas covarían, lo
    //     cual es realista (equipos que cierran acciones también
    //     mejoran continuamente).
    let continuousImprovement = behaviorBasedSafety;
    // Si hay >5 acciones verified (ciclo PDCA completo), boost.
    if (correctiveActions.length > 0) {
      const verified = correctiveActions.filter(
        (a) => String(a.status ?? '') === 'verified',
      ).length;
      if (verified >= 5) {
        continuousImprovement = Math.min(1, continuousImprovement + 0.15);
      }
    }

    const signals = {
      trainingCoverage,
      ipersCompleted,
      cphsMeetingFrequency,
      leadingIndicatorsUsed,
      rootCauseAnalysisRate,
      behaviorBasedSafety,
      executiveEngagement,
      workerEmpowerment,
      integrationWithOperations,
      continuousImprovement,
    };

    const report = computeMaturityLevel(signals);
    const recommendations = recommendNextSteps(report);

    return res.json({
      report,
      recommendations,
      signals,
      metadata: {
        signalsCount: totalSignals,
        feedsAvailable,
        populatedFeeds,
        projectAgeDays: Number.isFinite(projectAgeMs)
          ? Math.round(projectAgeMs / (24 * 60 * 60 * 1000))
          : null,
        windowMonths: 12,
      },
    });
  } catch (err) {
    logger.error?.('sprintK.maturity.error', err);
    captureRouteError(err, 'sprintK.maturity');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fase F.15 — Centro de Permisos de Trabajo
// ─────────────────────────────────────────────────────────────────────
//
// Permisos digitales para tareas críticas:
//   - Trabajo en altura (DS 594 art. 53)
//   - Trabajo en caliente (DS 132)
//   - Espacios confinados (DS 132 + protocolo MINSAL)
//   - LOTO / bloqueo energético (DS 132 + DS 109)
//   - Excavaciones (DS 594)
//   - Izaje crítico (DS 132)
//
//   GET  /:projectId/work-permits             — list filtered by status/kind
//   POST /:projectId/work-permits             — create permit (engine validates)
//   POST /:projectId/work-permits/:permitId/sign  — sign/issue active permit
//   POST /:projectId/work-permits/:permitId/close — close (cancel) with reason

const VALID_KINDS: ReadonlySet<WorkPermitKind> = new Set<WorkPermitKind>([
  'altura',
  'caliente',
  'confinado',
  'loto',
  'excavacion',
  'izaje_critico',
]);

const VALID_STATUSES: ReadonlySet<WorkPermitStatus> = new Set<WorkPermitStatus>([
  'draft',
  'pending_approval',
  'active',
  'expired',
  'cancelled',
  'fulfilled',
]);

router.get('/:projectId/work-permits', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new WorkPermitAdapter({
      db: admin.firestore() as any,
      tenantId: g.tenantId,
      projectId,
    });
    const statusQ =
      typeof req.query.status === 'string' ? req.query.status : null;
    const kindQ =
      typeof req.query.kind === 'string' ? req.query.kind : null;
    const kind =
      kindQ && VALID_KINDS.has(kindQ as WorkPermitKind)
        ? (kindQ as WorkPermitKind)
        : null;
    const status =
      statusQ && VALID_STATUSES.has(statusQ as WorkPermitStatus)
        ? (statusQ as WorkPermitStatus)
        : null;
    // `all` is an explicit opt-in to skip server-side status filtering and
    // let the caller see everything (the UI mainly uses it for admin views).
    const wantsAll = statusQ === 'all';
    const now = new Date();

    // Codex P2 #1 + #2: previously the route only knew listActive() and
    // listByKind(), so:
    //   - non-active status tabs (expired/cancelled/fulfilled) were filled
    //     by listActive() + JS filter — by construction they returned
    //     nothing real (cancelled/fulfilled docs were never in the seed set).
    //   - the kind filter short-circuited and ignored the status entirely,
    //     so picking "altura" on the Activos tab leaked fulfilled/cancelled.
    // The new branches push both filters into Firestore. For "expired" we
    // query status=active and post-filter with deriveStatus(), because
    // expiration is a derived state until the cron materializes it.
    let permits: WorkPermit[];
    if (kind && status) {
      if (status === 'active') {
        permits = (await adapter.listByKindAndStatus(kind, 'active')).filter(
          (p) => deriveStatus(p, now) === 'active',
        );
      } else if (status === 'expired') {
        // Expired = persisted as 'active' but past validUntil.
        permits = (await adapter.listByKindAndStatus(kind, 'active')).filter(
          (p) => deriveStatus(p, now) === 'expired',
        );
      } else {
        permits = await adapter.listByKindAndStatus(kind, status);
      }
    } else if (kind && wantsAll) {
      permits = await adapter.listByKind(kind);
    } else if (kind) {
      // Default when only kind is provided: behave like the Activos tab.
      permits = (await adapter.listByKindAndStatus(kind, 'active')).filter(
        (p) => deriveStatus(p, now) === 'active',
      );
    } else if (status === 'active') {
      permits = await adapter.listActive(now);
    } else if (status === 'expired') {
      // Persisted as active, validUntil already in the past.
      const candidates = await adapter.listByStatus('active');
      permits = candidates.filter((p) => deriveStatus(p, now) === 'expired');
    } else if (status) {
      permits = await adapter.listByStatus(status);
    } else if (wantsAll) {
      // No kind, status=all → return active union of other statuses for
      // listing/admin views.
      permits = await adapter.listActive(now);
    } else {
      permits = await adapter.listActive(now);
    }

    return res.json({ permits });
  } catch (err) {
    logger.error?.('sprintK.workPermits.list.error', err);
    captureRouteError(err, 'sprintK.workPermits.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fase F.21 — Panel de Riesgo por Turno (pre-turno)
// ─────────────────────────────────────────────────────────────────────
//
// El supervisor abre este panel ANTES de iniciar el turno y el sistema
// le dice "hoy tu turno arranca con riesgo X por estas razones". Cruza
// 7 fuentes determinísticas (clima, fatiga, novatos, tareas críticas,
// mantenimiento, incidentes recientes, brigada de emergencia) usando
// `composeShiftRiskPanel` del Sprint 40 Fase F.21.
//
// El servicio (preShiftRiskComposer.ts) es 100% determinístico — sin
// IA — y cada factor tiene peso conocido y trazable. Acá solo
// cosechamos las colecciones canónicas del proyecto y mapeamos al
// shape `ShiftRiskInputs` que el composer espera.

router.get('/:projectId/pre-shift-risk', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { composeShiftRiskPanel } = await import(
      '../../services/shiftRiskPanel/preShiftRiskComposer.js'
    );
    // Codex P2 (PR #311): reuse the canonical severity normalizer so
    // legacy Spanish labels ('Alta', 'Crítica', 'Media', 'Baja') don't
    // silently downgrade to 'medium'. The composer accepts only the
    // EN enum, so 'sif' is folded back to 'critical' (closest peer).
    const { normalizeSeverity } = await import(
      '../../services/incidentBundle/incidentEvidenceBundle.js'
    );
    const db = admin.firestore();

    // Best-effort parallel reads. Each query wrapped so one failure
    // doesn't blank the whole panel — supervisor sees partial data
    // and can still call the shift.
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.preShiftRisk.${label}.fetch_failed`, err);
        return [];
      }
    };

    const projectRef = db.collection('projects').doc(projectId);
    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    // 7d window for recent incidents; midnight today for planned tasks.
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    // Resolve optional `shift` + `date` query params; default to
    // `day` + today (YYYY-MM-DD). The composer only handles those
    // three periods.
    const shiftParam =
      typeof req.query.shift === 'string' &&
      ['day', 'evening', 'night'].includes(req.query.shift)
        ? (req.query.shift as 'day' | 'evening' | 'night')
        : 'day';
    const dateParam =
      typeof req.query.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : todayStartIso.slice(0, 10);

    // Codex P2 (PR #311): the shift-date window is ±24h around the
    // requested date so tasks scheduled later in the week don't
    // inflate today's pre-turno risk. Both endpoints normalized to
    // Date instances so we can compare against any shape the task
    // documents carry (Firestore Timestamp, ISO string, YYYY-MM-DD).
    const shiftDayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const shiftDayEnd = new Date(shiftDayStart.getTime() + 24 * 60 * 60 * 1000);

    // Codex P2 (PR #311): unify date comparisons. Firestore stores
    // dates as either an ISO string, a date-only `YYYY-MM-DD`, a JS
    // number (epoch ms), or a Firestore `Timestamp` with `.toDate()`.
    // Returning `null` for unparseable inputs lets callers fall back
    // to a safe default instead of comparing NaN.
    const coerceToDate = (raw: unknown): Date | null => {
      if (!raw) return null;
      if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
      if (typeof raw === 'number') {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof raw === 'string') {
        // Treat bare `YYYY-MM-DD` as UTC midnight so it lines up with
        // `todayStart` and `shiftDayStart` (both UTC). Without this,
        // `new Date('2026-05-17')` is UTC but `new Date('2026-05-17T10:00')`
        // is local — mixing them caused lexicographic bugs upstream.
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
          ? `${raw}T00:00:00.000Z`
          : raw;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof raw === 'object' && raw !== null) {
        const maybeTs = raw as { toDate?: () => Date; seconds?: number };
        if (typeof maybeTs.toDate === 'function') {
          try {
            const d = maybeTs.toDate();
            return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
          } catch {
            return null;
          }
        }
        if (typeof maybeTs.seconds === 'number') {
          const d = new Date(maybeTs.seconds * 1000);
          return Number.isNaN(d.getTime()) ? null : d;
        }
      }
      return null;
    };

    const [
      workers,
      recentIncidents,
      criticalTasks,
      equipment,
      environment,
      activePermits,
      projectDoc,
    ] = await Promise.all([
      safeRead('workers', async () => {
        const snap = await projectRef.collection('workers').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          // Map Firestore shape to ShiftRiskInputs.workers[]. Workers
          // collection commonly has: name/fullName, hire-date under
          // any of several aliases, optional fatigueRisk + night-shift
          // history.
          //
          // Codex P2 (PR #311): the project-worker creation flow
          // writes `joinedAt`, importers write `hireDate`, and the
          // legacy onboarding flow writes `startDate` / `createdAt`.
          // Accept all of them — and any shape `coerceToDate`
          // understands — so freshly hired workers actually trigger
          // the new-worker factor instead of falling into the
          // `daysSinceHire = 999` veteran branch.
          const hireDate =
            coerceToDate(data.hireDate) ??
            coerceToDate(data.joinedAt) ??
            coerceToDate(data.startDate) ??
            coerceToDate(data.hiredAt) ??
            coerceToDate(data.createdAt);
          const daysSinceHire = hireDate
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - hireDate.getTime()) /
                    (1000 * 60 * 60 * 24),
                ),
              )
            : 999; // unknown → assume veteran (don't false-flag as new)
          return {
            uid: d.id,
            fullName: String(
              data.fullName ?? data.name ?? data.displayName ?? d.id,
            ),
            fatigueRisk:
              typeof data.fatigueRisk === 'string' &&
              ['low', 'moderate', 'high', 'critical'].includes(
                data.fatigueRisk,
              )
                ? (data.fatigueRisk as 'low' | 'moderate' | 'high' | 'critical')
                : 'low',
            daysSinceHire,
            hasNightShiftHistory:
              typeof data.hasNightShiftHistory === 'boolean'
                ? data.hasNightShiftHistory
                : undefined,
          };
        });
      }),
      safeRead('incidents', async () => {
        // Codex P2 round-2 (PR #311): the previous
        // `.where('occurredAt', '>=', sevenDaysAgo)` Firestore filter
        // dropped any incident record that carries only `createdAt`
        // (legacy imports, plus the canonical incidentBundle path
        // which already accepts `createdAt` as the timestamp
        // fallback). When the project's only recent high/critical
        // incident lives on that shape, the entire
        // `recent-incidents` factor disappears and the pre-shift
        // panel under-reports the shift risk.
        //
        // Read a bounded set ordered by `createdAt` (the field
        // every legacy + canonical write path sets) and apply the
        // same `occurredAt ?? createdAt` fallback BEFORE the 7-day
        // window check, in JS, so both timestamp shapes are
        // honored. Bounded at 200 docs to keep one project's noisy
        // history from blowing up read costs.
        //
        // TODO(firestore-index): once a composite index exists on
        //   `projectId + createdAt desc` we can promote the order
        //   back into Firestore (`.orderBy('createdAt', 'desc')`)
        //   and drop the JS slice. Until then the JS filter is the
        //   correct fallback (Firestore would throw
        //   FAILED_PRECONDITION without the index).
        const snap = await byProject('incidents').limit(200).get();
        const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            // Canonical timestamp resolution: prefer `occurredAt`
            // (when set by the canonical incidentBundle write
            // path), fall back to `createdAt` (legacy + imported
            // records). The same coercion chain handles
            // ISO strings, Firestore Timestamps, epoch numbers, and
            // bare YYYY-MM-DD.
            const tsDate =
              coerceToDate(data.occurredAt) ??
              coerceToDate(data.createdAt);
            if (!tsDate || tsDate.getTime() < sevenDaysAgoMs) {
              return null;
            }
            // Codex P2 (PR #311): incident records carry either the EN
            // canonical enum ('low'/'medium'/'high'/'critical') OR ES
            // legacy labels ('Baja'/'Media'/'Alta'/'Crítica' — and
            // 'leve'/'moderado'/'grave' via the incidentBundle alias
            // table). Use the canonical normalizer so high/critical
            // Spanish-labeled incidents aren't silently downgraded to
            // 'medium' and don't fail to push the panel past the
            // amber/red threshold. SUSESO `sif` folds back to
            // 'critical' since the composer's weight table tops out
            // there.
            const sevRaw = typeof data.severity === 'string' ? data.severity : '';
            const normalized = sevRaw ? normalizeSeverity(sevRaw) : null;
            const severity: 'low' | 'medium' | 'high' | 'critical' =
              normalized === 'sif'
                ? 'critical'
                : normalized ?? 'medium';
            return {
              id: d.id,
              severity,
              occurredAt: tsDate.toISOString(),
            };
          })
          .filter((i): i is NonNullable<typeof i> => i !== null)
          .slice(0, 50);
      }),
      safeRead('tasks', async () => {
        // Tasks may have `plannedDate` / `scheduledFor` and a
        // `criticality` or boolean `isCriticalTask` flag. The
        // composer only needs id + category + isCriticalTask +
        // requiresPermit.
        //
        // Codex P2 (PR #311):
        //   - Filter by shift-date FIRST, then limit. The old shape
        //     (`.limit(100)` before any where) could return 100
        //     older/future/non-critical docs and silently drop the
        //     handful of critical tasks actually scheduled for this
        //     shift.
        //   - Bound the window to ±24h around the requested shift
        //     date instead of "≥ today" so a critical task two weeks
        //     from now doesn't inflate the pre-turno panel today.
        //   - Compare at the same granularity (Date instance via
        //     `coerceToDate`) so `'2026-05-17'` and
        //     `'2026-05-17T00:00:00.000Z'` aren't compared
        //     lexicographically — the old `planned < todayStartIso`
        //     dropped today's `YYYY-MM-DD`-formatted tasks on the
        //     floor because `'2026-05-17' < '2026-05-17T...'` is
        //     true.
        //
        // TODO(firestore-index): once a composite index exists on
        //   `projectId + plannedDate` (and a parallel one on
        //   `projectId + scheduledFor`), promote the JS filter back
        //   to a Firestore where-clause for cheaper reads:
        //     byProject('tasks')
        //       .where('plannedDate', '>=', shiftDayStart.toISOString())
        //       .where('plannedDate', '<', shiftDayEnd.toISOString())
        //       .limit(200)
        //   Until that index is deployed, the JS path below is the
        //   correct fallback (Firestore would throw FAILED_PRECONDITION
        //   without it). Raised the cap to 500 so we don't truncate
        //   the candidate pool before the date filter runs.
        const snap = await byProject('tasks').limit(500).get();
        return snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            // Codex P2 round-2 (PR #311): the canonical organic-task
            // endpoint (`POST /api/processes/:id/tasks` in
            // `src/server/routes/organic.ts`) writes the planned day
            // into top-level `date` (validated as `YYYY-MM-DD`). The
            // mapper used to check only `plannedDate` /
            // `scheduledFor` / `dueDate`, so canonical-schema tasks
            // had no date and slipped past the day filter — a
            // critical task dated next week was counted in today's
            // pre-shift score. Include `data.date` (and `data.day`
            // for the legacy alias seen in some importers) in the
            // same coercion chain.
            const plannedDate =
              coerceToDate(data.plannedDate) ??
              coerceToDate(data.scheduledFor) ??
              coerceToDate(data.dueDate) ??
              coerceToDate(data.date) ??
              coerceToDate(data.day);
            // If we can't pin down a date, keep the task — the
            // composer will weight it as best-effort. The previous
            // behavior of silently dropping it also dropped tasks
            // with bad-shape dates that DID belong to this shift.
            if (plannedDate) {
              const ts = plannedDate.getTime();
              if (ts < shiftDayStart.getTime() || ts >= shiftDayEnd.getTime()) {
                return null;
              }
            }
            const criticality =
              typeof data.criticality === 'string'
                ? data.criticality
                : null;
            const isCritical =
              criticality === 'high' ||
              criticality === 'critical' ||
              data.isCriticalTask === true;
            return {
              id: d.id,
              category: String(data.category ?? data.kind ?? 'general'),
              isCriticalTask: isCritical,
              requiresPermit:
                typeof data.requiresPermit === 'boolean'
                  ? data.requiresPermit
                  : undefined,
            };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null);
      }),
      safeRead('equipment', async () => {
        // Codex P2 round-2 (PR #311): the Sprint K equipment API
        // (`GET /:projectId/equipment` above) writes via
        // `EquipmentAdapter` into the CANONICAL store
        // `tenants/{tenantId}/projects/{projectId}/equipment`, with
        // master records carrying `nextMaintenanceAt`. The old
        // reader scanned only the legacy top-level `assets`
        // collection, so any equipment maintained through the QR /
        // equipment module was invisible here — overdue maintenance
        // there couldn't raise the shift-risk factor or block
        // recommendations.
        //
        // Read BOTH stores in parallel and merge them, deduping by
        // (code → id) so a record present in both shapes is counted
        // once. The canonical record wins on overlap because it's
        // the active write path.
        const mapDoc = (d: { id: string; data(): unknown }) => {
          const data = d.data() as Record<string, unknown>;
          // Codex P2 (PR #311): MaquinariaManager writes
          // `nextMaintenance` from `<input type="date">`, which
          // parses to UTC midnight. The old `< Date.now()` check
          // flagged equipment whose maintenance is due TODAY as
          // overdue for the entire shift (since midnight is < now
          // by lunchtime), raising a false-positive risk factor.
          // Compare against the start of the requested shift's day
          // instead — equipment is only "overdue" if its due-date
          // is strictly before the day we're calling the shift for.
          // Also accept Firestore Timestamp via coerceToDate.
          const nextMaint =
            coerceToDate(data.nextMaintenanceAt) ??
            coerceToDate(data.nextMaintenance);
          const overdue = nextMaint
            ? nextMaint.getTime() < shiftDayStart.getTime()
            : false;
          return {
            id: d.id,
            code: String(data.code ?? data.name ?? d.id),
            overdueMaintenance: overdue,
          };
        };

        const legacyPromise = byProject('assets')
          .get()
          .then((s: { docs: Array<{ id: string; data(): unknown }> }) =>
            s.docs.map(mapDoc),
          )
          .catch(() => [] as ReturnType<typeof mapDoc>[]);

        const canonicalPromise: Promise<ReturnType<typeof mapDoc>[]> = (async () => {
          try {
            const canonSnap = await db
              .collection(
                `tenants/${g.tenantId}/projects/${projectId}/equipment`,
              )
              .limit(500)
              .get();
            return canonSnap.docs.map(mapDoc);
          } catch {
            return [];
          }
        })();

        const [legacy, canonical] = await Promise.all([
          legacyPromise,
          canonicalPromise,
        ]);

        // Dedupe by code (preferred) → id, with canonical taking
        // precedence on overlap (active write path).
        const dedupKey = (e: { id: string; code: string }) =>
          e.code && e.code !== e.id ? `code:${e.code}` : `id:${e.id}`;
        const merged = new Map<string, ReturnType<typeof mapDoc>>();
        for (const e of legacy) merged.set(dedupKey(e), e);
        for (const e of canonical) merged.set(dedupKey(e), e);
        return Array.from(merged.values());
      }),
      safeRead('environment', async () => {
        const snap = await db
          .collection('global_context')
          .doc('environment')
          .get();
        return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      }),
      safeRead('permits', async () => {
        // Active permits used as the `activePermitsCount` signal. The
        // collection may live as `work_permits` (top-level) — best
        // effort.
        const snap = await byProject('work_permits')
          .where('status', '==', 'active')
          .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }),
      safeRead('project', async () => {
        const snap = await projectRef.get();
        return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      }),
    ]);

    // Map environment doc (NASA POWER / Open-Meteo / OpenWeather
    // cached blob) to ShiftRiskInputs.weather. Use conservative
    // defaults when fields are missing so the composer always returns
    // a valid score.
    //
    // Codex P2 (PR #311): the environment updater
    // (src/services/environmentBackend.ts) stores readings nested
    // under `global_context/environment.weather` — fields are
    // `temp`, `windSpeed` (KM/H, not m/s — already converted with
    // ×3.6), `humidity`, `condition`. The old mapper only looked at
    // top-level `temperatureC`/`temperature` and `windSpeedMs`, so
    // every read defaulted to 20°C and 0 m/s — silencing the heat
    // and wind risk factors in exactly the conditions this panel
    // exists to surface. Try the common nested shapes
    // ({ weather }, { current }, { data }) before falling back to
    // the top-level fields, and back-convert km/h → m/s when only
    // the km/h field is present.
    const envDoc = environment[0] ?? {};
    const envRoot = envDoc as Record<string, unknown>;
    const pickObj = (key: string): Record<string, unknown> | null => {
      const v = envRoot[key];
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    };
    const envWeather = pickObj('weather');
    const envCurrent = pickObj('current');
    const envData = pickObj('data');
    // Search order: explicit `weather` sub-doc (environmentBackend),
    // then `current` (OpenWeather-style), then `data` (some cached
    // wrappers), then the root doc itself for back-compat.
    const envSources: Array<Record<string, unknown>> = [
      ...(envWeather ? [envWeather] : []),
      ...(envCurrent ? [envCurrent] : []),
      ...(envData ? [envData] : []),
      envRoot,
    ];
    const readNumber = (...keys: string[]): number | undefined => {
      for (const src of envSources) {
        for (const k of keys) {
          const v = src[k];
          if (typeof v === 'number' && Number.isFinite(v)) return v;
        }
      }
      return undefined;
    };

    const rainProbability = readNumber('rainProbability', 'pop', 'precipProbability') ?? 0;
    // `windSpeed` in environmentBackend is already km/h (×3.6 applied
    // at write time). If only that field is present, back-convert
    // before handing to the composer (which expects m/s).
    const windMs = readNumber('windSpeedMs', 'wind_ms');
    const windKmh = readNumber('windKmh', 'windSpeedKmh');
    const windFallbackKmh = readNumber('windSpeed', 'wind'); // ambient km/h convention from env cache
    const windSpeedMs =
      windMs ??
      (typeof windKmh === 'number' ? windKmh / 3.6 : undefined) ??
      (typeof windFallbackKmh === 'number' ? windFallbackKmh / 3.6 : 0);

    // Codex P2 round-2 (PR #311): OpenWeather-shaped cached payloads
    // report bare `visibility` in METERS (their `current.visibility`
    // field is documented as "Visibility, meter. Maximum value 10000").
    // Aliasing that straight onto `visibilityKm` made fog at 500 m read
    // as 500 km, which trivially passes the composer's `< 1 km`
    // low-visibility check and suppresses the factor. Treat the bare
    // `visibility` field as meters (the OpenWeather convention) and
    // back-convert; treat the explicit `visibilityKm` field as km.
    const visibilityKmExplicit = readNumber('visibilityKm');
    const visibilityMeters = readNumber('visibility');
    const visibilityKm =
      visibilityKmExplicit ??
      (typeof visibilityMeters === 'number'
        ? visibilityMeters / 1000
        : undefined) ??
      10;

    const weather = {
      rainProbability,
      windSpeedMs,
      uvIndex: readNumber('uvIndex', 'uv', 'uvi') ?? 0,
      temperatureC:
        readNumber('temperatureC', 'temp', 'temperature') ?? 20,
      lightningRiskWithinHours: readNumber('lightningRiskWithinHours'),
      visibilityKm,
    };

    // Brigade readiness flag lives in the project doc (project-level
    // configuration). Default to false (the composer flags this with
    // a +15 factor) so missing config is visible, not hidden.
    const projectData = (projectDoc[0] as Record<string, unknown>) ?? {};
    const emergencyBrigadeReady =
      typeof projectData.emergencyBrigadeReady === 'boolean'
        ? projectData.emergencyBrigadeReady
        : false;

    const panel = composeShiftRiskPanel({
      projectId,
      shift: shiftParam,
      date: dateParam,
      weather,
      workers,
      plannedTasks: criticalTasks,
      equipment,
      recentIncidents,
      activePermitsCount: activePermits.length,
      emergencyBrigadeReady,
    });

    return res.json({ panel });
  } catch (err) {
    logger.error?.('sprintK.preShiftRisk.error', err);
    captureRouteError(err, 'sprintK.preShiftRisk');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fase F.13 — Radar de Riesgos Repetidos
// ─────────────────────────────────────────────────────────────────────
//
// Lee los `incidents` recientes del proyecto (top-level collection,
// usada por backgroundTriggers) y los normaliza al shape
// `IncidentSample` que consume el servicio determinístico
// `buildRepeatingRiskRadar`. El resultado (`RadarReport`) viaja crudo al
// frontend para que `<RepeatingRiskRadarCard>` lo renderice.
//
// 100% determinístico, sin ML — agregaciones simples sobre los nodos
// por zona/tipo/tiempo. Si la lectura de incidents falla, devolvemos un
// reporte vacío en lugar de 500 para no bloquear el dashboard.

router.get('/:projectId/repeating-risks', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { buildRepeatingRiskRadar } = await import(
      '../../services/riskRadar/repeatingRiskRadar.js'
    );
    const db = admin.firestore();

    // Ventana: últimos 90 días — suficiente para detectar patrones según
    // F.13. Filtramos en memoria por occurredAt para tolerar docs con
    // timestamps inconsistentes (la fn `filterRecent` del servicio
    // también descarta futuros + invalid).
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

    const safeIncidents = async (): Promise<Array<Record<string, unknown> & { id: string }>> => {
      // Codex P2 PR #312 — Order BEFORE applying the cap. Firestore's
      // `.limit(N)` without an explicit `orderBy` returns an arbitrary
      // subset (typically document-id order); for projects with >500
      // incidents that drops the most recent ones, which are exactly the
      // signal the 90-day radar window cares about. Sort by `reportedAt`
      // desc so the cap keeps the freshest documents.
      //
      // Codex P1 PR #312 round 2 — The ordered query requires composite
      // index `incidents(projectId, reportedAt desc)`. If the index is
      // not yet deployed (FAILED_PRECONDITION) we MUST NOT silently
      // return [] (radar would falsely report "no patterns" for every
      // project until the index propagates). Fall back to the unordered
      // query, sort+cap in JS, and warn so deploy hooks notice.
      // TODO(PR #312): once `firestore.indexes.json` deploy confirmed in
      // prod, this fallback becomes dead code — remove after a release.
      //
      // Codex P2 PR #312 round 2 — Legacy/imported incident docs may
      // carry `occurredAt` but no `reportedAt`. An `orderBy('reportedAt')`
      // silently excludes those docs from the result set (Firestore
      // skips docs missing the order field). Fetch a second pass ordered
      // by `occurredAt` and merge by id — covers both shapes without
      // forcing a backfill migration.
      const fetchOrdered = async (
        field: 'reportedAt' | 'occurredAt',
      ): Promise<Array<Record<string, unknown> & { id: string }>> => {
        try {
          const snap = await db
            .collection('incidents')
            .where('projectId', '==', projectId)
            .orderBy(field, 'desc')
            .limit(500)
            .get();
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (err) {
          const code = (err as { code?: string | number } | null)?.code;
          // gRPC FAILED_PRECONDITION = 9; Firestore SDK also surfaces it
          // as the string 'failed-precondition'.
          const isMissingIndex =
            code === 9 ||
            code === 'failed-precondition' ||
            /index/i.test(String((err as Error | null)?.message ?? ''));
          if (!isMissingIndex) throw err;
          logger.warn?.('sprintK.riskRadar.incidents.missing_index_fallback', {
            field,
            err,
          });
          try {
            const snap = await db
              .collection('incidents')
              .where('projectId', '==', projectId)
              .get();
            const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            // JS sort by `field` desc; tolerate Firestore Timestamp,
            // Date, number, or ISO string. Cap to 500 (same as ordered
            // query) so the rest of the pipeline keeps its memory bound.
            const tsOf = (raw: unknown): number => {
              if (!raw) return -Infinity;
              if (raw instanceof Date) {
                const t = raw.getTime();
                return Number.isFinite(t) ? t : -Infinity;
              }
              if (typeof raw === 'string') {
                const t = Date.parse(raw);
                return Number.isFinite(t) ? t : -Infinity;
              }
              if (typeof raw === 'number') {
                return Number.isFinite(raw) ? raw : -Infinity;
              }
              if (typeof raw === 'object') {
                const ts = raw as { toMillis?: () => number; toDate?: () => Date };
                if (typeof ts.toMillis === 'function') {
                  const ms = ts.toMillis();
                  return Number.isFinite(ms) ? ms : -Infinity;
                }
                if (typeof ts.toDate === 'function') {
                  const d = ts.toDate();
                  if (d instanceof Date && Number.isFinite(d.getTime())) {
                    return d.getTime();
                  }
                }
              }
              return -Infinity;
            };
            docs.sort((a, b) => tsOf(b[field]) - tsOf(a[field]));
            return docs.slice(0, 500);
          } catch (fallbackErr) {
            logger.warn?.(
              'sprintK.riskRadar.incidents.fallback_failed',
              fallbackErr,
            );
            return [];
          }
        }
      };

      try {
        const [byReported, byOccurred] = await Promise.all([
          fetchOrdered('reportedAt'),
          fetchOrdered('occurredAt'),
        ]);
        // Merge by id: same doc may appear in both pages.
        const seen = new Map<string, Record<string, unknown> & { id: string }>();
        for (const d of byReported) seen.set(d.id, d);
        for (const d of byOccurred) if (!seen.has(d.id)) seen.set(d.id, d);
        return Array.from(seen.values());
      } catch (err) {
        logger.warn?.('sprintK.riskRadar.incidents.fetch_failed', err);
        return [];
      }
    };

    const rawIncidents = await safeIncidents();

    // Codex P2 PR #312 — Normalize `occurredAt` to a Date BEFORE filtering
    // the radar window. Imported / legacy Firestore docs may store this as
    // a Firestore `Timestamp` (with `.toDate()`/`.toMillis()`), a JS Date,
    // a numeric epoch, or an ISO string with an offset. Lexicographic
    // string compare against a UTC ISO cutoff drops timestamps that are
    // actually inside the window (e.g. `2026-05-10T23:30:00-03:00` parses
    // later than `2026-05-11T00:15:00Z` but sorts earlier as a string).
    const cutoffMs = Date.now() - NINETY_DAYS_MS;
    type MaybeTimestamp = { toDate?: () => Date; toMillis?: () => number };
    const toDate = (raw: unknown): Date | null => {
      if (!raw) return null;
      if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
      if (typeof raw === 'string') {
        const ms = Date.parse(raw);
        return Number.isFinite(ms) ? new Date(ms) : null;
      }
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? new Date(raw) : null;
      }
      if (typeof raw === 'object') {
        const ts = raw as MaybeTimestamp;
        if (typeof ts.toMillis === 'function') {
          const ms = ts.toMillis();
          return Number.isFinite(ms) ? new Date(ms) : null;
        }
        if (typeof ts.toDate === 'function') {
          const d = ts.toDate();
          return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
        }
      }
      return null;
    };

    // Normaliza al shape `IncidentSample`. Conservamos cualquier doc cuyo
    // `occurredAt` esté dentro de la ventana de 90 días y que tenga AL
    // MENOS uno entre `kind` o `zoneId` derivable — los detectores
    // worker/task/shift/time-cluster del servicio no requieren ambos.
    // - `kind` ← `kind | type | category`
    // - `zoneId` ← `zoneId | zone | location | area`
    // - `taskId` ← `taskId | task`
    // - `shift` ← solo si está en el enum válido del servicio.
    type Shift = 'day' | 'evening' | 'night';
    const VALID_SHIFTS: ReadonlySet<Shift> = new Set(['day', 'evening', 'night']);
    type Severity = 'low' | 'medium' | 'high' | 'critical';

    // Codex P2 PR #312 — Normalize legacy Spanish severities at the
    // boundary. The existing incident-bundle alias map covers
    // baja/media/alta/critica/crítica (Codex P2 PR #122); the radar bundle
    // sees additional legacy labels (leve/moderado/grave/fatal) and the EN
    // `fatality` outcome term. Map everything to the canonical 4-value
    // radar enum (`sif` collapses to `critical`).
    const SEVERITY_ALIASES: Record<string, Severity> = {
      // EN canonical
      low: 'low',
      medium: 'medium',
      high: 'high',
      critical: 'critical',
      // EN legacy / outcome
      fatality: 'critical',
      sif: 'critical',
      // ES canonical (incident-bundle aliases)
      baja: 'low',
      media: 'medium',
      alta: 'high',
      critica: 'critical',
      'crítica': 'critical',
      // ES legacy (PR #312)
      leve: 'low',
      moderado: 'medium',
      moderada: 'medium',
      grave: 'high',
      fatal: 'critical',
    };
    const normalizeRadarSeverity = (raw: unknown): Severity | undefined => {
      if (typeof raw !== 'string') return undefined;
      const key = raw.trim().toLowerCase();
      return SEVERITY_ALIASES[key];
    };

    const samples = rawIncidents
      .map((d) => {
        const occurredAtDate = toDate(d.occurredAt);
        if (!occurredAtDate) return null;
        if (occurredAtDate.getTime() < cutoffMs) return null;
        const kind =
          (typeof d.kind === 'string' && d.kind) ||
          (typeof d.type === 'string' && (d.type as string)) ||
          (typeof d.category === 'string' && (d.category as string)) ||
          '';
        const zoneId =
          (typeof d.zoneId === 'string' && d.zoneId) ||
          (typeof d.zone === 'string' && (d.zone as string)) ||
          (typeof d.location === 'string' && (d.location as string)) ||
          (typeof d.area === 'string' && (d.area as string)) ||
          '';
        const taskId =
          (typeof d.taskId === 'string' && d.taskId) ||
          (typeof d.task === 'string' && (d.task as string)) ||
          undefined;
        const workerUid =
          typeof d.workerUid === 'string' ? (d.workerUid as string) : undefined;
        const rawShift = typeof d.shift === 'string' ? (d.shift as string) : '';
        const shift = VALID_SHIFTS.has(rawShift as Shift)
          ? (rawShift as Shift)
          : undefined;
        const severity = normalizeRadarSeverity(d.severity);
        return {
          id: d.id,
          occurredAt: occurredAtDate.toISOString(),
          kind,
          zoneId,
          taskId,
          workerUid,
          shift,
          severity,
        };
      })
      // Codex P2 PR #312 — Keep samples usable for non-zone detectors.
      // `detectSameWorkerRepeated`, `detectSameTaskRepeated`,
      // `detectSameShiftPattern` and `detectTimeCluster` group on
      // worker/task/shift/time, not on kind+zone. A doc missing kind+zone
      // but carrying workerUid (or taskId, or shift) is still valid
      // signal for that detector.
      //
      // Codex P2 PR #312 round 2 — Round 1 only kept docs with kind or
      // zoneId; that dropped imports where workers/tasks/shifts are
      // populated independently. Accept any doc that carries at least
      // ONE of the 5 grouping facets — kind | zoneId | workerUid |
      // taskId | shift — plus an occurredAt timestamp (already validated
      // above). The time-cluster detector groups on timestamp alone, so
      // even docs without any facet but with a valid timestamp could be
      // useful — we still gate on at least one facet here to avoid
      // feeding pure noise into the cluster detector.
      .filter(
        (s): s is NonNullable<typeof s> =>
          s !== null &&
          (s.kind.length > 0 ||
            s.zoneId.length > 0 ||
            (typeof s.workerUid === 'string' && s.workerUid.length > 0) ||
            (typeof s.taskId === 'string' && s.taskId.length > 0) ||
            typeof s.shift === 'string'),
      );

    const report = buildRepeatingRiskRadar(samples, {
      minOccurrences: 3,
      windowDays: 90,
    });

    return res.json({ report });
  } catch (err) {
    logger.error?.('sprintK.riskRadar.error', err);
    captureRouteError(err, 'sprintK.riskRadar');
    return res.status(500).json({ error: 'internal_error' });
  }
});


const checklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  checked: z.boolean(),
  verifiedAt: z.string().optional(),
});

/**
 * Body schema for POST /work-permits. Codex P1 #2: issuer identity
 * (workerUid, approverUid, approverRole) is NOT accepted from the body —
 * the server derives it from `req.user` and the caller's custom claims.
 * Trusting body fields would let any worker mint an active critical-work
 * permit with an arbitrary "supervisor" approver.
 *
 * The optional `workerUid` here is purely a self-assignment hint: the
 * route enforces `workerUid === callerUid` unless the caller has the
 * `canIssuePermits` claim (supervisor/prevencionista/gerente/admin).
 *
 * Codex P1 #1: checklist items must NOT arrive pre-attested. The route
 * coerces every `checked` to `false` before issuing — supervisors attest
 * in the separate sign step.
 */
const workPermitCreateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'altura',
    'caliente',
    'confinado',
    'loto',
    'excavacion',
    'izaje_critico',
  ]),
  /** Optional self-assignment hint. Defaults to the caller's uid. */
  workerUid: z.string().min(1).optional(),
  zoneId: z.string().optional(),
  taskDescription: z.string().min(3).max(4000),
  durationHours: z.number().positive().max(24),
  preconditions: z
    .object({
      workerHasTraining: z.boolean().optional(),
      workerHasEpp: z.boolean().optional(),
      workerMedicallyFit: z.boolean().optional(),
      checklist: z
        .object({
          items: z.array(checklistItemSchema),
        })
        .optional(),
    })
    .optional(),
});

const PERMIT_ISSUER_ROLES: ReadonlySet<string> = new Set([
  'supervisor',
  'prevencionista',
  'gerente',
  'admin',
]);

interface CallerRoleContext {
  /** Best-known role string from claims (`role` or first of `roles[]`). */
  role: string | null;
  /** True if the caller has a custom claim authorizing permit issuance. */
  canIssuePermits: boolean;
}

function resolveCallerRoleContext(
  user: Express.PraeventioAuthUser,
): CallerRoleContext {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const primaryRole = typeof user.role === 'string' && user.role.length > 0 ? user.role : null;
  // Admin = supervisor-level (legacy claim).
  if (user.admin === true) {
    return { role: primaryRole ?? 'admin', canIssuePermits: true };
  }
  if (primaryRole && PERMIT_ISSUER_ROLES.has(primaryRole)) {
    return { role: primaryRole, canIssuePermits: true };
  }
  for (const r of roles) {
    if (typeof r === 'string' && PERMIT_ISSUER_ROLES.has(r)) {
      return { role: r, canIssuePermits: true };
    }
  }
  return { role: primaryRole, canIssuePermits: false };
}

router.post(
  '/:projectId/work-permits',
  verifyAuth,
  validate(workPermitCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof workPermitCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const ctx = resolveCallerRoleContext(req.user!);
    // Codex P1 #2: gate permit issuance on the caller's *real* role, never
    // the body's `approverRole` claim. Workers (no issuer role) can request
    // a permit only if they're auto-assigned as worker AND the route falls
    // back to draft status — but the current engine path emits 'active'
    // immediately, so for now we reject any caller who isn't an authorized
    // issuer. The follow-up E.1 work splits draft/active.
    if (!ctx.canIssuePermits) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_permit_issuer_role',
      });
    }
    // The worker assignment defaults to the caller's uid; an issuer may
    // assign a different worker by passing a workerUid hint in the body.
    const workerUid =
      typeof body.workerUid === 'string' && body.workerUid.length > 0
        ? body.workerUid
        : callerUid;
    try {
      // Codex P1 #1: `createPendingPermit` ignores any checklist or
      // precondition flags the client sent and seeds the canonical
      // unchecked template for the kind. The permit lands in
      // 'pending_approval'; only the /sign endpoint can flip it to
      // 'active', and only after the supervisor attests every item.
      const permit = createPendingPermit({
        id: body.id,
        kind: body.kind,
        // Server-trusted issuer identity (Codex P1 #2):
        workerUid,
        approverUid: callerUid,
        approverRole: ctx.role ?? 'supervisor',
        zoneId: body.zoneId,
        taskDescription: body.taskDescription,
        // Stub preconditions — `createPendingPermit` overwrites them
        // with all-false anyway; the type just requires the shape.
        preconditions: {
          workerHasTraining: false,
          workerHasEpp: false,
          workerMedicallyFit: false,
          checklist: { items: [] },
        },
        durationHours: body.durationHours,
      });
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      // Codex P2 #4: `adapter.create()` fails with WorkPermitDuplicateError
      // if the id already exists, so a colliding id never silently erases
      // a fulfilled/cancelled doc.
      await adapter.create(permit);
      return res.status(201).json({ permit });
    } catch (err) {
      if (err instanceof WorkPermitDuplicateError) {
        return res
          .status(409)
          .json({ error: 'permit_id_duplicate', permitId: err.permitId });
      }
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({ error: 'validation_error', code: err.code, message: err.message });
      }
      logger.error?.('sprintK.workPermits.create.error', err);
      captureRouteError(err, 'sprintK.workPermits.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

/**
 * Sign payload schema. Codex P1 #1: the supervisor's attestation lives on
 * the SIGN request, not the create request — so the permit's status
 * transition from pending_approval → active is gated on this body. Empty
 * body (legacy callers) is permitted to keep backward compatibility but
 * will fail the engine's attestation check.
 */
const signPermitSchema = z
  .object({
    workerHasTraining: z.boolean().optional(),
    workerHasEpp: z.boolean().optional(),
    workerMedicallyFit: z.boolean().optional(),
    /** Labels the supervisor confirms as checked. */
    checkedLabels: z.array(z.string()).optional(),
  })
  .optional();

router.post(
  '/:projectId/work-permits/:permitId/sign',
  verifyAuth,
  validate(signPermitSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, permitId } = req.params;
    const body = (req.body ?? {}) as z.infer<typeof signPermitSchema> & object;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const ctx = resolveCallerRoleContext(req.user!);
    // Only an authorized issuer can sign a permit into 'active'.
    if (!ctx.canIssuePermits) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_permit_issuer_role',
      });
    }
    try {
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      const permit = await adapter.getById(permitId);
      if (!permit) return res.status(404).json({ error: 'not_found' });

      // For backward compatibility, callers that sent an empty body get
      // their attestation derived from the persisted permit (which is
      // safe only if the create path also seeded it from the supervisor's
      // own UI — but the new create path seeds it as all-false, so a
      // legacy empty-body sign request will fail attestation as expected).
      const checkedLabels = body?.checkedLabels ??
        permit.preconditions.checklist.items
          .filter((i) => i.checked)
          .map((i) => i.label);
      const attestation = {
        workerHasTraining:
          body?.workerHasTraining ?? permit.preconditions.workerHasTraining,
        workerHasEpp: body?.workerHasEpp ?? permit.preconditions.workerHasEpp,
        workerMedicallyFit:
          body?.workerMedicallyFit ?? permit.preconditions.workerMedicallyFit,
        checkedLabels,
      };

      // If the permit is already 'active' (legacy issuePermit path), treat
      // sign as an explicit re-acknowledgement: bump approvedAt to now.
      // Otherwise, attest + flip to active via the engine.
      const next: WorkPermit =
        permit.status === 'active'
          ? { ...permit, approvedAt: new Date().toISOString() }
          : attestAndIssuePermit(permit, attestation);
      await adapter.save(next);
      return res.json({ permit: next });
    } catch (err) {
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({ error: 'validation_error', code: err.code, message: err.message });
      }
      logger.error?.('sprintK.workPermits.sign.error', err);
      captureRouteError(err, 'sprintK.workPermits.sign');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const closePermitSchema = z.object({
  reason: z.string().min(10).max(2000),
  /** 'fulfill' = trabajo cumplido; 'cancel' = anulación. Default: fulfill. */
  outcome: z.enum(['fulfill', 'cancel']).optional(),
});

router.post(
  '/:projectId/work-permits/:permitId/close',
  verifyAuth,
  validate(closePermitSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, permitId } = req.params;
    const body = req.body as z.infer<typeof closePermitSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new WorkPermitAdapter({
        db: admin.firestore() as any,
        tenantId: g.tenantId,
        projectId,
      });
      const permit = await adapter.getById(permitId);
      if (!permit) return res.status(404).json({ error: 'not_found' });

      // Codex P2 #6: expired permits remain stored as `status: 'active'`
      // until the cron materializes the expiry. Closing one as 'fulfill'
      // would dishonestly report expired work as completed. Derive first;
      // refuse the close if the engine considers the permit already
      // expired (or already terminal). The caller can re-sign first if
      // they want to extend.
      const now = new Date();
      const derived = deriveStatus(permit, now);
      if (derived === 'expired') {
        return res.status(422).json({
          error: 'permit_already_expired',
          hint: 'extend the validity (re-sign) or omit this close call; expired permits cannot be marked as fulfilled or cancelled',
        });
      }
      if (derived === 'cancelled' || derived === 'fulfilled') {
        return res.status(422).json({
          error: 'permit_already_terminal',
          status: derived,
        });
      }

      const outcome = body.outcome ?? 'fulfill';
      const next =
        outcome === 'cancel'
          ? cancelPermit(permit, body.reason, now)
          : fulfillPermit(permit, now);
      await adapter.save(next);
      return res.json({ permit: next });
    } catch (err) {
      if (err instanceof WorkPermitValidationError) {
        return res.status(400).json({ error: 'validation_error', code: err.code, message: err.message });
      }
      logger.error?.('sprintK.workPermits.close.error', err);
      captureRouteError(err, 'sprintK.workPermits.close');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);
// ─────────────────────────────────────────────────────────────────────
// Fase F.20 — Gestor de Simulacros
// ─────────────────────────────────────────────────────────────────────
//
// Wires the deterministic `drillsManager` service to a project-scoped
// CRUD surface so the prevencionista can:
//   1. Planificar el próximo simulacro (DS 132 / DS 594 calendar).
//   2. Registrar la ejecución (participantes, tiempos, brechas).
//   3. Ver el reporte de preparación (excellent → critical) calculado
//      por `evaluateDrillResult` — sin LLM, 100% determinístico.
//
// Storage path: `tenants/{tid}/projects/{pid}/drills/{drillId}`.
// One document per simulacro: holds the plan, optional execution
// payload, and the cached `DrillReadinessReport` (recomputed on each
// execute call so a re-grading reflects fresh data).
//
// Status machine (server-authoritative):
//   planned       → on plan()
//   in_progress   → manual transition (out of scope for now; reserved)
//   completed     → on execute() once result is recorded
//   cancelled     → manual transition (out of scope; reserved)

const DRILL_KINDS = [
  'evacuation',
  'fire',
  'spill_chemical',
  'first_aid',
  'rescue_confined',
  'rescue_height',
  'gas_leak',
  'earthquake',
] as const;
type DrillKind = (typeof DRILL_KINDS)[number];

const DRILL_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'cancelled',
] as const;
type DrillStatus = (typeof DRILL_STATUSES)[number];

interface StoredDrill {
  id: string;
  kind: DrillKind;
  scheduledAt: string;
  responsibleUid: string;
  status: DrillStatus;
  title?: string;
  location?: string;
  expectedCount?: number;
  benchmarkSeconds?: number;
  createdAt: string;
  createdBy: string;
  // Execution + report (populated on execute()).
  executedAt?: string;
  participantCount?: number;
  responseTimeSeconds?: number;
  observedGaps?: string[];
  requiredExternal?: boolean;
  notes?: string;
  report?: {
    /**
     * `null` cuando el baseline (`expectedCount`) no estaba registrado en
     * el plan y la ejecución tampoco lo aportó. La UI muestra "—" en ese
     * caso en vez de un porcentaje engañoso. (Codex PR #316 P2.)
     */
    participationRate: number | null;
    /** `null` cuando `benchmarkSeconds` no se registró. */
    speedDeficitPercent: number | null;
    level:
      | 'excellent'
      | 'good'
      | 'needs_improvement'
      | 'critical'
      | 'insufficient_baseline';
    recommendations: string[];
  };
}

router.get('/:projectId/drills', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const status =
      typeof req.query.status === 'string' &&
      (DRILL_STATUSES as readonly string[]).includes(req.query.status)
        ? (req.query.status as DrillStatus)
        : null;
    const kind =
      typeof req.query.kind === 'string' &&
      (DRILL_KINDS as readonly string[]).includes(req.query.kind)
        ? (req.query.kind as DrillKind)
        : null;

    // Best-effort partial read — the page still renders if the query
    // throws (e.g. missing composite index in a brand-new tenant). The
    // user sees an empty list instead of a stack trace.
    const safeRead = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.('sprintK.drills.list.read_failed', err);
        return [];
      }
    };

    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/drills`,
    );

    const drills = await safeRead<StoredDrill>(async () => {
      let q: admin.firestore.Query = baseRef;
      if (status) q = q.where('status', '==', status);
      if (kind) q = q.where('kind', '==', kind);
      // Codex PR #316 P2 (line 1168): ordenar ANTES del limit para que
      // proyectos con >200 simulacros vean los más recientes. Antes
      // Firestore devolvía los primeros 200 IDs (ascending) y los
      // simulacros nuevos quedaban invisibles.
      const snap = await q.orderBy('createdAt', 'desc').limit(200).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StoredDrill, 'id'>) }));
    });

    return res.json({ drills });
  } catch (err) {
    logger.error?.('sprintK.drills.list.error', err);
    captureRouteError(err, 'sprintK.drills.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/:projectId/drills/:drillId', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, drillId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const docRef = db
      .collection(`tenants/${g.tenantId}/projects/${projectId}/drills`)
      .doc(drillId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'drill_not_found' });
    }
    const drill: StoredDrill = {
      id: snap.id,
      ...(snap.data() as Omit<StoredDrill, 'id'>),
    };
    return res.json({ drill });
  } catch (err) {
    logger.error?.('sprintK.drills.get.error', err);
    captureRouteError(err, 'sprintK.drills.get');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const drillPlanSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(DRILL_KINDS),
  scheduledAt: z.string().min(10),
  responsibleUid: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  location: z.string().min(1).max(200).optional(),
  expectedCount: z.number().int().nonnegative().optional(),
  benchmarkSeconds: z.number().int().positive().optional(),
});

router.post(
  '/:projectId/drills/plan',
  verifyAuth,
  validate(drillPlanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof drillPlanSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const payload: StoredDrill = {
        id: body.id,
        kind: body.kind,
        scheduledAt: body.scheduledAt,
        responsibleUid: body.responsibleUid,
        status: 'planned',
        title: body.title,
        location: body.location,
        expectedCount: body.expectedCount,
        benchmarkSeconds: body.benchmarkSeconds,
        createdAt: now,
        createdBy: callerUid,
      };
      // Strip undefined fields — Firestore rejects them.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/drills`)
        .doc(body.id)
        .set(cleaned, { merge: true });
      return res.status(201).json({ ok: true, drill: payload });
    } catch (err) {
      logger.error?.('sprintK.drills.plan.error', err);
      captureRouteError(err, 'sprintK.drills.plan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const drillExecuteSchema = z.object({
  executedAt: z.string().min(10),
  participantCount: z.number().int().nonnegative(),
  expectedCount: z.number().int().nonnegative().optional(),
  responseTimeSeconds: z.number().int().nonnegative(),
  benchmarkSeconds: z.number().int().positive().optional(),
  observedGaps: z.array(z.string().min(1).max(500)).max(50).optional(),
  requiredExternal: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
});

router.post(
  '/:projectId/drills/:drillId/execute',
  verifyAuth,
  validate(drillExecuteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, drillId } = req.params;
    const body = req.body as z.infer<typeof drillExecuteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { evaluateDrillResult } = await import(
        '../../services/drillsManager/drillsManager.js'
      );
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/drills`)
        .doc(drillId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'drill_not_found' });
      }
      const existing = snap.data() as Omit<StoredDrill, 'id'>;
      // Codex PR #316 P2 (line 1300): NO defaulteamos a `participantCount`
      // / `responseTimeSeconds`. Si el plan no registró `expectedCount`
      // o `benchmarkSeconds` y la ejecución tampoco los aportó, el
      // baseline queda `undefined` y `evaluateDrillResult` retorna
      // `insufficient_baseline` con una recomendación explícita en vez
      // de calificar como "Excelente" por falta de baseline. La execute
      // payload sigue pudiendo sobrescribir el plan.
      const expectedCount = body.expectedCount ?? existing.expectedCount;
      const benchmarkSeconds = body.benchmarkSeconds ?? existing.benchmarkSeconds;
      const observedGaps = body.observedGaps ?? [];
      const requiredExternal = body.requiredExternal ?? false;

      const report = evaluateDrillResult({
        id: drillId,
        drillKind: existing.kind,
        executedAt: body.executedAt,
        participantCount: body.participantCount,
        ...(typeof expectedCount === 'number' ? { expectedCount } : {}),
        responseTimeSeconds: body.responseTimeSeconds,
        ...(typeof benchmarkSeconds === 'number' ? { benchmarkSeconds } : {}),
        observedGaps,
        requiredExternal,
      });

      const update: Partial<StoredDrill> = {
        status: 'completed',
        executedAt: body.executedAt,
        participantCount: body.participantCount,
        expectedCount,
        responseTimeSeconds: body.responseTimeSeconds,
        benchmarkSeconds,
        observedGaps,
        requiredExternal,
        notes: body.notes,
        report: {
          participationRate: report.participationRate,
          speedDeficitPercent: report.speedDeficitPercent,
          level: report.level,
          recommendations: report.recommendations,
        },
      };
      // Strip undefined fields.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(update)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await docRef.set(cleaned, { merge: true });

      // Return the merged drill so the client doesn't need a follow-up
      // GET to refresh its panel.
      const after = await docRef.get();
      const merged: StoredDrill = {
        id: after.id,
        ...(after.data() as Omit<StoredDrill, 'id'>),
      };
      return res.status(200).json({ ok: true, drill: merged });
    } catch (err) {
      logger.error?.('sprintK.drills.execute.error', err);
      captureRouteError(err, 'sprintK.drills.execute');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Fase F.7 — Minuta automática Comité Paritario (CPHS)
// ─────────────────────────────────────────────────────────────────────
//
// Construye el "borrador estructurado mensual" que el CPHS revisa antes
// de firmar el acta definitiva. Cruza incidentes del período, acciones
// correctivas (F.4), capacitaciones impartidas, inspecciones realizadas
// y score semáforo (F.2) en un MarkDown determinístico vía
// `buildMonthlyMinuteDraft` (sin LLM — la pasada Gemini opcional para
// pulir redacción queda fuera de scope F.7).
//
// El servicio es puro y testable; el endpoint solo orquesta las
// lecturas Firestore + mapea al shape `MonthlyInputs` que el motor
// espera. Si cualquiera de los feeds falla por permisos / colección
// inexistente, el endpoint sigue produciendo el borrador con datos
// parciales — el campo `completenessScore` del draft alerta al
// prevencionista de qué falta antes de aprobar.

router.get('/:projectId/cphs/draft-minute', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { buildMonthlyMinuteDraft } = await import(
      '../../services/cphs/cphsMinuteAutogenerator.js'
    );

    const db = admin.firestore();

    // Período: último mes calendario completo (UTC). El CPHS sesiona
    // sobre el mes anterior; usar UTC evita off-by-one por zona horaria
    // del servidor cuando estamos cerca del cambio de mes.
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    // "YYYY-MM" del mes que cubre el borrador (mes anterior al actual).
    const periodLabel = `${monthStart.getUTCFullYear()}-${String(
      monthStart.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    // Best-effort wrapper — cada feed envuelto para que un fallo de
    // permisos o colección ausente no blanquee el borrador completo.
    // El draft producido refleja honestamente los datos disponibles.
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.cphs.${label}.fetch_failed`, err);
        return [];
      }
    };

    // Resolve project metadata for the minute header (companyName).
    // The Project doc lives top-level under `projects/{id}` — same
    // path used by ProjectContext + every other Sprint K endpoint.
    let companyName = 'Empresa';
    let expectedAttendees: string[] = [];

    // Codex P2 PR #317 round 2: source-of-truth para asistentes es
    // `cphs_committees` (escrito por `services/cphs/cphsService.ts`
    // cuando el prevencionista constituye el comité). El project doc
    // sólo guarda overrides ad-hoc (proyectos sin módulo CPHS formal).
    // Estrategia: primero pedimos el comité ACTIVO del proyecto y
    // mapeamos `members[].fullName`; si no existe, caemos al lookup
    // legacy en el doc del proyecto (cphsAttendees / cphsMembers).
    try {
      const committeesSnap = await db
        .collection('cphs_committees')
        .where('projectId', '==', projectId)
        .where('status', '==', 'active')
        .limit(5)
        .get();
      if (!committeesSnap.empty) {
        // Concat members[].fullName from every active committee del proyecto.
        // Normal es 1, pero defensivo por si quedan duplicados de migraciones.
        const seen = new Set<string>();
        const collected: string[] = [];
        for (const doc of committeesSnap.docs) {
          const data = doc.data() as { members?: unknown };
          if (!Array.isArray(data.members)) continue;
          for (const m of data.members) {
            if (!m || typeof m !== 'object') continue;
            const full = (m as { fullName?: unknown }).fullName;
            if (typeof full === 'string' && full.length > 0 && !seen.has(full)) {
              seen.add(full);
              collected.push(full);
            }
          }
        }
        if (collected.length > 0) {
          expectedAttendees = collected;
        }
      }
    } catch (err) {
      logger.warn?.('sprintK.cphs.committees.fetch_failed', err);
      // No-op: caemos al lookup legacy en el doc del proyecto abajo.
    }
    // Codex P2 PR #317: el draft anterior hard-codeaba
    // complianceTrafficLightScore=0 — eso pintaba 🔴 0/100 en todos
    // los borradores y disparaba un "Plan de mejora cumplimiento" falso
    // para proyectos que en realidad estaban verdes. Ahora leemos el
    // campo `complianceScore` que `projects/{id}` ya mantiene
    // (mismo dato consumido por insights.role_view); si no existe
    // (proyecto nuevo / F.2 aún no corrió), pasamos `undefined` al
    // motor y el draft omite la sección con un mensaje explícito
    // ("no disponible") en vez de un cero engañoso.
    let complianceTrafficLightScore: number | undefined;
    try {
      const projDoc = await db.collection('projects').doc(projectId).get();
      const projData = projDoc.exists ? projDoc.data() : null;
      if (projData) {
        if (
          typeof projData.companyName === 'string' &&
          projData.companyName.length > 0
        ) {
          companyName = projData.companyName;
        } else if (
          typeof projData.name === 'string' &&
          projData.name.length > 0
        ) {
          companyName = projData.name;
        }
        // Legacy fallback (Codex P2 PR #317 round 2): SOLO si el
        // lookup anterior a `cphs_committees` no devolvió miembros.
        // Aceptamos shapes ad-hoc del project doc:
        //   - `cphsAttendees: string[]` (display names)
        //   - `cphsMembers:   Array<{ displayName?: string; fullName?: string }>`
        // Si absent, we leave the array empty and the draft's
        // completeness score will flag it.
        if (expectedAttendees.length === 0) {
          if (Array.isArray(projData.cphsAttendees)) {
            expectedAttendees = projData.cphsAttendees.filter(
              (v: unknown): v is string =>
                typeof v === 'string' && v.length > 0,
            );
          } else if (Array.isArray(projData.cphsMembers)) {
            expectedAttendees = projData.cphsMembers
              .map((m: unknown) => {
                if (!m || typeof m !== 'object') return '';
                // Aceptamos `fullName` (shape canónico del módulo CPHS)
                // o `displayName` (legacy del project doc).
                const candidate =
                  (m as { fullName?: unknown }).fullName ??
                  (m as { displayName?: unknown }).displayName;
                return typeof candidate === 'string' ? candidate : '';
              })
              .filter((s: string) => s.length > 0);
          }
        }
        // Best-effort compliance score lookup. Aceptamos formato número
        // (0-100) o objeto cache `{ score, computedAt }`. Cualquier
        // otro shape → undefined (template lo omite).
        const rawScore = projData.complianceScore;
        if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
          complianceTrafficLightScore = clampScore(rawScore);
        } else if (
          rawScore &&
          typeof rawScore === 'object' &&
          typeof (rawScore as { score?: unknown }).score === 'number'
        ) {
          complianceTrafficLightScore = clampScore(
            (rawScore as { score: number }).score,
          );
        }
      }
    } catch (err) {
      logger.warn?.('sprintK.cphs.project.fetch_failed', err);
    }

    // ── Incidents (último mes completo) ──
    // `incidents` es top-level filtrado por `projectId`. Aceptamos
    // tanto `occurredAt` como `createdAt` como timestamp del evento
    // (cohabitación legacy + nuevo writer). Filtramos cliente-side
    // sobre los del proyecto para evitar requerir índice compuesto
    // `(projectId, occurredAt)` que algunos despliegues no tienen.
    //
    // Codex P2 PR #317: el .limit(500) sobre una colección sin orden
    // explícito puede devolver registros document-id-ordered y omitir
    // los recientes (el mes que el CPHS necesita). Pedimos ordenado
    // por `occurredAt desc` para que la "tail" más reciente caiga
    // siempre dentro de los 500 — luego filtramos al mes objetivo.
    //
    // Codex P2 PR #317 round 2:
    //   1. `orderBy('occurredAt')` filtra a documentos que tengan ese
    //      campo, y los incidentes legacy / capturados vía SafetyFeed
    //      sólo tienen `createdAt`. Si el query ordenado vuelve vacío
    //      (caso típico: proyecto con sólo registros createdAt-only),
    //      caemos al query sin orden — el catch original sólo cubría
    //      FAILED_PRECONDITION, no el "0 docs porque el campo no existe".
    //   2. El writer canónico de la app (SafetyFeed + Telemetry) crea
    //      `NodeType.INCIDENT` en la colección `nodes`, no en
    //      `/incidents`. Leemos ambas colecciones y deduplicamos por id
    //      para que el draft refleje todos los incidentes que el resto
    //      del sistema considera reales. La normalización del shape
    //      (severity / description / rootCause) maneja la diferencia
    //      entre `nodes` (severity en metadata.criticidad) e `incidents`
    //      (severity al top-level).
    // Si Firestore lanza FAILED_PRECONDITION (índice (projectId,
    // occurredAt) no creado en este despliegue), caemos al query
    // sin orderBy + filtro client-side. El catch del safeRead no nos
    // sirve para distinguir índice-faltante de error real; lo hacemos
    // inline. TODO: cursor-based pagination para proyectos con >500
    // incidentes/mes (extremadamente raro en práctica — el promedio
    // está bajo 20).
    const incidents = await safeRead<Record<string, unknown>>(
      'incidents',
      async () => {
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();

        // (a) Read /incidents (legacy / API writer).
        const baseIncidentsQuery = db
          .collection('incidents')
          .where('projectId', '==', projectId);
        let incidentsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          const orderedSnap = await baseIncidentsQuery
            .orderBy('occurredAt', 'desc')
            .limit(500)
            .get();
          // Si el ordered devuelve vacío puede ser porque la colección
          // legacy guarda sólo `createdAt`. Sin un segundo query no
          // distinguimos "0 incidentes reales" de "0 con campo
          // occurredAt"; el costo de un read extra a una collection
          // ya consultada es despreciable y nos asegura no perder
          // documentos createdAt-only.
          if (orderedSnap.empty) {
            incidentsSnap = await baseIncidentsQuery.limit(500).get();
          } else {
            incidentsSnap = orderedSnap;
          }
        } catch (orderErr) {
          // Índice compuesto faltante: degradamos a query sin orderBy
          // (mismo comportamiento que tenía esta ruta antes del fix).
          // El draft saldrá igual cuando el proyecto tiene <500
          // incidentes totales — que es el caso normal.
          logger.warn?.(
            'sprintK.cphs.incidents.orderBy_failed_fallback_unordered',
            orderErr,
          );
          incidentsSnap = await baseIncidentsQuery.limit(500).get();
        }

        // (b) Read /nodes filtered to NodeType.INCIDENT — fuente real
        //     del SafetyFeed/Telemetry/CPHS alert trigger. El enum
        //     `NodeType.INCIDENT` se persiste literal como 'Incidente'
        //     en `nodes[].type` (ver src/types/index.ts).
        let nodeIncidentsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          nodeIncidentsSnap = await db
            .collection('nodes')
            .where('projectId', '==', projectId)
            .where('type', '==', 'Incidente')
            .limit(500)
            .get();
        } catch (nodesErr) {
          logger.warn?.(
            'sprintK.cphs.incidents.nodes_query_failed',
            nodesErr,
          );
          nodeIncidentsSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        // Normalize node-shape to incident-shape: la severidad vive
        // en `metadata.criticidad` ('Baja'|'Media'|'Alta'|'Crítica');
        // la fecha del evento es `createdAt` (string ISO) — el nodo
        // no expone `occurredAt`. Esto pasa por `normSeverity` abajo
        // que ya tolera tanto las claves español como inglés.
        const nodeIncidents: Record<string, unknown>[] =
          nodeIncidentsSnap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            const metadata =
              (data.metadata as Record<string, unknown> | undefined) ?? {};
            const criticidad =
              typeof metadata.criticidad === 'string'
                ? metadata.criticidad
                : typeof data.severity === 'string'
                  ? data.severity
                  : undefined;
            return {
              id: d.id,
              ...data,
              severity: criticidad ?? data.severity,
              // El motor usa `description` como label; nodes lo
              // tienen al top-level, pero algunos legacy sólo en
              // metadata.context — fallback defensivo.
              description:
                typeof data.description === 'string'
                  ? data.description
                  : typeof (metadata.context as unknown) === 'string'
                    ? (metadata.context as string)
                    : typeof data.title === 'string'
                      ? data.title
                      : 'Sin descripción',
            };
          });

        const incidentDocs: Record<string, unknown>[] = incidentsSnap.docs.map(
          (d) => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          }),
        );

        // Dedupe by id — un proyecto puede tener ambos shapes (writer
        // legacy + writer nuevo) durante la transición; preferimos el
        // shape canónico de `incidents` cuando hay colisión.
        const byId = new Map<string, Record<string, unknown>>();
        for (const n of nodeIncidents) byId.set(String(n.id), n);
        for (const i of incidentDocs) byId.set(String(i.id), i);
        const combined = Array.from(byId.values());

        return combined.filter((doc) => {
          // Aceptamos `occurredAt` (writer canónico /incidents) o
          // `createdAt` (legacy + nodes). NO descartamos por falta de
          // `occurredAt` — esa era la regresión que Codex flagged.
          const ts =
            (typeof doc.occurredAt === 'string' ? doc.occurredAt : null) ??
            (typeof doc.createdAt === 'string' ? doc.createdAt : null);
          if (!ts) return false;
          const t = Date.parse(ts);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        });
      },
    );

    // ── Corrective actions ── (full set: open + in_progress + closed +
    //    verified + verified_effective + reopened). El servicio acepta
    //    todos los status; el motor cphs los proyecta al enum de la
    //    minuta (open|closed|verified|verified_effective).
    //
    // Codex P2 PR #317:
    //   1. Incluimos `verified_effective` (F.11 terminal state) — antes
    //      quedaba fuera y `closedActionsCount` subreportaba PDCA real.
    //   2. Aumentamos el limit por status a 1000 (vs default 200 del
    //      adapter) — para proyectos con backlog grande, 200 truncaba
    //      acciones legítimas del período y la minuta perdía evidencia.
    //      1000 cubre prácticamente el 100% de casos reales; para
    //      cuadrillas/sitios con backlogs >1000 abiertos en un sólo
    //      status, el indicador subreporta pero el resto del draft es
    //      honest — el cursor-based pagination queda en TODO sub-PR.
    const ACTIONS_PAGE = 1000;
    const correctiveActions = await safeRead<Record<string, unknown>>(
      'correctiveActions',
      async () => {
        const adapter = new CorrectiveActionsAdapter(
          db as any,
          g.tenantId,
          projectId,
        );
        const [
          openA,
          inProgressA,
          closedA,
          verifiedA,
          verifiedEffectiveA,
          reopenedA,
        ] = await Promise.all([
          adapter.listByStatus('open', ACTIONS_PAGE).catch(() => []),
          adapter
            .listByStatus('in_progress', ACTIONS_PAGE)
            .catch(() => []),
          adapter.listByStatus('closed', ACTIONS_PAGE).catch(() => []),
          adapter.listByStatus('verified', ACTIONS_PAGE).catch(() => []),
          adapter
            .listByStatus('verified_effective', ACTIONS_PAGE)
            .catch(() => []),
          adapter.listByStatus('reopened', ACTIONS_PAGE).catch(() => []),
        ]);
        return [
          ...openA,
          ...inProgressA,
          ...closedA,
          ...verifiedA,
          ...verifiedEffectiveA,
          ...reopenedA,
        ] as unknown as Record<string, unknown>[];
      },
    );

    // ── Trainings impartidas. Top-level `training` collection
    //    filtrada por `projectId`. ──
    //
    // Codex P2 PR #317: el writer de Training.tsx escribe
    // `status: 'scheduled'` + `date: ISO` al crear la sesión y la
    // muta a `'completed'` al cerrar (vía `updateDoc`). El draft
    // CPHS mensual debe contar SOLO sesiones efectivamente impartidas
    // en el mes objetivo — no las agendadas a futuro ni las
    // canceladas. Filtramos client-side por `status === 'completed'`
    // Y por `date` dentro de la ventana mensual (mismo periodo que
    // los incidentes), para evitar inflar el indicador con
    // capacitaciones legacy de meses anteriores.
    //
    // Codex P2 PR #317 round 2:
    //   1. El `.limit(500)` sin orderBy podía devolver una "ventana"
    //      document-id-ordered y omitir las sesiones recientes — el
    //      mismo problema que vimos en incidents. Pedimos
    //      `orderBy('date', 'desc')` para que la cola más reciente
    //      siempre caiga adentro, y degradamos a query sin orden si
    //      falta el índice compuesto.
    //   2. Filtramos por `completedAt` cuando existe (writer nuevo),
    //      y caemos a `date` SÓLO como compat — pero exigimos que la
    //      fecha de schedule también caiga en la ventana del mes, para
    //      no contar sesiones agendadas previo al mes que se
    //      completaron en otro periodo. Es la mejor heurística sin
    //      backfill: el sub-PR siguiente actualiza Training.tsx para
    //      escribir `completedAt: serverTimestamp()` al cerrar (ver
    //      handleCompleteVideo) y a partir de ahí el draft preferirá
    //      ese timestamp.
    const trainings = await safeRead<Record<string, unknown>>(
      'trainings',
      async () => {
        const baseQuery = db
          .collection('training')
          .where('projectId', '==', projectId);
        let snap: FirebaseFirestore.QuerySnapshot;
        try {
          snap = await baseQuery
            .orderBy('date', 'desc')
            .limit(500)
            .get();
        } catch (orderErr) {
          // Índice compuesto faltante: degradamos a query sin orderBy
          // (mismo comportamiento previo). Para proyectos con <500
          // trainings totales esto sigue siendo correcto; el riesgo
          // sólo aparece con backlogs masivos sin índice.
          logger.warn?.(
            'sprintK.cphs.trainings.orderBy_failed_fallback_unordered',
            orderErr,
          );
          snap = await baseQuery.limit(500).get();
        }
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();
        const all: Record<string, unknown>[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
        return all.filter((doc) => {
          if (doc.status !== 'completed') return false;
          // Preferimos `completedAt` (writer nuevo) — ese es el
          // timestamp REAL de cuándo se impartió. Si no existe,
          // caemos a `date` (writer legacy: fecha de schedule).
          // Sólo contamos el training si el timestamp resultante
          // cae en la ventana del mes objetivo.
          const ts =
            (typeof doc.completedAt === 'string'
              ? doc.completedAt
              : null) ??
            (typeof doc.date === 'string' ? doc.date : null);
          if (!ts) return false;
          const t = Date.parse(ts);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        });
      },
    );

    // ── Inspections realizadas. ──
    //
    // Codex P2 PR #317 round 2: el writer canónico de la app
    // (`SafetyInspection.tsx` + `AddAuditModal.tsx`) crea
    // `NodeType.AUDIT` en la colección `nodes` (no en `/audits`).
    // Antes la ruta sólo leía `/audits`, así que proyectos con flujo
    // estándar obtenían `inspectionsCompleted: 0` aunque el dashboard
    // mostraba inspecciones reales. Además, cualquier audit histórico
    // o futuro inflaba el contador porque no había filtro por estado
    // ni por ventana mensual.
    //
    // Cambios:
    //   1. Leemos AMBAS colecciones: `nodes` (type='Auditoría' literal
    //      del enum, ver src/types/index.ts) y `/audits` (legacy).
    //   2. Filtramos al mismo `[monthStart, monthEnd)` que incidentes
    //      y trainings — sólo cuentan inspecciones EJECUTADAS en el
    //      período del borrador, no programadas para más tarde.
    //   3. Filtramos por estado: 'Completado' (writer SafetyInspection)
    //      o equivalentes ('completed', 'ejecutada'). El writer
    //      AddAuditModal escribe `metadata.status: 'Planificada'`
    //      cuando se agenda; ese estado NO debe contar.
    //   4. Dedupe por id para tolerar despliegues mixtos.
    const inspections = await safeRead<Record<string, unknown>>(
      'inspections',
      async () => {
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();

        // (a) Read /nodes filtered to NodeType.AUDIT (canonical writer).
        let nodesSnap: FirebaseFirestore.QuerySnapshot;
        try {
          nodesSnap = await db
            .collection('nodes')
            .where('projectId', '==', projectId)
            .where('type', '==', 'Auditoría')
            .limit(500)
            .get();
        } catch (nodesErr) {
          logger.warn?.(
            'sprintK.cphs.inspections.nodes_query_failed',
            nodesErr,
          );
          nodesSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        // (b) Read /audits (legacy collection).
        let auditsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          auditsSnap = await db
            .collection('audits')
            .where('projectId', '==', projectId)
            .limit(500)
            .get();
        } catch (auditsErr) {
          logger.warn?.(
            'sprintK.cphs.inspections.audits_query_failed',
            auditsErr,
          );
          auditsSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        const isCompletedStatus = (raw: unknown): boolean => {
          if (typeof raw !== 'string') return false;
          const s = raw.toLowerCase();
          return (
            s === 'completado' ||
            s === 'completada' ||
            s === 'completed' ||
            s === 'ejecutada' ||
            s === 'ejecutado'
          );
        };

        const isInPeriod = (raw: unknown): boolean => {
          if (typeof raw !== 'string') return false;
          const t = Date.parse(raw);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        };

        // Normalize node-shape to inspection-shape: estado / fecha
        // viven en `metadata.status` y `metadata.date` (writers
        // SafetyInspection/AddAuditModal), y la fecha de creación
        // del documento es `createdAt` (string ISO escrito por
        // useRiskEngine o un serverTimestamp).
        const fromNodes: Record<string, unknown>[] = nodesSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const metadata =
              (data.metadata as Record<string, unknown> | undefined) ?? {};
            const status =
              (metadata.status as unknown) ?? (data.status as unknown);
            const dateField =
              (metadata.date as unknown) ??
              (data.completedAt as unknown) ??
              (data.createdAt as unknown);
            return {
              id: d.id,
              status,
              date: dateField,
              raw: data,
            };
          })
          .filter(
            (doc) =>
              isCompletedStatus(doc.status) && isInPeriod(doc.date),
          );

        const fromAudits: Record<string, unknown>[] = auditsSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const status =
              (data.status as unknown) ??
              ((data.metadata as Record<string, unknown> | undefined)
                ?.status as unknown);
            const dateField =
              (data.completedAt as unknown) ??
              (data.date as unknown) ??
              (data.createdAt as unknown) ??
              ((data.metadata as Record<string, unknown> | undefined)
                ?.date as unknown);
            return {
              id: d.id,
              status,
              date: dateField,
              raw: data,
            };
          })
          .filter(
            (doc) =>
              isCompletedStatus(doc.status) && isInPeriod(doc.date),
          );

        // Dedupe by id — un proyecto puede tener ambos shapes durante
        // la transición; preferimos el shape canónico de `audits`
        // cuando hay colisión.
        const byId = new Map<string, Record<string, unknown>>();
        for (const n of fromNodes) byId.set(String(n.id), n);
        for (const a of fromAudits) byId.set(String(a.id), a);
        return Array.from(byId.values());
      },
    );

    // ── Map al shape `MonthlyInputs` del servicio ──

    // Severity normalization: incident docs pueden traer 'low'|'medium'|
    // 'high'|'critical' literalmente, o variantes ('baja'|'alta'|'1'..).
    // Mapeamos al enum estricto del servicio; default 'medium'.
    const normSeverity = (
      raw: unknown,
    ): 'low' | 'medium' | 'high' | 'critical' => {
      const s = String(raw ?? '').toLowerCase();
      if (
        s === 'critical' ||
        s === 'critico' ||
        s === 'crítico' ||
        s === '4'
      )
        return 'critical';
      if (s === 'high' || s === 'alta' || s === 'alto' || s === '3')
        return 'high';
      if (s === 'low' || s === 'baja' || s === 'bajo' || s === '1') return 'low';
      return 'medium';
    };

    const incidentsInput = incidents.map((i: Record<string, unknown>) => ({
      id: String(i.id ?? 'unknown'),
      severity: normSeverity(i.severity),
      description:
        typeof i.description === 'string' && i.description.length > 0
          ? i.description
          : typeof i.summary === 'string' && i.summary.length > 0
            ? i.summary
            : 'Sin descripción',
      // rootCauseKnown: aceptamos el flag explícito o derivamos de la
      // presencia de cualquier shape de `rootCause` (string o objeto).
      rootCauseKnown:
        i.rootCauseKnown === true ||
        (typeof i.rootCause === 'string' && i.rootCause.length > 0) ||
        (typeof i.rootCause === 'object' && i.rootCause !== null),
    }));

    const correctiveActionsInput = correctiveActions.map(
      (a: Record<string, unknown>) => {
        const rawStatus = String(a.status ?? 'open');
        // Map al enum aceptado por el servicio. `reopened` (F.4 nuevo)
        // se proyecta a 'open' para la minuta — sigue siendo trabajo
        // abierto desde la óptica del CPHS.
        const status:
          | 'open'
          | 'in_progress'
          | 'closed'
          | 'verified'
          | 'verified_effective' =
          rawStatus === 'closed'
            ? 'closed'
            : rawStatus === 'verified'
              ? 'verified'
              : rawStatus === 'verified_effective'
                ? 'verified_effective'
                : rawStatus === 'in_progress'
                  ? 'in_progress'
                  : 'open';
        return {
          id: String(a.id ?? 'unknown'),
          status,
          dueDate: typeof a.dueDate === 'string' ? a.dueDate : undefined,
          label:
            typeof a.description === 'string' && a.description.length > 0
              ? a.description.slice(0, 200)
              : 'Acción sin descripción',
        };
      },
    );

    const trainingsInput = trainings.map((t: Record<string, unknown>) => ({
      title:
        typeof t.title === 'string' && t.title.length > 0
          ? t.title
          : typeof t.name === 'string' && t.name.length > 0
            ? t.name
            : 'Capacitación',
      participantsCount: (() => {
        if (typeof t.participantsCount === 'number') return t.participantsCount;
        if (Array.isArray(t.participants)) return t.participants.length;
        if (Array.isArray(t.attendees)) return t.attendees.length;
        return 0;
      })(),
    }));

    // Codex P2 PR #317:
    //   - `complianceTrafficLightScore` ahora viene del campo
    //     `projects/{id}.complianceScore` (cacheado por la F.2
    //     pipeline). Si no existe en el doc del proyecto, pasamos
    //     `undefined` para que el motor omita la sección con
    //     "no disponible" en vez de pintar 🔴 0/100 engañoso.
    //   - `legalRecommendations` queda como `[]` por ahora — wiring
    //     real al `legalRuleEngine.getCriticalRequirements(profile)`
    //     requiere un `ProjectProfile` que el módulo de proyectos aún
    //     no expone consistentemente; sub-PR siguiente cuando F.2 y
    //     B.10 estén ambos cableados al doc del proyecto.
    const draft = buildMonthlyMinuteDraft({
      projectId,
      period: periodLabel,
      companyName,
      incidents: incidentsInput,
      correctiveActions: correctiveActionsInput,
      trainingsCompleted: trainingsInput,
      inspectionsCompleted: inspections.length,
      complianceTrafficLightScore,
      legalRecommendations: [],
      expectedAttendees,
    });

    return res.json({ draft });
  } catch (err) {
    logger.error?.('sprintK.cphs.draftMinute.error', err);
    captureRouteError(err, 'sprintK.cphs.draftMinute');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fase F.16 — Score de Preparación del Trabajador
// ─────────────────────────────────────────────────────────────────────
//
// Asistente NO BLOQUEANTE. El endpoint cruza:
//   - Worker doc (projects/{pid}/workers/{workerUid})
//   - Trainings vigentes desde training_assignments + training top-level
//   - EPP entregado desde epp_assignments donde assignedTo == workerUid
//   - Task opcional (projects/{pid}/tasks/{taskId}) para extraer
//     requiredTrainings/requiredEpp/taskCategory
//   - Incidentes recientes del trabajador (últimos 90 días) para calcular
//     `daysSinceLastIncident`
//
// Llama `computeReadiness(profile, task)` del servicio inmutable y
// devuelve el `ReadinessReport` exacto. Si falta data, popula con
// defaults conservadores (NO inventa: campos vacíos se marcan como
// gaps reales) — directiva del usuario: "no fabricar timestamps,
// reportar honestamente."
//
// Datos sensibles (medicalAptitudeStatus, fatigueLevel) se leen
// best-effort: si la colección no existe o está vacía, se asume
// 'sin_aptitud' y 'low' respectivamente (el peor caso para aptitud,
// el caso esperado para fatiga sin señal).

router.get(
  '/:projectId/worker-readiness/:workerUid',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, workerUid } = req.params;
    const taskIdParam =
      typeof req.query.taskId === 'string' && req.query.taskId.length > 0
        ? req.query.taskId
        : null;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { computeReadiness } = await import(
        '../../services/workerReadiness/readinessScore.js'
      );
      const db = admin.firestore();

      // Best-effort partial reads — one failure per feed degrades to
      // an empty array / null rather than 500-ing the entire bundle.
      // Matches the `safeRead` pattern used by the data-quality endpoint.
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.workerReadiness.read.${label}.failed`, err);
          return fallback;
        }
      };

      // Worker doc lives at `projects/{pid}/workers/{workerUid}` per
      // Workers.tsx line 71. Reading by workerUid as docId rather than
      // by field equality — that's the contract used by the modal that
      // edits/creates workers.
      const workerDocPromise = safeRead(
        'worker',
        async () => {
          const snap = await db
            .collection('projects')
            .doc(projectId)
            .collection('workers')
            .doc(workerUid)
            .get();
          return snap.exists ? (snap.data() as Record<string, unknown>) : null;
        },
        null as Record<string, unknown> | null,
      );

      // Training assignments live in THREE collections (matching the
      // data-quality scanner pattern at line 665 of this file):
      //   1. `projects/{pid}/training_assignments` — active live data
      //      (runConsistencyAudit.ts).
      //   2. `projects/{pid}/trainings` — written by
      //      TrainingRecommendations.tsx:104 with `workerId` (NOT
      //      `workerUid`).
      //   3. Top-level `training` filtered by projectId + workerUid for
      //      legacy records.
      //
      // Codex PR #315 P2: previously the route only read (1) + (3),
      // silently missing trainings assigned via the recommendations
      // flow and falsely scoring those workers as untrained. De-dupe
      // by document id with first-wins precedence to avoid
      // double-counting when the same training is referenced from
      // multiple paths.
      const trainingsPromise = safeRead(
        'trainings',
        async () => {
          // Codex PR #315 round-2 P2: the top-level `training` collection
          // identifies workers via the `attendees: string[]` array (see
          // Training.tsx:193, where `updateDoc` pushes the worker's uid
          // into `attendees` and flips `status: 'completed'`). The
          // previous top-level query only used `workerUid` equality and
          // returned nothing for the canonical Training.tsx happy path,
          // so trainings actually completed via the Training page were
          // silently scored as missing. Add a 5th query against the
          // `attendees` array filtered by `status: 'completed'`.
          const [
            nestedSnap,
            projectTrainingsByUid,
            projectTrainingsByWorkerId,
            topSnap,
            topByAttendees,
          ] = await Promise.all([
            db
              .collection('projects')
              .doc(projectId)
              .collection('training_assignments')
              .where('workerUid', '==', workerUid)
              .get()
              .catch(() => null),
            // `projects/{pid}/trainings` — TrainingRecommendations writes
            // `workerId`; some other flows may write `workerUid` as well.
            db
              .collection('projects')
              .doc(projectId)
              .collection('trainings')
              .where('workerUid', '==', workerUid)
              .get()
              .catch(() => null),
            db
              .collection('projects')
              .doc(projectId)
              .collection('trainings')
              .where('workerId', '==', workerUid)
              .get()
              .catch(() => null),
            db
              .collection('training')
              .where('projectId', '==', projectId)
              .where('workerUid', '==', workerUid)
              .get()
              .catch(() => null),
            // Canonical Training.tsx shape: completed sessions where the
            // worker's uid appears in `attendees`. Scoped by projectId
            // for tenant isolation (training docs from other projects in
            // the same tenant must not leak).
            db
              .collection('training')
              .where('projectId', '==', projectId)
              .where('status', '==', 'completed')
              .where('attendees', 'array-contains', workerUid)
              .get()
              .catch(() => null),
          ]);
          const all = new Map<string, Record<string, unknown>>();
          if (nestedSnap) {
            for (const d of nestedSnap.docs) {
              all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (projectTrainingsByUid) {
            for (const d of projectTrainingsByUid.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (projectTrainingsByWorkerId) {
            for (const d of projectTrainingsByWorkerId.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topSnap) {
            for (const d of topSnap.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topByAttendees) {
            for (const d of topByAttendees.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          return Array.from(all.values());
        },
        [] as Array<Record<string, unknown>>,
      );

      // EPP assignments — Codex PR #315 P1 (CRITICAL):
      //
      // The CANONICAL storage path is `projects/{pid}/epp_assignments`
      // (per AssignEPPModal.tsx:88 + EPP.tsx:55 + firestore.rules:324
      // + firebase-blueprint.json:347). The previous implementation only
      // queried the top-level `epp_assignments` collection, which:
      //   1. Misses every assignment written by the modal that records
      //      EPP for workers — `activeEpp` stays empty and the score
      //      falsely reports missing EPP for every selected worker/task.
      //   2. Leaks across projects in the same tenant if the same
      //      `workerUid` ever appears in another project's EPP feed.
      //
      // Project-scoped storage carries `workerId` (NOT `workerUid`,
      // matching the modal's field). We also read top-level
      // `epp_assignments` filtered by projectId for the insights.ts
      // legacy shape (line 215 of that file) — both shapes coexist.
      // De-dupe by document id with project-nested first-wins (the
      // canonical store) so legacy records never overwrite a doc that
      // the modal is the source of truth for.
      const eppPromise = safeRead(
        'epp',
        async () => {
          const [nestedByWorkerId, nestedByWorkerUid, topByUid, topByAssignedTo] =
            await Promise.all([
              // Canonical: `projects/{pid}/epp_assignments` with `workerId`.
              db
                .collection('projects')
                .doc(projectId)
                .collection('epp_assignments')
                .where('workerId', '==', workerUid)
                .get()
                .catch(() => null),
              // Same nested path, alternate field name (some flows
              // may write `workerUid` directly).
              db
                .collection('projects')
                .doc(projectId)
                .collection('epp_assignments')
                .where('workerUid', '==', workerUid)
                .get()
                .catch(() => null),
              // Top-level legacy (insights.ts:215 shape). Scoped by
              // projectId to prevent cross-project leakage.
              db
                .collection('epp_assignments')
                .where('projectId', '==', projectId)
                .where('workerUid', '==', workerUid)
                .get()
                .catch(() => null),
              // Top-level legacy with `assignedTo`. Scoped by projectId.
              db
                .collection('epp_assignments')
                .where('projectId', '==', projectId)
                .where('assignedTo', '==', workerUid)
                .get()
                .catch(() => null),
            ]);
          const all = new Map<string, Record<string, unknown>>();
          if (nestedByWorkerId) {
            for (const d of nestedByWorkerId.docs) {
              all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (nestedByWorkerUid) {
            for (const d of nestedByWorkerUid.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topByUid) {
            for (const d of topByUid.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          if (topByAssignedTo) {
            for (const d of topByAssignedTo.docs) {
              if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() });
            }
          }
          return Array.from(all.values());
        },
        [] as Array<Record<string, unknown>>,
      );

      // Task (optional). Without a taskId, requirements degrade to an
      // "any" baseline so the report still renders for a worker-only
      // self-check — the report just won't have task-specific gaps.
      const taskPromise = safeRead(
        'task',
        async () => {
          if (!taskIdParam) return null;
          // Tasks are top-level (`tasks` collection per insights.ts:115),
          // filtered by projectId — read by docId then assert projectId
          // for cross-project safety.
          const snap = await db.collection('tasks').doc(taskIdParam).get();
          if (!snap.exists) return null;
          const data = snap.data() as Record<string, unknown>;
          if (
            typeof data.projectId === 'string' &&
            data.projectId !== projectId
          ) {
            // Cross-project: refuse silently (treat as no task) rather
            // than leak. The caller still gets the worker-only baseline.
            return null;
          }
          return { id: snap.id, ...data };
        },
        null as Record<string, unknown> | null,
      );

      // Recent incidents (last 90 days) where the worker was involved.
      // Used purely to compute `daysSinceLastIncident`.
      //
      // Codex PR #315 P1 (CRITICAL): incident docs in this codebase
      // identify the affected worker with FIVE possible shapes:
      //   1. `involvedWorkers: string[]` (legacy array)
      //   2. `affectedWorkerUid: string` (legacy single-uid alias)
      //   3. `workerUid: string` (canonical — written by the close
      //      trigger at backgroundTriggers.ts:396)
      //   4. `workers: [{ uid: string }]` (subdoc shape)
      //   5. `affectedWorkerUids: string[]` (variant of #1)
      // The previous filter only accepted (1) + (2), so a worker with a
      // recent canonical incident silently fell to the 90-day cap and
      // the score lied about safety history. Iterate ALL shapes.
      //
      // Codex PR #315 P2 (#6): in projects with > 200 incidents in the
      // last 90 days, the previous `.limit(200)` was applied BEFORE the
      // in-memory worker filter — relevant incidents past the page
      // boundary were dropped. We need ALL of the worker's recent
      // incidents to find the most recent one, but we don't want to
      // page the entire incident collection either.
      //
      // Fix: run FOUR Firestore-side filters covering the shapes that
      // can be queried via `where` (`workerUid`, `affectedWorkerUid`,
      // `array-contains` on the two array shapes). Each query is itself
      // limited (50) — the worker-specific bound is small in practice
      // because each query is already scoped by uid + 90-day date range.
      // The subdoc `workers: [{ uid }]` shape can't be queried server-
      // side; we accept the limit there because no current writer in
      // the codebase produces it (it's listed for forward-compat).
      const ninetyDaysAgo = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const incidentsPromise = safeRead(
        'incidents',
        async () => {
          const baseQuery = db
            .collection('incidents')
            .where('projectId', '==', projectId)
            .where('occurredAt', '>=', ninetyDaysAgo);
          const [byWorkerUid, byAffectedWorkerUid, byInvolvedWorkers, byAffectedWorkerUids] =
            await Promise.all([
              // Shape 3: canonical single-uid field.
              baseQuery
                .where('workerUid', '==', workerUid)
                .limit(50)
                .get()
                .catch(() => null),
              // Shape 2: legacy single-uid alias.
              baseQuery
                .where('affectedWorkerUid', '==', workerUid)
                .limit(50)
                .get()
                .catch(() => null),
              // Shape 1: legacy array — Firestore array-contains.
              baseQuery
                .where('involvedWorkers', 'array-contains', workerUid)
                .limit(50)
                .get()
                .catch(() => null),
              // Shape 5: array variant — Firestore array-contains.
              baseQuery
                .where('affectedWorkerUids', 'array-contains', workerUid)
                .limit(50)
                .get()
                .catch(() => null),
            ]);
          const all = new Map<string, Record<string, unknown>>();
          const merge = (snap: FirebaseFirestore.QuerySnapshot | null) => {
            if (!snap) return;
            for (const d of snap.docs) {
              if (!all.has(d.id)) {
                all.set(d.id, d.data() as Record<string, unknown>);
              }
            }
          };
          merge(byWorkerUid);
          merge(byAffectedWorkerUid);
          merge(byInvolvedWorkers);
          merge(byAffectedWorkerUids);
          // Shape 4: subdoc `workers: [{ uid }]` — there's no Firestore
          // index for nested object fields; the in-memory pass below
          // catches matches in any other rows that happened to be
          // pulled by the array-contains queries. Defensive — if a
          // future writer uses this shape, audit it then.
          return Array.from(all.values()).filter((data) => {
            const inv = data.involvedWorkers;
            if (Array.isArray(inv) && inv.includes(workerUid)) return true;
            const invUids = data.affectedWorkerUids;
            if (Array.isArray(invUids) && invUids.includes(workerUid)) return true;
            if (data.affectedWorkerUid === workerUid) return true;
            if (data.workerUid === workerUid) return true;
            const workers = data.workers;
            if (Array.isArray(workers)) {
              for (const w of workers) {
                if (w && typeof w === 'object' && (w as { uid?: string }).uid === workerUid) {
                  return true;
                }
              }
            }
            return false;
          });
        },
        [] as Array<Record<string, unknown>>,
      );

      // Codex PR #315 round-2 P2: completed task history for experience
      // calculation. Organic tasks are written to the top-level `tasks`
      // collection (server/routes/organic.ts:278) with `assignedUids:
      // string[]` and `status: 'done'` + `completedAt` on completion
      // (organic.ts:386). The previous implementation only read the
      // worker doc's `experienceByCategory` map — but no code in this
      // repo WRITES that map, so the count was permanently 0 and every
      // worker received a false "sin experiencia" gap, even after
      // completing dozens of tasks in the same category.
      //
      // Fix: query `tasks` filtered by projectId + `assignedUids
      // array-contains workerUid` + `status == 'done'`. We pull all
      // completed tasks (limit 500 to bound the response — projects
      // shouldn't realistically exceed this for a single worker's
      // career, and it's a cheap query). We bucket them by parent
      // process type AFTER the parallel reads complete (we need to
      // know each task's process to compute the category).
      const completedTasksPromise = safeRead(
        'completedTasks',
        async () => {
          const snap = await db
            .collection('tasks')
            .where('projectId', '==', projectId)
            .where('assignedUids', 'array-contains', workerUid)
            .where('status', '==', 'done')
            .limit(500)
            .get();
          return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>));
        },
        [] as Array<Record<string, unknown>>,
      );

      const [worker, trainings, epps, taskDoc, incidents, completedTasks] = await Promise.all([
        workerDocPromise,
        trainingsPromise,
        eppPromise,
        taskPromise,
        incidentsPromise,
        completedTasksPromise,
      ]);

      if (!worker) {
        return res.status(404).json({ error: 'worker_not_found' });
      }

      // Codex PR #315 round-2 P2: fetch the parent process EARLY so it
      // can drive `taskCategory` AND the experience derivation. The
      // previous order computed `taskCategory` from the task doc alone
      // (which carries no `riskCategory`/`category` on organic tasks),
      // then read processDoc later — too late for the profile.
      let processDoc: Record<string, unknown> | null = null;
      if (taskDoc && typeof taskDoc.processId === 'string' && taskDoc.processId.length > 0) {
        processDoc = await safeRead(
          'process',
          async () => {
            const snap = await db
              .collection('processes')
              .doc(taskDoc.processId as string)
              .get();
            if (!snap.exists) return null;
            const data = snap.data() as Record<string, unknown>;
            // Cross-project safety: refuse silently if mismatched.
            if (typeof data.projectId === 'string' && data.projectId !== projectId) {
              return null;
            }
            return data;
          },
          null as Record<string, unknown> | null,
        );
      }

      // ───── Build WorkerProfile (the service contract) ─────

      // Active trainings — Codex PR #315 round-2 P1 (CRITICAL):
      //
      // TrainingRecommendations.tsx:81 writes `projects/{pid}/trainings`
      // with `status: 'assigned'` the moment a supervisor *assigns* a
      // recommended course — the worker has NOT taken or completed it.
      // The previous mapper accepted every non-expired record (and even
      // treated records without an expiry as active), so a worker who
      // had merely been assigned a critical safety course satisfied the
      // `requiredTrainings` set and could receive a falsely HIGH
      // readiness score for tasks like trabajo en altura / soldadura.
      //
      // Fix: explicitly EXCLUDE records whose status is one of the known
      // "not-yet-completed" markers (`assigned`, `pending`, `scheduled`,
      // `in_progress`, `expired`). Records that have no status at all
      // remain active (legacy training_assignments don't carry a status
      // field and have always been considered live — we can't regress
      // those projects). Records that explicitly say `status: 'completed'`
      // are active when not expired (the canonical happy path).
      //
      // Note: `expired` already filters on date; the status check is
      // strictly about whether the worker has actually DONE the course.
      const nowIso = new Date().toISOString();
      const activeTrainings: string[] = [];
      const trainingNotCompletedStatuses = new Set<string>([
        'assigned',
        'pending',
        'scheduled',
        'in_progress',
        'expired',
        'cancelled',
        'canceled',
        'rejected',
        'no_show',
      ]);
      for (const t of trainings) {
        const expiry =
          (typeof t.expiresAt === 'string' && t.expiresAt) ||
          (typeof t.validUntil === 'string' && t.validUntil) ||
          null;
        const expired = expiry !== null && expiry < nowIso;
        if (expired) continue;
        // Status gate: reject "not completed" markers explicitly.
        // A missing status is treated as active (legacy compat).
        if (typeof t.status === 'string' && trainingNotCompletedStatuses.has(t.status)) {
          continue;
        }
        const code =
          (typeof t.code === 'string' && t.code) ||
          (typeof t.trainingCode === 'string' && t.trainingCode) ||
          (typeof t.name === 'string' && t.name) ||
          (typeof t.title === 'string' && t.title) ||
          (typeof t.id === 'string' && t.id) ||
          null;
        if (code) activeTrainings.push(code);
      }

      // Active EPP — Codex PR #315 round-2 P1 (CRITICAL):
      //
      // AssignEPPModal.tsx:93 writes the delivered equipment label as
      // `eppItemName` (the canonical UI-facing name shown to the worker
      // when they receive the item, e.g. "Casco amarillo clase E" or
      // "Arnés tipo paracaidista"). Some legacy shapes use `itemLabel`.
      // The previous mapper accepted only `category`/`type`/`kind`/`name`
      // before adding to `activeEpp`, so the nested-query fix in round 1
      // started returning the canonical docs — but this mapper dropped
      // their primary label field and `activeEpp` stayed empty.
      //
      // Net effect: workers with required helmets / harnesses assigned
      // through the modal were scored as MISSING those items, producing
      // a falsely low EPP subscore for any task that required them.
      //
      // Fix: read EPP labels from the FULL union of shapes that any
      // writer in this codebase produces. Priority order:
      //   1. `category` (canonical taxonomy field).
      //   2. `type`/`kind` (legacy aliases).
      //   3. `name` (legacy generic field).
      //   4. `eppItemName` (AssignEPPModal canonical name).
      //   5. `itemLabel` (existing legacy alias).
      // We keep `category` first so that when both `category` and
      // `eppItemName` exist on the same doc, the taxonomy field wins for
      // requirement matching (the requirement set uses canonical labels).
      const activeEpp: string[] = [];
      for (const e of epps) {
        const expiry =
          (typeof e.expiresAt === 'string' && e.expiresAt) ||
          (typeof e.validUntil === 'string' && e.validUntil) ||
          null;
        const expired = expiry !== null && expiry < nowIso;
        if (expired) continue;
        const cat =
          (typeof e.category === 'string' && e.category) ||
          (typeof e.type === 'string' && e.type) ||
          (typeof e.kind === 'string' && e.kind) ||
          (typeof e.name === 'string' && e.name) ||
          (typeof e.eppItemName === 'string' && e.eppItemName) ||
          (typeof e.itemLabel === 'string' && e.itemLabel) ||
          null;
        if (cat) activeEpp.push(cat);
      }

      // Medical aptitude — Codex PR #315 P2 (#4):
      //
      // Sources, in priority order:
      //   1. `medicalAptitudeStatus` (canonical enum field).
      //   2. `medicalStatus` (legacy alias).
      //   3. `medicalAptitude.lastEvaluation` (typed Worker.medicalAptitude
      //      shape — see MedicalAptitude service contract).
      //   4. `medicalClearanceDate` (ISO date, written by
      //      AccessControlModal.tsx:45 — when present and not expired
      //      it counts as `vigente`).
      // Previously the route only read (1) + (2) — workers cleared
      // through the access-control UI (which only writes
      // `medicalClearanceDate`) lost the medical subscore and got a
      // false `sin_aptitud` blocker.
      const medRaw = worker.medicalAptitudeStatus ?? worker.medicalStatus;
      let medicalAptitudeStatus: 'vigente' | 'expirada' | 'restringida' | 'sin_aptitud' =
        medRaw === 'vigente' || medRaw === 'expirada' || medRaw === 'restringida'
          ? medRaw
          : 'sin_aptitud';
      if (medicalAptitudeStatus === 'sin_aptitud') {
        // Source 3: typed `medicalAptitude.lastEvaluation`.
        const medApt = worker.medicalAptitude;
        if (medApt && typeof medApt === 'object') {
          const lastEvalRaw = (medApt as Record<string, unknown>).lastEvaluation;
          const lastEval = typeof lastEvalRaw === 'string' ? lastEvalRaw : null;
          const expiryRaw =
            (medApt as Record<string, unknown>).expiresAt ??
            (medApt as Record<string, unknown>).validUntil;
          const expiry = typeof expiryRaw === 'string' ? expiryRaw : null;
          if (lastEval) {
            medicalAptitudeStatus = expiry !== null && expiry < nowIso ? 'expirada' : 'vigente';
          }
        }
      }
      if (medicalAptitudeStatus === 'sin_aptitud') {
        // Source 4: `medicalClearanceDate` (AccessControlModal).
        // Treat as `vigente` if present (no separate expiry in that
        // shape — the modal records the date the clearance was issued
        // and the app considers it valid until a doctor updates it).
        const clrDate = worker.medicalClearanceDate;
        if (typeof clrDate === 'string' && clrDate.length > 0) {
          medicalAptitudeStatus = 'vigente';
        }
      }

      // Signed documents — Codex PR #315 P2 (#5):
      //
      // Sources (union):
      //   1. `signedDocuments: string[]` (canonical).
      //   2. `acknowledgements: string[]` (legacy alias).
      //   3. `odiSigned: boolean` on the worker doc (written by
      //      LaborManagementModal.tsx:79). When `true`, inject `'ODI'`
      //      into the signed-docs set.
      //   4. `digitalSignatureStatus === 'Firmado'` on the worker doc
      //      (same modal) — counts as a generic acknowledgement signal;
      //      inject `'DIGITAL'`.
      //
      // Previously the route only read (1) + (2), so workers who signed
      // ODI through LaborManagementModal lost the document subscore
      // and were falsely flagged for any task that required `ODI`.
      const signedDocsRaw = worker.signedDocuments ?? worker.acknowledgements;
      const signedDocsSet = new Set<string>(
        Array.isArray(signedDocsRaw)
          ? (signedDocsRaw.filter((s) => typeof s === 'string') as string[])
          : [],
      );
      if (worker.odiSigned === true) {
        signedDocsSet.add('ODI');
      }
      if (worker.digitalSignatureStatus === 'Firmado') {
        signedDocsSet.add('DIGITAL');
      }
      const signedDocuments: string[] = Array.from(signedDocsSet);

      // Fatigue — best-effort from worker doc; absent → 'low' so the
      // score doesn't punish workers whose project hasn't wired the
      // fatigueMonitor signal yet.
      const fatRaw = worker.fatigueLevel;
      const fatigueLevel: 'low' | 'moderate' | 'high' | 'critical' =
        fatRaw === 'moderate' || fatRaw === 'high' || fatRaw === 'critical'
          ? fatRaw
          : 'low';

      // daysSinceLastIncident — compute from the incidents fetched.
      // No incidents in 90d → 90 (the cap; the score reads "≥50 = max").
      let daysSinceLastIncident = 90;
      if (incidents.length > 0) {
        const mostRecent = incidents
          .map((i) => (typeof i.occurredAt === 'string' ? i.occurredAt : ''))
          .filter((s) => s.length > 0)
          .sort()
          .reverse()[0];
        if (mostRecent) {
          const diffMs = Date.now() - new Date(mostRecent).getTime();
          daysSinceLastIncident = Math.max(
            0,
            Math.min(90, Math.floor(diffMs / (24 * 60 * 60 * 1000))),
          );
        }
      }

      // Task category resolution — Codex PR #315 round-2 P2:
      //
      // Organic task docs (created by server/routes/organic.ts) carry
      // `processId` but NOT `riskCategory`/`category`. The task's
      // EFFECTIVE category is the parent process `type` (e.g.
      // `soldadura`, `fachada`, `instalacion_electrica`). The previous
      // resolver fell back to the literal string 'general' before the
      // process was read, so every worker with real category-specific
      // experience (e.g. `experienceByCategory.soldadura`) was scored as
      // having zero experience whenever a normal organic task was
      // selected. Fix: read `processDoc.type` as the third source.
      const taskCategoryRaw =
        (taskDoc && typeof taskDoc.riskCategory === 'string'
          ? taskDoc.riskCategory
          : null) ??
        (taskDoc && typeof taskDoc.category === 'string'
          ? taskDoc.category
          : null) ??
        (processDoc && typeof processDoc.type === 'string'
          ? processDoc.type
          : null) ??
        'general';
      const taskCategory = taskCategoryRaw;

      // Experience count — Codex PR #315 round-2 P2:
      //
      // Sources, in priority order:
      //   1. `worker.experienceByCategory[taskCategory]` — typed map. No
      //      writer in this repo produces it today, but it's the
      //      forward-compat field and we honor it if a future migration
      //      backfills it.
      //   2. Completed organic tasks (top-level `tasks` collection) that
      //      were assigned to this worker, bucketed by their parent
      //      process `type`. We fetch the unique processIds across the
      //      worker's completed tasks and resolve their types via a
      //      `getAll` (cheap batched read; the IN-cardinality is capped
      //      at 10 per chunk).
      // The two sources are SUMMED (a project that backfills the typed
      // map AND also has real task history should reflect both).
      let taskCategoryExperienceCount = 0;
      const expMap = worker.experienceByCategory;
      if (expMap && typeof expMap === 'object') {
        const v = (expMap as Record<string, unknown>)[taskCategory];
        if (typeof v === 'number') taskCategoryExperienceCount = v;
      }
      // Source 2: bucket completed tasks by parent process type.
      if (completedTasks.length > 0) {
        // Collect unique processIds from the worker's completed tasks.
        const processIds = new Set<string>();
        for (const t of completedTasks) {
          if (typeof t.processId === 'string' && t.processId.length > 0) {
            processIds.add(t.processId);
          }
        }
        // Resolve processId → type via batched `getAll` (chunks of 10
        // for safety; `getAll` itself accepts arbitrary counts but
        // smaller batches keep individual RPCs bounded and let a partial
        // failure degrade gracefully). Best-effort: any chunk that
        // throws contributes zero count for its processes.
        const processIdToType = new Map<string, string>();
        if (processIds.size > 0) {
          const ids = Array.from(processIds);
          const chunks: string[][] = [];
          for (let i = 0; i < ids.length; i += 10) {
            chunks.push(ids.slice(i, i + 10));
          }
          await Promise.all(
            chunks.map(async (chunk) => {
              try {
                const refs = chunk.map((id) => db.collection('processes').doc(id));
                const snaps = await db.getAll(...refs);
                for (const snap of snaps) {
                  if (!snap.exists) continue;
                  const data = snap.data() as Record<string, unknown>;
                  // Cross-project safety: skip if mismatched projectId.
                  if (typeof data.projectId === 'string' && data.projectId !== projectId) {
                    continue;
                  }
                  if (typeof data.type === 'string' && data.type.length > 0) {
                    processIdToType.set(snap.id, data.type);
                  }
                }
              } catch (err) {
                logger.warn?.('sprintK.workerReadiness.read.processBatch.failed', err);
              }
            }),
          );
        }
        // Count tasks whose process type matches the current taskCategory.
        let historyCount = 0;
        for (const t of completedTasks) {
          const pid = typeof t.processId === 'string' ? t.processId : null;
          if (!pid) continue;
          const ptype = processIdToType.get(pid);
          if (ptype && ptype === taskCategory) historyCount += 1;
        }
        taskCategoryExperienceCount += historyCount;
      }

      const profile = {
        workerUid,
        activeTrainings,
        activeEpp,
        medicalAptitudeStatus,
        signedDocuments,
        taskCategoryExperienceCount,
        fatigueLevel,
        daysSinceLastIncident,
      };

      // ───── Build TaskRequirements ─────
      //
      // Codex PR #315 P2 (#3): per ADR 0001 + firestore.rules:780-783,
      // organic Task docs are constrained to the closed key set
      // `['description', 'assignedUids', 'status', 'date', 'crewId',
      // 'processId', 'projectId', 'completedAt']` — they do NOT carry
      // `requiredTrainings`/`requiredEpp`/`requiredAcknowledgements`
      // directly. The previous implementation always fell back to the
      // empty-requirements baseline for organic tasks, producing a
      // generic score that ignored the task's actual risk profile.
      //
      // Fix: requirements are sourced from FOUR layers (union, dedup):
      //   1. The task doc itself, if present in any of these fields:
      //      - `requiredTrainingIds` / `requiredTrainings` (string[])
      //      - `requiredEppIds` / `requiredEpp` (string[])
      //      - `requiredAcknowledgements` (string[])
      //      Custom flows that bypass the rules constraint (server-side
      //      writes) may attach these.
      //   2. The parent Process (if `processId` is set) — Process docs
      //      can carry `requiredTrainings`/`requiredEpp` (some flows
      //      write them at the process level).
      //   3. Deterministic mapping from `Process.type` → known SAFE
      //      defaults (`ProcessType` is a closed union; we know
      //      `soldadura` requires welding training, etc.).
      //   4. Fuzzy match: name-based requirements are matched
      //      case-insensitively (substring) against the worker's
      //      training codes/names, so a task that says "Trabajo en
      //      altura" can be satisfied by a training titled "Curso de
      //      Trabajo en Altura — Avanzado".
      //
      // Task-less calls (taskId omitted) get a baseline that requires
      // nothing — the report still surfaces medical/fatigue/incident
      // gaps because those don't depend on the task.

      // Deterministic baseline by Process.type. Conservative — we err
      // on the side of FEWER requirements (the score reports a missing
      // training as a real gap, so over-requiring would produce false
      // negatives in the readiness verdict).
      const processTypeBaseline: Record<
        string,
        { trainings: string[]; epp: string[]; acks: string[]; requiresMedical: boolean }
      > = {
        soldadura: {
          trainings: ['Soldadura', 'Trabajo en caliente'],
          epp: ['casco', 'careta', 'guantes', 'mandil'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        instalacion_electrica: {
          trainings: ['Trabajo eléctrico', 'Bloqueo y etiquetado (LOTO)'],
          epp: ['casco', 'guantes dieléctricos', 'calzado dieléctrico'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        demolicion: {
          trainings: ['Demolición segura', 'Trabajo en altura'],
          epp: ['casco', 'gafas', 'arnés'],
          acks: ['ODI'],
          requiresMedical: true,
        },
        fachada: {
          trainings: ['Trabajo en altura'],
          epp: ['arnés', 'casco', 'línea de vida'],
          acks: ['ODI'],
          requiresMedical: true,
        },
        movimiento_tierras: {
          trainings: ['Operación maquinaria pesada'],
          epp: ['casco', 'chaleco reflectante', 'calzado seguridad'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        concreto: {
          trainings: [],
          epp: ['casco', 'guantes', 'botas'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        mantenimiento: {
          trainings: ['Bloqueo y etiquetado (LOTO)'],
          epp: ['casco', 'guantes', 'gafas'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        pintura: {
          trainings: ['Manejo solventes'],
          epp: ['respirador', 'guantes', 'gafas'],
          acks: ['ODI'],
          requiresMedical: false,
        },
        topografia: { trainings: [], epp: ['casco'], acks: [], requiresMedical: false },
        transporte: {
          trainings: ['Conducción defensiva'],
          epp: ['chaleco reflectante'],
          acks: ['ODI'],
          requiresMedical: true,
        },
      };

      // Layer 2: parent process — already fetched earlier (see processDoc
      // resolution above the profile build, round-2 P2 fix).

      const collectStrings = (src: Record<string, unknown> | null, key: string): string[] => {
        if (!src) return [];
        const v = src[key];
        if (!Array.isArray(v)) return [];
        return v.filter((s): s is string => typeof s === 'string');
      };

      const reqTrainingsSet = new Set<string>();
      // Layer 1: task doc directly.
      for (const s of collectStrings(taskDoc, 'requiredTrainings')) reqTrainingsSet.add(s);
      for (const s of collectStrings(taskDoc, 'requiredTrainingIds')) reqTrainingsSet.add(s);
      // Layer 2: parent process.
      for (const s of collectStrings(processDoc, 'requiredTrainings')) reqTrainingsSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredTrainingIds')) reqTrainingsSet.add(s);

      const reqEppSet = new Set<string>();
      for (const s of collectStrings(taskDoc, 'requiredEpp')) reqEppSet.add(s);
      for (const s of collectStrings(taskDoc, 'requiredEppIds')) reqEppSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredEpp')) reqEppSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredEppIds')) reqEppSet.add(s);

      const reqAcksSet = new Set<string>();
      for (const s of collectStrings(taskDoc, 'requiredAcknowledgements')) reqAcksSet.add(s);
      for (const s of collectStrings(processDoc, 'requiredAcknowledgements')) reqAcksSet.add(s);

      let requiresMedicalAptitude: boolean = false;
      if (taskDoc) requiresMedicalAptitude = Boolean(taskDoc.requiresMedicalAptitude);
      if (!requiresMedicalAptitude && processDoc) {
        requiresMedicalAptitude = Boolean(processDoc.requiresMedicalAptitude);
      }

      // Layer 3: deterministic baseline by Process.type.
      if (processDoc && typeof processDoc.type === 'string') {
        const baseline = processTypeBaseline[processDoc.type];
        if (baseline) {
          for (const s of baseline.trainings) reqTrainingsSet.add(s);
          for (const s of baseline.epp) reqEppSet.add(s);
          for (const s of baseline.acks) reqAcksSet.add(s);
          if (baseline.requiresMedical) requiresMedicalAptitude = true;
        }
      }

      // Layer 4: fuzzy resolution — Codex PR #315 round-2 P2 (SAFETY):
      //
      // Previous logic accepted EITHER direction of substring match:
      //   `itemLower.includes(reqLower) || reqLower.includes(itemLower)`
      // The second clause is dangerous: a worker with the generic owned
      // item "guantes" would satisfy a specialized requirement like
      // "guantes dieléctricos" (because "guantes dieléctricos" contains
      // "guantes"). For electrical / hot-work / chemical-resistant PPE
      // this falsely marks required specialized equipment as PRESENT —
      // a worker handling 480V circuits with regular cotton gloves would
      // pass the readiness check that explicitly required dielectric
      // gloves. SAME RISK for trainings ("Trabajo en altura" satisfied
      // by a generic "Trabajo" course).
      //
      // Fix: ONE-WAY match only. The owned item must CONTAIN the full
      // requirement (i.e. the worker's record is at least as specific
      // as the requirement). A generic owned item never satisfies a
      // more specific requirement. This is the safe direction because
      // canonical requirements describe the minimum specificity needed.
      const fuzzyResolve = (req: string, owned: string[]): string => {
        const reqLower = req.toLowerCase().trim();
        if (reqLower.length === 0) return req;
        // Walk the worker's owned items; ONLY accept items that contain
        // the full requirement string. Reject the reverse direction
        // (requirement contains owned) which would let generic items
        // satisfy specialized requirements.
        for (const item of owned) {
          const itemLower = item.toLowerCase();
          if (itemLower.includes(reqLower)) {
            return item;
          }
        }
        return req;
      };
      const reqTrainings = Array.from(reqTrainingsSet).map((r) =>
        fuzzyResolve(r, activeTrainings),
      );
      const reqEpp = Array.from(reqEppSet).map((r) => fuzzyResolve(r, activeEpp));
      const reqAcks = Array.from(reqAcksSet);

      const task = {
        requiredTrainings: reqTrainings,
        requiredEpp: reqEpp,
        taskCategory,
        requiresMedicalAptitude,
        requiredAcknowledgements: reqAcks,
      };

      const report = computeReadiness(profile, task);

      return res.json({ report });
    } catch (err) {
      logger.error?.('sprintK.workerReadiness.error', err);
      captureRouteError(err, 'sprintK.workerReadiness');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// §74-78 — Brigada de Emergencia + Recursos
// ─────────────────────────────────────────────────────────────────────
//
// Cierra el ciclo "respuesta a emergencias":
//   - Brigade de emergencia con roles (jefe / primeros auxilios /
//     fuego / evacuación / comunicaciones)
//   - Recursos (extintores, kits, AED, eyewash, fire hose, ducha
//     emergencia, kit derrames) con QR + inspección periódica
//   - Snapshot agregado: coverage + readiness + needing-attention
//
// Path firestore: tenants/{tid}/projects/{pid}/emergency_brigade/{id}
//   - Documento "_members" guarda la lista de brigadistas
//   - Documento "_resources" guarda la lista de recursos
//   - Documento "_inspections" guarda historial de inspecciones
//
// El servicio `emergencyBrigadeService` es pure — solo agregaciones.
// Aquí persistimos el state, allá calculamos el report.

import {
  buildBrigadeCoverageReport,
  buildResourceReadinessReport,
  type BrigadeMember,
  type BrigadeRole,
  type EmergencyResource,
} from '../../services/emergencyBrigade/emergencyBrigadeService.js';

const brigadeRoleEnum = z.enum([
  'brigade_chief',
  'first_aid',
  'fire_response',
  'evacuation_coordinator',
  'communications',
]);

const resourceKindEnum = z.enum([
  'extinguisher',
  'first_aid_kit',
  'aed',
  'eyewash',
  'safety_shower',
  'fire_hose',
  'spill_kit',
]);

// Codex P2 #1 (PR #321, line 5237): training / inspection dates were
// previously typed as `z.string().min(10)`, which accepted any 10+ char
// string (e.g. "not-a-date"). `buildBrigadeCoverageReport` then does
// `Date.parse(trainedAt) + ...` → `NaN`, and the `expiresMs < nowMs`
// check falls through to the `else` branch counting the member as
// actively certified. Result: a junk string makes the brigade look
// covered.
//
// Fix: validate that the string parses to a finite Date AND (for past
// events like trainings / inspections) is not future-dated. Future
// expirations (`nextExpirationAt`) only need to be parseable — by
// definition they are in the future.
const isoPastDate = z
  .string()
  .min(10)
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'invalid_iso_date',
  })
  .refine((s) => Date.parse(s) <= Date.now(), {
    message: 'date_in_future',
  });

const isoDate = z
  .string()
  .min(10)
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'invalid_iso_date',
  });

// Codex P2 #2 (PR #321, line 5251): only roles authorized to manage
// emergency-response data may write brigade members / resources /
// inspections. Mirrors the F.5 QR signature role gate
// (`QR_SIG_CHALLENGE_ROLES`). Ordinary workers — who in many projects
// are also project members — must not be able to add brigadists or flip
// a resource to "operational", which would directly move the readiness
// banner.
//
// Codex P2 round 2 #6 (PR #321, line 5168): include `supervisor` —
// the F.5 QR challenge role gate (`QR_SIG_CHALLENGE_ROLES`) already
// includes supervisors, and the inline comment claimed parity with
// that gate. Field supervisors must be able to add brigadists /
// register resources / mark inspections from the new page; without
// `supervisor` here every UI write action returned 403 even though the
// page allowed them through. The original gate already includes
// `brigade_chief` (the role that operates the brigade itself), so the
// union is { admin, prevencionista, supervisor, brigade_chief }.
const BRIGADE_WRITE_ROLES = new Set([
  'admin',
  'prevencionista',
  'supervisor',
  'brigade_chief',
]);

function callerCanWriteBrigade(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && BRIGADE_WRITE_ROLES.has(u.role)) {
    return true;
  }
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (tenants && typeof tenants === 'object' && typeof u.tenantId === 'string') {
    const t = tenants[u.tenantId];
    if (t && typeof t.role === 'string' && BRIGADE_WRITE_ROLES.has(t.role)) {
      return true;
    }
  }
  return false;
}

// Codex P2 #3 (PR #321, line 5261): when adding a brigadist by uid,
// confirm the uid is an actual project member before persisting. A typo
// or fabricated uid would otherwise satisfy required role coverage with
// a nonexistent worker.
//
// Codex P2 round 2 #7 (PR #321, line 5204): the previous revision only
// checked the legacy `projects/{projectId}.members[]` top-level array
// plus `createdBy`. But other production code paths
// (`src/server/routes/emergency.ts` → `sendToProjectSupervisors`)
// already treat `projects/{projectId}/members/{uid}` (subcollection) as
// the canonical member source — many tenants keep memberships there
// rather than duplicating every uid into the array. Without the
// subcollection check, legitimate workers were rejected with
// `worker_not_in_project`. Check BOTH sources before returning false so
// the canonical (subcollection) AND legacy (array) shapes are honored.
async function workerIsProjectMember(
  workerUid: string,
  projectId: string,
): Promise<boolean> {
  const db = admin.firestore();
  // Source 1: legacy top-level array + createdBy (matches
  // assertProjectMember semantics).
  try {
    const snap = await db.collection('projects').doc(projectId).get();
    if (snap.exists) {
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const members = data.members;
      const createdBy = data.createdBy;
      if (Array.isArray(members) && members.includes(workerUid)) return true;
      if (typeof createdBy === 'string' && createdBy === workerUid) return true;
    }
  } catch (err) {
    logger.warn?.(
      'sprintK.emergencyBrigade.workerIsProjectMember.legacyArray.failed',
      err,
    );
    // Fall through to the subcollection check — a partial failure on
    // one source shouldn't deny legitimate workers in the other.
  }
  // Source 2: canonical `projects/{projectId}/members/{uid}`
  // subcollection. Used by emergency.ts and other notification
  // surfaces; many tenants only populate this shape.
  try {
    const memberDoc = await db
      .collection('projects')
      .doc(projectId)
      .collection('members')
      .doc(workerUid)
      .get();
    if (memberDoc.exists) return true;
  } catch (err) {
    logger.warn?.(
      'sprintK.emergencyBrigade.workerIsProjectMember.subcollection.failed',
      err,
    );
  }
  return false;
}

router.get(
  '/:projectId/emergency-brigade',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );

      // Per-domain safe reads. Mirrors the dataQuality pattern so a
      // missing collection (fresh project) doesn't blank the snapshot —
      // empty arrays drive the empty-state UI cleanly.
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.emergencyBrigade.read.${label}.failed`, err);
          return [];
        }
      };

      const [members, resources] = await Promise.all([
        safeRead<BrigadeMember & { id: string }>('members', async () => {
          const snap = await baseRef
            .where('docType', '==', 'member')
            .get();
          return snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              workerUid: String(data.workerUid ?? ''),
              role: (data.role ?? 'brigade_chief') as BrigadeRole,
              trainedAt: String(data.trainedAt ?? ''),
              trainingValidYears:
                typeof data.trainingValidYears === 'number'
                  ? data.trainingValidYears
                  : 2,
              active: data.active !== false,
            };
          });
        }),
        safeRead<EmergencyResource>('resources', async () => {
          const snap = await baseRef
            .where('docType', '==', 'resource')
            .get();
          return snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              kind:
                (data.kind ?? 'extinguisher') as EmergencyResource['kind'],
              location: String(data.location ?? ''),
              lastInspectedAt: String(data.lastInspectedAt ?? ''),
              nextExpirationAt: String(data.nextExpirationAt ?? ''),
              operational: data.operational !== false,
            };
          });
        }),
      ]);

      const brigadeReport = buildBrigadeCoverageReport(members);
      const resourceReport = buildResourceReadinessReport(resources);

      // Readiness rollup: combines brigade coverage + resource health.
      // - green: minimum brigade coverage + ≥1 resource + 0 needing-attention
      // - amber: one of (gap in coverage XOR ≥1 needing-attention)
      // - rose:  both fail OR multiple coverage gaps OR multiple
      //          resources needing attention OR empty inventory
      //
      // Codex P2 #5 (PR #321, line 5209): an empty resource inventory
      // is itself a readiness gap. With three brigadists present but
      // zero registered resources, `needingAttention` is naturally
      // empty (you can't have an expired resource you don't have),
      // which previously evaluated to a GREEN banner saying "recursos
      // al día". For a project that has only added brigadists, that
      // incorrectly marks emergency response as ready. Treat
      // `totalResources === 0` as one extra structural gap so the
      // banner moves to amber (only gap) or rose (with other gaps).
      const coverageGapCount = brigadeReport.uncoveredRoles.length;
      const resourceGapCount = resourceReport.needingAttention.length;
      const emptyInventoryGap = resourceReport.totalResources === 0 ? 1 : 0;
      const totalGaps = coverageGapCount + resourceGapCount + emptyInventoryGap;
      let readinessLevel: 'green' | 'amber' | 'rose';
      if (totalGaps === 0 && brigadeReport.meetsMinimum) {
        readinessLevel = 'green';
      } else if (
        totalGaps === 1 ||
        (totalGaps <= 2 && brigadeReport.meetsMinimum)
      ) {
        readinessLevel = 'amber';
      } else {
        readinessLevel = 'rose';
      }

      return res.json({
        members,
        resources,
        brigade: brigadeReport,
        resourceReadiness: resourceReport,
        readinessLevel,
      });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.snapshot.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.snapshot');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const addBrigadeMemberSchema = z.object({
  workerUid: z.string().min(1).max(120),
  role: brigadeRoleEnum,
  // Codex P2 #1 (PR #321): reject "not-a-date" + future-dated trainings.
  trainedAt: isoPastDate,
  trainingValidYears: z.number().int().min(1).max(10).optional(),
  active: z.boolean().optional(),
});

router.post(
  '/:projectId/emergency-brigade/members',
  verifyAuth,
  validate(addBrigadeMemberSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof addBrigadeMemberSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 #2 (PR #321, line 5251): role gate. guard() only proved
    // the caller is a project member; here we require the caller to be
    // an admin / prevencionista / brigade_chief before mutating brigade
    // data — same pattern as F.5 QR signature challenge.
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    // Codex P2 #3 (PR #321, line 5261): the workerUid being added must
    // actually be a project member. Otherwise a typo or fabricated uid
    // would satisfy required role coverage with a nonexistent worker.
    if (!(await workerIsProjectMember(body.workerUid, projectId))) {
      return res.status(422).json({ error: 'worker_not_in_project' });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      // Codex P2 round 2 #9 (PR #321, line 5382): the previous revision
      // called `baseRef.doc()` which mints a fresh random id every
      // submission. Adding the same worker twice (or once per required
      // role) produced N distinct member documents, and
      // `buildBrigadeCoverageReport` counted them as separate active
      // members — so a single real person could inflate the byRole
      // counter to satisfy the three-member minimum. Fix: derive a
      // deterministic id keyed on `worker:role`, and reject with 409
      // if a member document for that (workerUid, role) pair already
      // exists. The deterministic id also makes the audit trail easier
      // (one worker = one member doc per role across re-trainings).
      const safeUid = body.workerUid.replace(/[^a-zA-Z0-9_-]/g, '_');
      const id = `member-${safeUid}-${body.role}`;
      const doc = baseRef.doc(id);
      const existing = await doc.get();
      if (existing.exists) {
        return res.status(409).json({
          error: 'worker_already_in_role',
          existingId: id,
        });
      }
      await doc.set({
        docType: 'member',
        workerUid: body.workerUid,
        role: body.role,
        trainedAt: body.trainedAt,
        trainingValidYears: body.trainingValidYears ?? 2,
        active: body.active !== false,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
      });
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.addMember.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.addMember');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const addResourceSchema = z.object({
  kind: resourceKindEnum,
  location: z.string().min(1).max(240),
  // Codex P2 #1 (PR #321): inspection date must be a real past ISO
  // date; expiration date must be a real ISO date (may be future).
  lastInspectedAt: isoPastDate,
  nextExpirationAt: isoDate,
  operational: z.boolean().optional(),
});

router.post(
  '/:projectId/emergency-brigade/resources',
  verifyAuth,
  validate(addResourceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof addResourceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 #2 (PR #321, line 5251): role gate for resource writes
    // — flipping a resource's operational state directly moves the
    // readiness signal.
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      const doc = baseRef.doc();
      const id = doc.id;
      await doc.set({
        docType: 'resource',
        kind: body.kind,
        location: body.location,
        lastInspectedAt: body.lastInspectedAt,
        nextExpirationAt: body.nextExpirationAt,
        operational: body.operational !== false,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
      });
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.addResource.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.addResource');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const inspectResourceSchema = z.object({
  // Codex P2 #1 (PR #321): inspection timestamp must parse and not be
  // future-dated; the new expiration may legitimately be in the future.
  inspectedAt: isoPastDate,
  operational: z.boolean(),
  nextExpirationAt: isoDate.optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/emergency-brigade/resources/:id/inspect',
  verifyAuth,
  validate(inspectResourceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof inspectResourceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 #2 (PR #321, line 5251): role gate for resource
    // inspections — `operational: true` resets the readiness signal.
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      const resourceRef = baseRef.doc(id);
      const snap = await resourceRef.get();
      if (!snap.exists || snap.data()?.docType !== 'resource') {
        return res.status(404).json({ error: 'resource_not_found' });
      }
      // Patch the resource with the latest inspection + audit a separate
      // inspection record so historical inspections survive the next
      // patch.
      const patch: Record<string, unknown> = {
        lastInspectedAt: body.inspectedAt,
        operational: body.operational,
        lastInspectedBy: callerUid,
      };
      if (body.nextExpirationAt) {
        patch.nextExpirationAt = body.nextExpirationAt;
      }
      const auditDoc = baseRef.doc();
      const batch = db.batch();
      batch.set(resourceRef, patch, { merge: true });
      batch.set(auditDoc, {
        docType: 'inspection',
        resourceId: id,
        inspectedAt: body.inspectedAt,
        inspectedBy: callerUid,
        operational: body.operational,
        notes: body.notes ?? null,
        createdAt: new Date().toISOString(),
      });
      await batch.commit();
      return res.status(201).json({ ok: true, inspectionId: auditDoc.id });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.inspect.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.inspect');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Sprint K §214-215 — Observaciones Positivas (listing + balance)
// ────────────────────────────────────────────────────────────────────────
//
// Endpoints adicionales sobre el motor positiveObservations que ya
// expone /worker/:workerUid (más arriba). Aquí cerramos:
//   - GET /positive-observations?period=30d|90d|all   (listing global)
//   - POST /positive-observations                     (alias create — el
//      handler genérico sigue validando observerUid via verifyAuth)
//   - GET /positive-observations/balance              (Balance §215:
//      ratio positivas vs correctivas del mismo período)
//
// La filosofía detrás de §214-215 (cultura preventiva sana NO solo
// registra lo malo): documento usuario "§214-215".

type ObservationPeriod = '30d' | '90d' | 'all';

function periodToSinceIso(period: ObservationPeriod): string | null {
  if (period === 'all') return null;
  const ms = period === '30d' ? 30 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function parsePeriod(raw: unknown): ObservationPeriod {
  if (raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '30d';
}

// Codex P2 PR #320 (line 5142): cap unbounded reads on the global
// listing. Without a limit, opening this page on a busy project would
// download every observation since the project's start (potentially
// thousands of docs). We page in fixed chunks ordered newest-first.
const POSITIVE_OBSERVATIONS_PAGE_LIMIT = 500;

router.get(
  '/:projectId/positive-observations',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const period = parsePeriod(req.query.period);
    const rawStartAfter = req.query.startAfter;
    const startAfterId =
      typeof rawStartAfter === 'string' && rawStartAfter.trim().length > 0
        ? rawStartAfter.trim()
        : null;
    try {
      const db = admin.firestore();
      const path = `tenants/${g.tenantId}/projects/${projectId}/positive_observations`;
      // safeRead pattern: per-query try/catch so a missing/empty collection
      // returns [] instead of 500. Aligns with the existing
      // dataQuality/maturity endpoints in this file.
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.positive.list.${label}.failed`, err);
          return [];
        }
      };
      const sinceIso = periodToSinceIso(period);
      const observations = await safeRead('positive_observations', async () => {
        let query: FirebaseFirestore.Query = sinceIso
          ? db.collection(path).where('observedAt', '>=', sinceIso)
          : db.collection(path);
        // Order newest-first so users see the most recent observations
        // when the page is bounded. orderBy on the same field as the
        // range filter is required/supported by Firestore semantics.
        query = query.orderBy('observedAt', 'desc');
        if (startAfterId) {
          const cursorSnap = await db.collection(path).doc(startAfterId).get();
          if (cursorSnap.exists) {
            query = query.startAfter(cursorSnap);
          } else {
            logger.warn?.('sprintK.positive.list.startAfter.notFound', { startAfterId });
          }
        }
        // +1 to detect whether more docs exist beyond the page.
        const snap = await query.limit(POSITIVE_OBSERVATIONS_PAGE_LIMIT + 1).get();
        return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
      });
      const hasMore = observations.length > POSITIVE_OBSERVATIONS_PAGE_LIMIT;
      const pageItems = hasMore
        ? observations.slice(0, POSITIVE_OBSERVATIONS_PAGE_LIMIT)
        : observations;
      const nextStartAfter = hasMore
        ? (pageItems[pageItems.length - 1] as { id?: string } | undefined)?.id ?? null
        : null;
      if (hasMore) {
        // Surface in logs so we can detect projects that routinely hit the
        // cap and budget for richer pagination UX.
        logger.warn?.('sprintK.positive.list.pageCapped', {
          projectId,
          period,
          limit: POSITIVE_OBSERVATIONS_PAGE_LIMIT,
        });
      }
      return res.json({
        observations: pageItems,
        period,
        pagination: {
          limit: POSITIVE_OBSERVATIONS_PAGE_LIMIT,
          hasMore,
          nextStartAfter,
        },
      });
    } catch (err) {
      logger.error?.('sprintK.positive.list.error', err);
      captureRouteError(err, 'sprintK.positive.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/:projectId/positive-observations/balance',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const period = parsePeriod(req.query.period);
    try {
      const { computeBalance } = await import(
        '../../services/positiveObservations/positiveObservationsService.js'
      );
      const db = admin.firestore();
      const tenantProjectPath = `tenants/${g.tenantId}/projects/${projectId}`;
      const sinceIso = periodToSinceIso(period);

      const safeCount = async (label: string, fn: () => Promise<number>): Promise<number> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.positive.balance.${label}.failed`, err);
          return 0;
        }
      };

      // Codex P2 PR #320 (line 5188): use Firestore count() aggregate
      // instead of downloading every doc just to compute snap.docs.length.
      // On large projects the previous .get() materialized the whole
      // collection per balance refresh — the count() aggregate is a
      // single billed read regardless of cardinality.
      //
      // Codex P2 round 2 PR #320 (line 5254): keep the corrective count
      // in the same window as the positive count when a finite period
      // is requested. The legacy CorrectiveAction shape from
      // weakActionDetector.ts has no creation timestamp, but the F.4
      // record shape (`CorrectiveActionRecord` in correctiveActionsCenter.ts)
      // does carry `dueDate` — which is required at creation and is the
      // most stable proxy we have for "actionable in this window".
      // We range-filter by `dueDate >= sinceIso` and surface the basis
      // used so the UI can be transparent ("30 días · dueDate").
      // If the filtered query fails (e.g. missing composite index), we
      // fall back to the all-time count and surface that fallback in
      // `correctivePeriodBasis` so the UI labels it honestly instead of
      // implying a period match that didn't happen.
      const correctivesPath = `${tenantProjectPath}/corrective_actions`;
      let correctivePeriodBasis: 'dueDate' | 'all' = sinceIso ? 'dueDate' : 'all';
      const [positiveCount, correctiveCount] = await Promise.all([
        safeCount('positive', async () => {
          const base = db.collection(`${tenantProjectPath}/positive_observations`);
          const query = sinceIso ? base.where('observedAt', '>=', sinceIso) : base;
          const snap = await query.count().get();
          return Number(snap.data().count ?? 0);
        }),
        safeCount('corrective', async () => {
          const base = db.collection(correctivesPath);
          if (!sinceIso) {
            const snap = await base.count().get();
            return Number(snap.data().count ?? 0);
          }
          try {
            const snap = await base
              .where('dueDate', '>=', sinceIso)
              .count()
              .get();
            return Number(snap.data().count ?? 0);
          } catch (err) {
            // Range filter failed (likely missing index, or pre-F.4
            // docs without `dueDate`). Fall back to all-time so the
            // widget still renders, but record the fallback so the UI
            // labels the asymmetry instead of lying.
            logger.warn?.('sprintK.positive.balance.corrective.dueDateFilter.failed', err);
            correctivePeriodBasis = 'all';
            const snap = await base.count().get();
            return Number(snap.data().count ?? 0);
          }
        }),
      ]);

      const balance = computeBalance({ positiveCount, correctiveCount });
      const ratio = correctiveCount > 0 ? positiveCount / correctiveCount : positiveCount;
      // Codex P2 round 2 PR #320 (line 5254): align `correctivePeriod`
      // with the actual filter we applied. When `correctivePeriodBasis`
      // is `'dueDate'`, the count covers the same window as the
      // positive side; when it's `'all'` (no period requested, or
      // fallback), the UI needs to know to render the asymmetry chip.
      const correctivePeriod: ObservationPeriod =
        correctivePeriodBasis === 'dueDate' ? period : 'all';
      return res.json({
        positive: positiveCount,
        corrective: correctiveCount,
        ratio,
        period,
        // Codex P2 PR #320 (line 5198) + round 2: be explicit about
        // which window each count covers so the UI can render an
        // honest "vs" label and avoid a false "punitive" verdict from
        // mixed-window comparisons.
        positivePeriod: period,
        correctivePeriod,
        correctivePeriodBasis,
        balance,
      });
    } catch (err) {
      logger.error?.('sprintK.positive.balance.error', err);
      captureRouteError(err, 'sprintK.positive.balance');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);


// ─────────────────────────────────────────────────────────────────────
// Fase F.6 — Modo Sin Señal para Inspecciones (offline-first daily ops)
// ─────────────────────────────────────────────────────────────────────
//
// Bridges the pure `offlineInspectionService` (which is deterministic +
// I/O-free by design) to a project-scoped CRUD surface so the
// inspector/supervisor can persist a session that was originally
// captured offline. The HTTP layer is the *sync* surface — observations
// stay in IndexedDB on the device until the network returns, then the
// client POSTs them here.
//
// Storage path: `tenants/{tid}/projects/{pid}/inspections/{id}`.
// One document per inspection session. Observations live in a subarray
// on the parent doc to keep retrieval cheap (a typical session has
// 10-30 items; arrays scale fine at that size).
//
// Status machine (server-authoritative):
//   in_progress → on start()
//   completed   → on complete() once `completedAt` is recorded
//
// Idempotency:
//   - `POST /inspections` is keyed by client-generated `id`; resending
//     the same id no-ops (merge:true).
//   - `POST /inspections/:id/observations` is keyed by client-generated
//     `observationId`; we de-dup before append so a flaky retry on
//     spotty mobile network never doubles the observation.
//
// Filosofía Praeventio:
//   - Detección Predictiva: el hallazgo se captura aunque NO haya señal.
//   - Respuesta Adaptativa: el server acepta sync diferida sin penalizar.
//   - Consolidación: la inspección completa queda como nodo auditable.

const INSPECTION_STATUSES = ['in_progress', 'completed'] as const;
type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

interface StoredInspectionObservation {
  observationId: string;
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  recordedAt: string;
  recordedBy: string;
}

interface StoredInspection {
  id: string;
  templateId: string;
  responsibleUid: string;
  status: InspectionStatus;
  startedAt: string;
  startedBy: string;
  completedAt?: string;
  observations: StoredInspectionObservation[];
}

router.get('/:projectId/inspections', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const rawStatus =
      typeof req.query.status === 'string' ? req.query.status : 'all';
    // Accept `all` (no filter) plus the canonical statuses; everything
    // else collapses to `all` so a malformed query string still renders
    // a useful list instead of an error.
    const statusFilter: InspectionStatus | 'all' = (
      ['all', ...INSPECTION_STATUSES] as readonly string[]
    ).includes(rawStatus)
      ? (rawStatus as InspectionStatus | 'all')
      : 'all';

    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/inspections`,
    );

    // Codex PR #322 P1 #1: don't swallow filtered-read failures any more.
    // When `statusFilter !== 'all'` we combine an equality filter on
    // `status` with `orderBy('startedAt')`, which needs the composite
    // index `inspections(status ASC, startedAt DESC)`. The index is now
    // declared in firestore.indexes.json, but in projects where it's
    // still building Firestore returns FAILED_PRECONDITION (code 9).
    // We catch that one specific error and fall back to a fetch-then-
    // sort-in-JS path so in-progress/completed inspections remain
    // visible during index propagation. ANY OTHER error is rethrown
    // and surfaces as a 500 to the caller — so we never silently
    // return [] and make rows look "missing" again.
    const mapDocs = (
      snap: admin.firestore.QuerySnapshot,
    ): StoredInspection[] =>
      snap.docs.map((d) => {
        const data = d.data() as Omit<StoredInspection, 'id'>;
        return {
          id: d.id,
          ...data,
          // Defensive: a brand-new doc may not have observations yet
          // (e.g. created via start without any observation appended).
          observations: Array.isArray(data.observations) ? data.observations : [],
        };
      });

    const FAILED_PRECONDITION = 9;
    const isMissingIndexError = (err: unknown): boolean => {
      if (!err || typeof err !== 'object') return false;
      const e = err as { code?: number | string; message?: string };
      if (e.code === FAILED_PRECONDITION || e.code === 'failed-precondition') {
        return true;
      }
      return (
        typeof e.message === 'string' &&
        /requires an index|FAILED_PRECONDITION/i.test(e.message)
      );
    };

    let inspections: StoredInspection[];
    try {
      let q: admin.firestore.Query = baseRef;
      if (statusFilter !== 'all') {
        q = q.where('status', '==', statusFilter);
      }
      // Most recent first; 200 cap mirrors drills endpoint conventions.
      const snap = await q.orderBy('startedAt', 'desc').limit(200).get();
      inspections = mapDocs(snap);
    } catch (err) {
      if (!isMissingIndexError(err)) {
        // Real failure (auth, network, schema) — bubble up instead of
        // swallowing into an empty list (the previous behaviour hid
        // genuine outages from the caller).
        throw err;
      }
      logger.warn?.(
        'sprintK.inspections.list.index_fallback',
        { statusFilter },
      );
      // Index missing or still building: fetch without orderBy (cap
      // raised slightly so the JS-side limit doesn't truncate the
      // newest rows after sort) and sort in JS. Equality filter alone
      // doesn't need a composite index.
      let q: admin.firestore.Query = baseRef;
      if (statusFilter !== 'all') {
        q = q.where('status', '==', statusFilter);
      }
      const snap = await q.limit(500).get();
      inspections = mapDocs(snap)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
        .slice(0, 200);
    }

    return res.json({ inspections });
  } catch (err) {
    logger.error?.('sprintK.inspections.list.error', err);
    captureRouteError(err, 'sprintK.inspections.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const inspectionStartSchema = z.object({
  id: z.string().min(1).max(120),
  templateId: z.string().min(1).max(200),
  responsibleUid: z.string().min(1).max(200),
  startedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections',
  verifyAuth,
  validate(inspectionStartSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof inspectionStartSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(body.id);
      // Idempotent: if the session already exists we don't overwrite
      // the original startedAt/startedBy — the client may retry on
      // flaky 4G and the canonical start ts is the FIRST one.
      const existing = await docRef.get();
      if (existing.exists) {
        const data = existing.data() as Omit<StoredInspection, 'id'>;
        return res
          .status(200)
          .json({ ok: true, inspection: { id: existing.id, ...data } });
      }
      const now = body.startedAt ?? new Date().toISOString();
      const payload: StoredInspection = {
        id: body.id,
        templateId: body.templateId,
        responsibleUid: body.responsibleUid,
        status: 'in_progress',
        startedAt: now,
        startedBy: callerUid,
        observations: [],
      };
      await docRef.set(payload, { merge: true });
      return res.status(201).json({ ok: true, inspection: payload });
    } catch (err) {
      logger.error?.('sprintK.inspections.start.error', err);
      captureRouteError(err, 'sprintK.inspections.start');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const inspectionObservationSchema = z.object({
  observationId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).optional(),
  photoStoragePath: z.string().min(1).max(500).optional(),
  locationLatLng: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  recordedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections/:inspectionId/observations',
  verifyAuth,
  validate(inspectionObservationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, inspectionId } = req.params;
    const body = req.body as z.infer<typeof inspectionObservationSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(inspectionId);

      // Codex PR #322 P1 #2: wrap the read + de-dup + write inside a
      // Firestore transaction so concurrent appends (typical when the
      // offline queue flushes several queued observations in parallel
      // after reconnecting) don't read the same array and overwrite
      // each other. Without the transaction, the second writer's
      // version of `observations` clobbers the first writer's append.
      //
      // Codex PR #322 P2 #2: idempotency now also covers the
      // `inspection_already_completed` path. If a POST succeeds on the
      // server but the client never gets the response, then the same
      // observationId is retried AFTER the inspection has been closed,
      // returning 409 would falsely surface a data-loss error. We
      // detect that case and return 200 with the already-persisted
      // observation. Conversely, a retry that SHARES an observationId
      // but carries DIFFERENT content (different notes, different
      // photoStoragePath, different itemId, different locationLatLng)
      // is an actual id collision — we surface that as 409
      // `observation_id_conflict` instead of silently overwriting.
      type ObservationCommitOutcome =
        | { kind: 'created'; observation: StoredInspectionObservation; status: 201 }
        | { kind: 'duplicate'; observation: StoredInspectionObservation; status: 200 }
        | { kind: 'not_found' }
        | { kind: 'completed_new_id' }
        | { kind: 'id_conflict' };

      const observationsEqual = (
        a: StoredInspectionObservation,
        b: StoredInspectionObservation,
      ): boolean => {
        // Compare only the caller-supplied fields. `recordedAt` and
        // `recordedBy` are server-stamped and shouldn't gate
        // idempotency: a network retry that survives across midnight
        // would otherwise spuriously 409 over a recordedAt drift.
        if ((a.itemId ?? null) !== (b.itemId ?? null)) return false;
        if ((a.notes ?? null) !== (b.notes ?? null)) return false;
        if ((a.photoStoragePath ?? null) !== (b.photoStoragePath ?? null)) {
          return false;
        }
        const aLoc = a.locationLatLng;
        const bLoc = b.locationLatLng;
        if (aLoc && bLoc) {
          if (aLoc.lat !== bLoc.lat || aLoc.lng !== bLoc.lng) return false;
        } else if (Boolean(aLoc) !== Boolean(bLoc)) {
          return false;
        }
        return true;
      };

      const outcome = await db.runTransaction<ObservationCommitOutcome>(
        async (tx) => {
          const snap = await tx.get(docRef);
          if (!snap.exists) {
            return { kind: 'not_found' };
          }
          const existing = snap.data() as Omit<StoredInspection, 'id'>;
          const prev = Array.isArray(existing.observations)
            ? existing.observations
            : [];
          const existingSameId = prev.find(
            (o: StoredInspectionObservation) =>
              o.observationId === body.observationId,
          );

          // Candidate record we'd persist (used for both create + conflict check).
          const candidate: StoredInspectionObservation = {
            observationId: body.observationId,
            recordedAt:
              body.recordedAt ??
              existingSameId?.recordedAt ??
              new Date().toISOString(),
            recordedBy: existingSameId?.recordedBy ?? callerUid,
            ...(body.itemId !== undefined ? { itemId: body.itemId } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.photoStoragePath !== undefined
              ? { photoStoragePath: body.photoStoragePath }
              : {}),
            ...(body.locationLatLng !== undefined
              ? { locationLatLng: body.locationLatLng }
              : {}),
          };

          if (existing.status === 'completed') {
            if (existingSameId) {
              // Retry after completion — already persisted, return 200.
              return { kind: 'duplicate', observation: existingSameId, status: 200 };
            }
            // Genuinely new observation on a closed inspection — reject.
            return { kind: 'completed_new_id' };
          }

          if (existingSameId) {
            if (observationsEqual(existingSameId, candidate)) {
              return {
                kind: 'duplicate',
                observation: existingSameId,
                status: 200,
              };
            }
            return { kind: 'id_conflict' };
          }

          const next = [...prev, candidate];
          tx.set(docRef, { observations: next }, { merge: true });
          return { kind: 'created', observation: candidate, status: 201 };
        },
      );

      if (outcome.kind === 'not_found') {
        return res.status(404).json({ error: 'inspection_not_found' });
      }
      if (outcome.kind === 'completed_new_id') {
        return res.status(409).json({ error: 'inspection_already_completed' });
      }
      if (outcome.kind === 'id_conflict') {
        return res.status(409).json({ error: 'observation_id_conflict' });
      }
      return res
        .status(outcome.status)
        .json({ ok: true, observation: outcome.observation });
    } catch (err) {
      logger.error?.('sprintK.inspections.observation.error', err);
      captureRouteError(err, 'sprintK.inspections.observation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const inspectionCompleteSchema = z.object({
  completedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections/:inspectionId/complete',
  verifyAuth,
  validate(inspectionCompleteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, inspectionId } = req.params;
    const body = req.body as z.infer<typeof inspectionCompleteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(inspectionId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'inspection_not_found' });
      }
      const existing = snap.data() as Omit<StoredInspection, 'id'>;
      if (existing.status === 'completed') {
        // Already completed — return the existing doc; this is also
        // idempotent so the offline queue can retry safely.
        return res
          .status(200)
          .json({ ok: true, inspection: { id: snap.id, ...existing } });
      }
      const completedAt = body.completedAt ?? new Date().toISOString();
      await docRef.set(
        { status: 'completed', completedAt },
        { merge: true },
      );
      return res.status(200).json({
        ok: true,
        inspection: { id: snap.id, ...existing, status: 'completed', completedAt },
      });
    } catch (err) {
      logger.error?.('sprintK.inspections.complete.error', err);
      captureRouteError(err, 'sprintK.inspections.complete');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// §42-44 — Inventario Controles de Ingeniería + Jerarquía ISO 31000
// ────────────────────────────────────────────────────────────────────────
//
// Inventario de controles aplicados según la jerarquía ISO 31000 /
// 45001:
//   elimination > substitution > engineering > administrative > epp
//
// Persistido en
//   tenants/{tid}/projects/{pid}/engineering_controls/{id}
//
// Cada control declara:
//   - level (en la jerarquía)
//   - riskCategory que mitiga
//   - descripción + responsable + frecuencia de verificación (días)
//   - lista de verificaciones realizadas (verifierUid + result + evidence)
//
// La página deriva el estado de vigencia (verde/ámbar/rojo) a partir
// del `lastVerifiedAt + verificationFrequencyDays`. Esta lógica es
// determinística: el motor `engineeringControlsInventory` (servicio
// existente, intacto) calcula la cobertura de riesgos y la auditoría
// de jerarquía a partir del inventario.

type EngControlHierarchyLevel =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'epp';

const ENG_CTRL_LEVELS: ReadonlySet<EngControlHierarchyLevel> = new Set([
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'epp',
]);

interface StoredEngineeringControl {
  id: string;
  level: EngControlHierarchyLevel;
  riskCategory: string;
  name: string;
  description: string;
  responsibleUid: string;
  verificationFrequencyDays: number;
  createdAt: string;
  createdBy: string;
  lastVerifiedAt: string | null;
  verifications: Array<{
    verifierUid: string;
    verifiedAt: string;
    result: 'pass' | 'observation' | 'fail';
    evidence?: string;
  }>;
}

router.get(
  '/:projectId/engineering-controls',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      // Codex P2 (PR #319): surface read failures instead of silently
      // returning `[]`. A missing collection already yields an empty
      // snapshot — a *thrown* error here means Firestore is degraded,
      // permissions changed, or the backend rejected the read. Hiding
      // that as "no controls" lets the UI report the project has nothing
      // inventoried during outages, which is dangerous for a safety
      // surface. We still return 200 + empty list so the page renders,
      // but we attach `warning: 'partial_read_failure'` so the UI can
      // show a degraded-data banner instead of a clean empty state.
      let partialReadFailure = false;
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.engineeringControls.read.${label}.failed`, err);
          partialReadFailure = true;
          return [];
        }
      };

      const db = admin.firestore();
      const colRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
      );

      const rawLevel = typeof req.query.level === 'string' ? req.query.level : 'all';
      // 'admin' is the shorthand used on the frontend; map to 'administrative'.
      const levelParam: 'all' | EngControlHierarchyLevel =
        rawLevel === 'all'
          ? 'all'
          : rawLevel === 'admin'
            ? 'administrative'
            : (ENG_CTRL_LEVELS.has(rawLevel as EngControlHierarchyLevel)
                ? (rawLevel as EngControlHierarchyLevel)
                : 'all');
      const riskCategory =
        typeof req.query.riskCategory === 'string' ? req.query.riskCategory : null;

      const controls = await safeRead('list', async () => {
        const snap = await colRef.get();
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StoredEngineeringControl, 'id'>),
        }));
      });

      // Codex P2 (PR #319, round 2): include `general` (cross-cutting)
      // controls in risk-filtered results. The page contract — and the
      // client-side post-filter in EngineeringControls.tsx — treats
      // `general` controls as applicable to every risk (site-wide
      // signage, housekeeping, etc.). An exact-match server filter would
      // strip them out before the client could keep them, leaving the
      // user with an incomplete inventory under any specific risk chip.
      // Match if the control's category equals the requested one *or*
      // the control is tagged `general`. The level filter still applies
      // unchanged.
      const filtered = controls.filter((c) => {
        if (levelParam !== 'all' && c.level !== levelParam) return false;
        if (
          riskCategory &&
          c.riskCategory !== riskCategory &&
          c.riskCategory !== 'general'
        )
          return false;
        return true;
      });

      return res.json({
        controls: filtered,
        ...(partialReadFailure ? { warning: 'partial_read_failure' } : {}),
      });
    } catch (err) {
      logger.error?.('sprintK.engineeringControls.list.error', err);
      captureRouteError(err, 'sprintK.engineeringControls.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

/**
 * Codex P1 (PR #319): typed error raised inside the create-transaction
 * when the client-supplied control ID already exists. Lets the route
 * map the failure to a 409 with the stable code
 * `engineering_control_duplicate_id` instead of bubbling up as a 500.
 */
class EngineeringControlDuplicateError extends Error {
  readonly controlId: string;
  constructor(controlId: string) {
    super(`engineering control already exists: ${controlId}`);
    this.name = 'EngineeringControlDuplicateError';
    this.controlId = controlId;
  }
}

const engineeringControlCreateSchema = z.object({
  id: z.string().min(1),
  level: z.enum(['elimination', 'substitution', 'engineering', 'administrative', 'epp']),
  riskCategory: z.string().min(1).max(200),
  name: z.string().min(3).max(300),
  description: z.string().min(3).max(4000),
  responsibleUid: z.string().min(1),
  verificationFrequencyDays: z.number().int().positive().max(3650),
});

router.post(
  '/:projectId/engineering-controls',
  verifyAuth,
  validate(engineeringControlCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof engineeringControlCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const doc: StoredEngineeringControl = {
        id: body.id,
        level: body.level,
        riskCategory: body.riskCategory,
        name: body.name,
        description: body.description,
        responsibleUid: body.responsibleUid,
        verificationFrequencyDays: body.verificationFrequencyDays,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
        lastVerifiedAt: null,
        verifications: [],
      };
      const ref = admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
        )
        .doc(body.id);
      // Codex P1 (PR #319): reject duplicate IDs instead of silently
      // overwriting. The ID is client-supplied, so `.set()` would let a
      // colliding ID erase an existing control's `createdAt`,
      // `createdBy`, `lastVerifiedAt` and the whole `verifications`
      // audit history. Run the write inside a transaction that fails
      // when the document already exists, returning 409 with a stable
      // error code (`engineering_control_duplicate_id`) so the frontend
      // can show a "ya existe" message. Note: `.create()` is documented
      // to throw `ALREADY_EXISTS` (gRPC code 6) if the doc exists, but
      // a transaction-based check is more portable across mocked admin
      // SDKs in tests and matches the qr-signature acknowledgement
      // pattern used elsewhere in this file.
      const db = admin.firestore();
      try {
        await db.runTransaction(async (txn) => {
          const existing = await txn.get(ref);
          if (existing.exists) {
            throw new EngineeringControlDuplicateError(body.id);
          }
          txn.create(ref, doc);
        });
      } catch (err) {
        if (err instanceof EngineeringControlDuplicateError) {
          return res.status(409).json({
            error: 'engineering_control_duplicate_id',
            controlId: err.controlId,
          });
        }
        // `txn.create()` itself can throw ALREADY_EXISTS (gRPC code 6)
        // if a parallel writer races us between `txn.get` and `txn.create`.
        // Surface that as 409 too so the contract stays consistent.
        const code = (err as { code?: number | string } | null)?.code;
        if (code === 6 || code === 'ALREADY_EXISTS') {
          return res.status(409).json({
            error: 'engineering_control_duplicate_id',
            controlId: body.id,
          });
        }
        throw err;
      }
      return res.status(201).json({ ok: true, control: doc });
    } catch (err) {
      logger.error?.('sprintK.engineeringControls.create.error', err);
      captureRouteError(err, 'sprintK.engineeringControls.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// Codex P1 (PR #319): the verify schema no longer accepts `verifierUid`
// from the request body. The server derives the verifier identity from
// the authenticated caller (`req.user!.uid`) so a project member cannot
// impersonate a supervisor/manager in the audit trail. Same fix as
// PR #318: never trust client-supplied identity for safety records.
const engineeringControlVerifySchema = z.object({
  result: z.enum(['pass', 'observation', 'fail']),
  evidence: z.string().max(4000).optional(),
});

router.post(
  '/:projectId/engineering-controls/:id/verify',
  verifyAuth,
  validate(engineeringControlVerifySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof engineeringControlVerifySchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
        )
        .doc(id);

      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'control_not_found' });
      }
      const now = new Date().toISOString();
      const entry = {
        // Codex P1 (PR #319): use the authenticated caller, never the
        // request body. The audit trail must reflect who actually did
        // the check, not who the client claims did it.
        verifierUid: callerUid,
        verifiedAt: now,
        result: body.result,
        ...(body.evidence ? { evidence: body.evidence } : {}),
      };
      // FieldValue.arrayUnion keeps history additive — never silently
      // overwrites prior verifications. `lastVerifiedAt` is the canonical
      // timestamp the UI uses to compute vigencia (verde/ámbar/rojo)
      // against `verificationFrequencyDays`.
      //
      // Codex P2 (PR #319): only advance `lastVerifiedAt` when the
      // verification actually passed. Advancing on `observation` or
      // `fail` would let a freshly *failed* control appear "Vigente"
      // (green) right after the failure — because the page derives the
      // green/amber/red status from `lastVerifiedAt + frequency` alone.
      // The failed/observation entries still land in `verifications` so
      // the history is complete; they just don't bump the canonical
      // currency timestamp.
      const updatePayload: {
        verifications: admin.firestore.FieldValue;
        lastVerifiedAt?: string;
      } = {
        verifications: admin.firestore.FieldValue.arrayUnion(entry),
      };
      if (body.result === 'pass') {
        updatePayload.lastVerifiedAt = now;
      }
      await ref.update(updatePayload);
      return res.status(200).json({ ok: true, entry });
    } catch (err) {
      logger.error?.('sprintK.engineeringControls.verify.error', err);
      captureRouteError(err, 'sprintK.engineeringControls.verify');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Sprint K §61-63 — Encuesta de Percepción + Índice de Cultura + Reconocimiento
// ─────────────────────────────────────────────────────────────────────
//
// Endpoints HTTP que exponen el motor determinístico
// `safetyCulturePulse` al frontend. El servicio existía pero no era
// navegable — el ciclo predictivo (Detección → Respuesta →
// Consolidación) quedaba inerte aunque computePulseIndex y
// buildPulseTrend estuvieran listos.
//
// Storage paths:
//   - Survey doc:   tenants/{tid}/projects/{pid}/culture_pulse/{surveyId}
//   - Response:     .../culture_pulse/{surveyId}/responses/{responseDocId}
//
// PRIVACIDAD CRÍTICA (directiva del producto):
//   - Las respuestas NUNCA persisten `responderUid`. El doc carga sólo
//     `responderHash` (SHA-256 del uid+surveyId, primeros 16 hex) que
//     sirve para garantizar "una respuesta por trabajador por encuesta"
//     SIN permitir reconstruir la identidad. Aunque un atacante con
//     acceso a Firestore conozca todos los `responderHash`, no puede
//     recorrer la lista de uids del proyecto y derivar quién respondió
//     qué a menos que ya tenga el uid Y el surveyId — y en ese caso ya
//     tiene auth de admin total, así que la propiedad de anonimato es
//     "anonimato respecto a otros revisores del dashboard / SUSESO /
//     SII". El responderUid NO entra a Firestore en ningún momento.
//   - El endpoint snapshot (`/culture-pulse`) agrega métricas (índice,
//     conteo, top concerns/strengths) y NUNCA expone respuestas
//     individuales.
//   - El endpoint history devuelve sólo (periodo, índice, respuestas).

const PULSE_QUESTION_KEYS = [
  'felt_safe_today',
  'manager_listens',
  'free_to_stop',
  'reported_incident_safely',
  'has_resources_to_be_safe',
] as const;
type PulseQuestionKey = (typeof PULSE_QUESTION_KEYS)[number];

interface StoredPulseSurvey {
  id: string;
  status: 'open' | 'closed';
  /** Ventana en la que se aceptan respuestas. */
  openAt: string;
  closeAt: string;
  /** Plantilla / título — admin lo define al programar. */
  title?: string;
  /** Conteo objetivo de respondedores (para % participación). */
  expectedRespondents?: number;
  createdAt: string;
  createdBy: string;
}

interface StoredPulseResponse {
  /**
   * SHA-256 truncado de `${responderUid}:${surveyId}`. NO permite
   * reconstruir el uid, pero garantiza idempotencia por respondedor
   * (siempre el mismo hash → siempre el mismo docId).
   *
   * NO se persiste `responderUid` en el doc. La directiva de
   * anonimato del producto lo prohíbe explícitamente: aún si el
   * dashboard/SUSESO/SII gana acceso, no puede mapear hash → uid.
   */
  responderHash: string;
  workerRole: string;
  area: string;
  answers: Record<PulseQuestionKey, number>;
  submittedAt: string;
}

function pulseResponderHash(uid: string, surveyId: string): string {
  return createHash('sha256').update(`${uid}:${surveyId}`).digest('hex').slice(0, 32);
}

/**
 * Etiquetas humanas por question key — usadas para top concerns/
 * strengths. Mantenemos castellano (audiencia objetivo: prevencionistas
 * y trabajadores de habla hispana).
 */
const PULSE_QUESTION_LABEL: Record<PulseQuestionKey, string> = {
  felt_safe_today: 'Me sentí seguro hoy',
  manager_listens: 'Mi jefe escucha mis inquietudes',
  free_to_stop: 'Me siento libre de detener un trabajo inseguro',
  reported_incident_safely: 'Puedo reportar incidentes sin miedo',
  has_resources_to_be_safe: 'Tengo los recursos para trabajar seguro',
};

// PRIVACIDAD CRÍTICA — umbral de anonimato. Cuando el conteo de respuestas
// está por debajo de este umbral, el snapshot OMITE per-question averages,
// topConcerns, topStrengths, byQuestion y punitive flag — devolver
// agregados con n<5 puede permitir reconstruir respuestas individuales
// (ej.: con 1 respuesta el promedio ES la respuesta del trabajador; con
// 2-4 respuestas un atacante con conocimiento previo de un solo respondedor
// puede inferir respuestas de los otros). La directiva del producto exige
// que las respuestas sean anónimas, así que suprimimos todo agregado
// derivado hasta que el conteo cruce el umbral.
const PULSE_ANONYMITY_THRESHOLD = 5;

interface CulturePulseSnapshot {
  surveyId: string | null;
  status: 'open' | 'closed' | null;
  openAt: string | null;
  closeAt: string | null;
  cultureIndex: number;
  level: 'low' | 'fair' | 'good' | 'strong';
  totalResponses: number;
  expectedRespondents: number | null;
  participationRate: number | null;
  punitiveCulturedFlagged: boolean;
  byQuestion: Record<PulseQuestionKey, number>;
  topConcerns: Array<{ key: PulseQuestionKey; label: string; score: number }>;
  topStrengths: Array<{ key: PulseQuestionKey; label: string; score: number }>;
  hasResponded: boolean;
  /**
   * Codex P1 #3 (PR #323, line 5304) — Bandera de "agregados suprimidos
   * por anonimato". `true` cuando `totalResponses < PULSE_ANONYMITY_THRESHOLD`
   * y la UI debe mostrar mensaje de "esperando respuestas suficientes para
   * proteger el anonimato". Cuando es `true`, `byQuestion`, `topConcerns`,
   * `topStrengths`, `cultureIndex`, `level`, `participationRate` y
   * `punitiveCulturedFlagged` son valores neutros (cero / vacío / false).
   */
  insufficientResponses?: boolean;
  /** Conteo actual (mismo que `totalResponses`, expuesto explícitamente
   * cuando `insufficientResponses=true` para que la UI lo muestre). */
  currentCount?: number;
  /** Umbral mínimo de respuestas para revelar agregados. */
  threshold?: number;
}

// Codex P1 #2 (PR #323, line 5217) — Detector de FAILED_PRECONDITION
// para los índices compuestos que `/culture-pulse` y
// `/culture-pulse/history` requieren. Una vez los índices se despliegan
// estos fallbacks se vuelven código muerto (las consultas ordenadas
// siempre tendrán éxito), pero los mantenemos para que el dashboard NO
// se quede silenciosamente vacío durante una ventana de propagación.
function isMissingFirestoreIndexError(err: unknown): boolean {
  const code = (err as { code?: string | number } | null)?.code;
  if (code === 9 || code === 'failed-precondition') return true;
  const msg = String((err as Error | null)?.message ?? '');
  return /index/i.test(msg) && /FAILED_PRECONDITION|requires an index/i.test(msg);
}

router.get('/:projectId/culture-pulse', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { computePulseIndex } = await import(
      '../../services/culturePulse/safetyCulturePulse.js'
    );

    const db = admin.firestore();
    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
    );

    const safeRead = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.('sprintK.culturePulse.snapshot.read_failed', err);
        return fallback;
      }
    };

    // Codex P1 #1 + #2 (PR #323, line 5217) — Survey discovery:
    //
    //   #1: Confiar en `survey.status === 'open'` (el doc field) garantiza
    //       que un admin que cerró explícitamente la encuesta NO la siga
    //       viendo como activa. PERO `status` se setea sólo a la creación
    //       y no se flipa automáticamente cuando expira la ventana —
    //       sólo si admin la cierra manualmente. Por lo tanto, además de
    //       filtrar por `status == 'open'`, descartamos a nivel
    //       aplicación las que ya pasaron `closeAt` (las tratamos como
    //       cerradas implícitamente y caemos al snapshot cerrado más
    //       reciente). Esto cubre los dos casos:
    //         - admin la cerró → status flipped → no aparece como activa
    //         - venció la ventana → status sigue 'open' pero filtramos
    //
    //   #2: La consulta `where('status', '==', X).orderBy('openAt'/'closeAt')`
    //       requiere índice compuesto en Firestore. Si el índice todavía
    //       no se desplegó, el snapshot debe degradar al unordered query
    //       y ordenar en JS (no devolver "snapshot vacío" silencioso, que
    //       hace pensar al admin que el sistema está roto). Ver
    //       isMissingFirestoreIndexError + el fallback unordered abajo.
    const fetchSurveyOrdered = async (
      statusFilter: 'open' | 'closed',
      orderField: 'openAt' | 'closeAt',
    ): Promise<admin.firestore.QueryDocumentSnapshot[] | null> => {
      try {
        const snap = await baseRef
          .where('status', '==', statusFilter)
          .orderBy(orderField, 'desc')
          .limit(10) // pull a few — we'll filter expired open surveys client-side
          .get();
        return snap.docs;
      } catch (err) {
        if (!isMissingFirestoreIndexError(err)) {
          logger.warn?.('sprintK.culturePulse.snapshot.read_failed', err);
          return null;
        }
        logger.warn?.(
          'sprintK.culturePulse.snapshot.missing_index_fallback',
          { statusFilter, orderField, err },
        );
        // Unordered fallback: pull everything with this status, sort in JS.
        try {
          const snap = await baseRef.where('status', '==', statusFilter).get();
          const docs = snap.docs;
          docs.sort((a, b) => {
            const av = String(a.get(orderField) ?? '');
            const bv = String(b.get(orderField) ?? '');
            return bv.localeCompare(av); // desc
          });
          return docs.slice(0, 10);
        } catch (innerErr) {
          logger.warn?.(
            'sprintK.culturePulse.snapshot.unordered_fallback_failed',
            innerErr,
          );
          return null;
        }
      }
    };

    const nowIso = new Date().toISOString();
    let surveyDoc: admin.firestore.QueryDocumentSnapshot | null = null;

    // Codex P2 #2 round 2 (PR #323, line 5318) — Prefer the most recent OPEN
    // survey whose window is CURRENTLY LIVE (openAt <= now < closeAt). The
    // query orders by openAt desc, so a future-scheduled survey (status='open'
    // since closeAt is in the future) would otherwise shadow a currently
    // running one. We must require BOTH:
    //   (a) openAt <= nowIso — the survey has actually started
    //   (b) nowIso < closeAt — the survey has not yet expired
    //
    // Without (a), a survey scheduled for next month appears as the active
    // pulse and the UI shows a CTA the respond endpoint then rejects with
    // `survey_not_open` (line 5611), confusing the user.
    const openDocs = await fetchSurveyOrdered('open', 'openAt');
    if (openDocs && openDocs.length > 0) {
      const liveOpen = openDocs.find((d) => {
        const openAt = d.get('openAt');
        const closeAt = d.get('closeAt');
        return (
          typeof openAt === 'string' &&
          typeof closeAt === 'string' &&
          openAt <= nowIso &&
          nowIso < closeAt
        );
      });
      surveyDoc = liveOpen ?? null;
    }

    // Fallback to the most recent closed snapshot (admin-closed OR expired).
    if (!surveyDoc) {
      const closedDocs = await fetchSurveyOrdered('closed', 'closeAt');
      if (closedDocs && closedDocs.length > 0) {
        surveyDoc = closedDocs[0];
      } else {
        // Last-resort fallback: an "open" survey whose window has ALREADY
        // PASSED (closeAt < now) but admin never flipped status — surface it
        // as last snapshot so the dashboard isn't blank. We treat it as
        // 'closed' in the response. We do NOT surface future-scheduled
        // surveys here (openAt > now) because those have never collected
        // responses and a blank "open" banner would be misleading.
        if (openDocs && openDocs.length > 0) {
          const expired = openDocs.find((d) => {
            const closeAt = d.get('closeAt');
            return typeof closeAt === 'string' && closeAt <= nowIso;
          });
          if (expired) surveyDoc = expired;
        }
      }
    }

    const emptySnapshot: CulturePulseSnapshot = {
      surveyId: null,
      status: null,
      openAt: null,
      closeAt: null,
      cultureIndex: 0,
      level: 'low',
      totalResponses: 0,
      expectedRespondents: null,
      participationRate: null,
      punitiveCulturedFlagged: false,
      byQuestion: {
        felt_safe_today: 0,
        manager_listens: 0,
        free_to_stop: 0,
        reported_incident_safely: 0,
        has_resources_to_be_safe: 0,
      },
      topConcerns: [],
      topStrengths: [],
      hasResponded: false,
    };

    if (!surveyDoc) {
      return res.json({ snapshot: emptySnapshot });
    }

    const survey = surveyDoc.data() as Omit<StoredPulseSurvey, 'id'>;
    const surveyId = surveyDoc.id;

    // Codex P1 #1 + P2 #2 round 2 (PR #323, line 5318) — Determine the
    // effective status. Required conditions for "open":
    //   - persisted status === 'open' (admin hasn't explicitly closed)
    //   - openAt has been reached (the wave has started)
    //   - closeAt has NOT been reached (the wave hasn't expired)
    //
    // Without the openAt check, a future-scheduled wave appears as the
    // active pulse with a CTA the respond endpoint then rejects with
    // `survey_not_open`. Without the closeAt check, expired waves keep
    // showing the response CTA. Both must be enforced at read time —
    // never trust the persisted creation-time status alone.
    const effectiveStatus: 'open' | 'closed' =
      survey.status === 'open' &&
      survey.openAt <= nowIso &&
      nowIso < survey.closeAt
        ? 'open'
        : 'closed';

    // Read all responses for aggregation.
    const responsesSnap = await safeRead<admin.firestore.QuerySnapshot | null>(
      () => baseRef.doc(surveyId).collection('responses').get(),
      null,
    );

    const responses =
      responsesSnap?.docs.map((d) => d.data() as StoredPulseResponse) ?? [];

    const callerHash = pulseResponderHash(callerUid, surveyId);
    const responderHashes = new Set(responses.map((r) => r.responderHash));
    const hasResponded = responderHashes.has(callerHash);

    const expectedRespondentsOut: number | null =
      typeof survey.expectedRespondents === 'number'
        ? survey.expectedRespondents
        : null;

    // ──────────────────────────────────────────────────────────────────
    // Codex P1 #3 (PR #323, line 5304) — PRIVACIDAD: umbral de anonimato.
    //
    // Si el conteo de respuestas es menor a PULSE_ANONYMITY_THRESHOLD (5),
    // suprimimos TODO agregado derivado (cultureIndex, level, byQuestion,
    // topConcerns, topStrengths, punitiveCulturedFlagged, participationRate).
    // Estos agregados con n<5 son trivialmente reversibles:
    //   - n=1: el promedio ES la respuesta del trabajador.
    //   - n=2-4: si un atacante conoce a un solo respondedor (ej.: él
    //     mismo respondió), puede restar su respuesta del promedio y
    //     derivar respuestas individuales del resto.
    //   - Un "top concern" con texto identificable (ej.: "supervisor X")
    //     en un grupo de 4 trabajadores re-identifica al disidente.
    //
    // Estado de la encuesta + conteo + flag de anonimato + `hasResponded`
    // SÍ se exponen porque no permiten re-identificación: indican
    // existencia y participación a nivel de actividad, no contenido.
    //
    // La directiva del producto ("Responses MUST be anonymous") aplica
    // por encima del control de acceso (guard sólo verifica membresía
    // de proyecto; cualquier miembro de la cuadrilla puede cargar este
    // snapshot, así que el endpoint no puede asumir que el lector sea
    // alguien autorizado a ver señales identificables).
    // ──────────────────────────────────────────────────────────────────
    if (responses.length < PULSE_ANONYMITY_THRESHOLD) {
      const suppressedSnapshot: CulturePulseSnapshot = {
        surveyId,
        status: effectiveStatus,
        openAt: survey.openAt,
        closeAt: survey.closeAt,
        cultureIndex: 0,
        level: 'low',
        totalResponses: responses.length,
        expectedRespondents: expectedRespondentsOut,
        participationRate: null,
        punitiveCulturedFlagged: false,
        byQuestion: {
          felt_safe_today: 0,
          manager_listens: 0,
          free_to_stop: 0,
          reported_incident_safely: 0,
          has_resources_to_be_safe: 0,
        },
        topConcerns: [],
        topStrengths: [],
        hasResponded,
        insufficientResponses: true,
        currentCount: responses.length,
        threshold: PULSE_ANONYMITY_THRESHOLD,
      };
      return res.json({ snapshot: suppressedSnapshot });
    }

    // n ≥ threshold — safe to surface aggregates.
    const index = computePulseIndex(responses);

    // Top concerns: questions with lowest avg. Top strengths: top.
    const ranked = (Object.keys(index.byQuestion) as PulseQuestionKey[])
      .map((k) => ({ key: k, label: PULSE_QUESTION_LABEL[k], score: index.byQuestion[k] }))
      .filter((r) => r.score > 0); // 0 only happens for empty surveys
    const sortedAsc = [...ranked].sort((a, b) => a.score - b.score);
    const sortedDesc = [...ranked].sort((a, b) => b.score - a.score);

    const participationRate =
      typeof survey.expectedRespondents === 'number' && survey.expectedRespondents > 0
        ? Math.min(1, responses.length / survey.expectedRespondents)
        : null;

    const snapshot: CulturePulseSnapshot = {
      surveyId,
      status: effectiveStatus,
      openAt: survey.openAt,
      closeAt: survey.closeAt,
      cultureIndex: index.cultureIndex,
      level: index.level,
      totalResponses: index.totalResponses,
      expectedRespondents: expectedRespondentsOut,
      participationRate,
      punitiveCulturedFlagged: index.punitiveCulturedFlagged,
      byQuestion: index.byQuestion,
      topConcerns: sortedAsc.slice(0, 5),
      topStrengths: sortedDesc.slice(0, 5),
      hasResponded,
    };

    return res.json({ snapshot });
  } catch (err) {
    logger.error?.('sprintK.culturePulse.snapshot.error', err);
    captureRouteError(err, 'sprintK.culturePulse.snapshot');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const culturePulseScheduleSchema = z
  .object({
    surveyId: z
      .string()
      .min(3)
      .max(120)
      // Restrict to filesystem-safe characters to avoid surprising
      // Firestore behaviour with `/` (sub-collection escape).
      .regex(/^[a-zA-Z0-9_-]+$/),
    openAt: z.string().min(10),
    closeAt: z.string().min(10),
    title: z.string().min(1).max(200).optional(),
    expectedRespondents: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.openAt < v.closeAt, {
    message: 'closeAt must be after openAt',
    path: ['closeAt'],
  });

// Codex P2 (PR #323, line 5343) — schedule de encuesta es admin-only.
// El UI sólo expone "Nueva encuesta" si `isAdmin`, pero la ruta sólo
// chequeaba membresía de proyecto vía `guard`, así que cualquier worker
// autenticado podía POSTear directo y alterar el dashboard de cultura
// (crear encuestas falsas, manipular conteos, "responder" la propia).
// Replicamos el patrón de PR #313/#319 P1 #1: `callerHasSupervisorRole`
// incluye admin/prevencionista/supervisor — el conjunto autorizado a
// programar olas de pulso de cultura.
const CULTURE_PULSE_SCHEDULE_ROLES = Array.from(QR_SIG_CHALLENGE_ROLES);

router.post(
  '/:projectId/culture-pulse/survey',
  verifyAuth,
  validate(culturePulseScheduleSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof culturePulseScheduleSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 (PR #323, line 5343) — role gate después de guard
    // (guard ya verificó membresía/tenant). Sin esto, cualquier worker
    // del proyecto podía crear/borrar encuestas vía POST directo.
    if (!callerHasSupervisorRole(req)) {
      return res
        .status(403)
        .json({ error: 'forbidden_role', allowed: CULTURE_PULSE_SCHEDULE_ROLES });
    }
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/culture_pulse`)
        .doc(body.surveyId);

      const existing = await docRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: 'survey_already_exists' });
      }

      const now = new Date().toISOString();
      const status: 'open' | 'closed' =
        body.closeAt > now ? 'open' : 'closed';

      const payload: StoredPulseSurvey = {
        id: body.surveyId,
        status,
        openAt: body.openAt,
        closeAt: body.closeAt,
        title: body.title,
        expectedRespondents: body.expectedRespondents,
        createdAt: now,
        createdBy: callerUid,
      };

      // Strip undefined fields — Firestore rejects them.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await docRef.set(cleaned, { merge: false });
      return res.status(201).json({ ok: true, survey: payload });
    } catch (err) {
      logger.error?.('sprintK.culturePulse.schedule.error', err);
      captureRouteError(err, 'sprintK.culturePulse.schedule');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const culturePulseResponseSchema = z.object({
  workerRole: z.string().min(1).max(120),
  area: z.string().min(1).max(120),
  answers: z.object({
    felt_safe_today: z.number().int().min(1).max(5),
    manager_listens: z.number().int().min(1).max(5),
    free_to_stop: z.number().int().min(1).max(5),
    reported_incident_safely: z.number().int().min(1).max(5),
    has_resources_to_be_safe: z.number().int().min(1).max(5),
  }),
});

router.post(
  '/:projectId/culture-pulse/survey/:id/respond',
  verifyAuth,
  validate(culturePulseResponseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id: surveyId } = req.params;
    const body = req.body as z.infer<typeof culturePulseResponseSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const surveyRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/culture_pulse`)
        .doc(surveyId);

      const surveySnap = await surveyRef.get();
      if (!surveySnap.exists) {
        return res.status(404).json({ error: 'survey_not_found' });
      }
      const survey = surveySnap.data() as Omit<StoredPulseSurvey, 'id'>;
      const now = new Date().toISOString();
      if (survey.status === 'closed' || now > survey.closeAt) {
        return res.status(409).json({ error: 'survey_closed' });
      }
      if (now < survey.openAt) {
        return res.status(409).json({ error: 'survey_not_open' });
      }

      // PRIVACY: the response doc is keyed by responder hash so the
      // same worker can only respond once per survey. We never store
      // `responderUid` on the doc. The hash is deterministic and
      // one-way for any outside observer.
      const responderHash = pulseResponderHash(callerUid, surveyId);
      const responseRef = surveyRef.collection('responses').doc(responderHash);

      const existing = await responseRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: 'already_responded' });
      }

      const responsePayload: StoredPulseResponse = {
        responderHash,
        workerRole: body.workerRole,
        area: body.area,
        answers: body.answers,
        submittedAt: now,
      };
      await responseRef.set(responsePayload);
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('sprintK.culturePulse.respond.error', err);
      captureRouteError(err, 'sprintK.culturePulse.respond');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

interface CulturePulseHistoryPoint {
  surveyId: string;
  closeAt: string | null;
  openAt: string;
  cultureIndex: number;
  totalResponses: number;
  level: 'low' | 'fair' | 'good' | 'strong';
}

router.get('/:projectId/culture-pulse/history', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { computePulseIndex } = await import(
      '../../services/culturePulse/safetyCulturePulse.js'
    );

    const db = admin.firestore();
    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
    );

    const safeRead = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.('sprintK.culturePulse.history.read_failed', err);
        return fallback;
      }
    };

    // Codex P1 #2 (PR #323, line 5217) — historic query también requiere
    // índice: `culture_pulse.orderBy(openAt desc)` corre dentro de la
    // sub-collection del proyecto, así que un índice single-field debería
    // bastar; pero por defensa, si la consulta falla con
    // FAILED_PRECONDITION caemos al unordered (cuesta más memoria, pero
    // el límite de docs por proyecto es bajo — son olas mensuales/
    // trimestrales, raramente >50 docs).
    const fetchHistoryOrdered = async (): Promise<
      admin.firestore.QueryDocumentSnapshot[]
    > => {
      try {
        const snap = await baseRef.orderBy('openAt', 'desc').limit(6).get();
        return snap.docs;
      } catch (err) {
        if (!isMissingFirestoreIndexError(err)) {
          logger.warn?.('sprintK.culturePulse.history.read_failed', err);
          return [];
        }
        logger.warn?.(
          'sprintK.culturePulse.history.missing_index_fallback',
          err,
        );
        try {
          const snap = await baseRef.get();
          const docs = snap.docs;
          docs.sort((a, b) => {
            const av = String(a.get('openAt') ?? '');
            const bv = String(b.get('openAt') ?? '');
            return bv.localeCompare(av); // desc
          });
          return docs.slice(0, 6);
        } catch (innerErr) {
          logger.warn?.(
            'sprintK.culturePulse.history.unordered_fallback_failed',
            innerErr,
          );
          return [];
        }
      }
    };

    const surveyDocs = await fetchHistoryOrdered();
    const points: CulturePulseHistoryPoint[] = [];
    for (const surveyDoc of surveyDocs) {
      const survey = surveyDoc.data() as Omit<StoredPulseSurvey, 'id'>;
      const responsesSnap = await safeRead<admin.firestore.QuerySnapshot | null>(
        () => surveyDoc.ref.collection('responses').get(),
        null,
      );
      const responses =
        responsesSnap?.docs.map((d) => d.data() as StoredPulseResponse) ?? [];
      // Codex P1 #3 (PR #323, line 5304) — anonimato también en history.
      // Aunque el sparkline sólo expone `cultureIndex` agregado, con
      // n<5 ese índice ES re-identificable; suprimimos el índice y
      // dejamos sólo metadatos de existencia + conteo + nivel neutro.
      const insufficient = responses.length < PULSE_ANONYMITY_THRESHOLD;
      const idx = computePulseIndex(responses);
      points.push({
        surveyId: surveyDoc.id,
        openAt: survey.openAt,
        closeAt: survey.closeAt ?? null,
        cultureIndex: insufficient ? 0 : idx.cultureIndex,
        totalResponses: responses.length,
        level: insufficient ? 'low' : idx.level,
      });
    }

    // Sort ascending (oldest first) for the sparkline.
    points.sort((a, b) => a.openAt.localeCompare(b.openAt));
    return res.json({ history: points });
  } catch (err) {
    logger.error?.('sprintK.culturePulse.history.error', err);
    captureRouteError(err, 'sprintK.culturePulse.history');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Fase §185-190 — Base de Conocimiento + Curador + Obsolescencia
// ────────────────────────────────────────────────────────────────────────
//
// Surface end-to-end para el repositorio de artículos consultables. El
// motor determinístico (`services/knowledgeBase/knowledgeBaseService.ts`)
// ya implementa búsqueda léxica con scoring, detector de obsolescencia
// (stale/low_engagement/low_rating/manually_flagged) y métricas de
// reutilización. Estos endpoints exponen lectura/escritura sobre
// Firestore para que la página los consuma:
//
//   GET    /:projectId/knowledge-base?category=X&search=Y
//   POST   /:projectId/knowledge-base
//   POST   /:projectId/knowledge-base/:id/use
//   POST   /:projectId/knowledge-base/:id/flag-obsolete
//
// Diseño:
//
//   - Persistencia: `tenants/{tid}/projects/{pid}/knowledge_base/{id}`.
//     Tenant-scoped para reutilización entre proyectos del mismo tenant,
//     pero filtrado server-side por proyecto seleccionado. Los artículos
//     `sourceType: 'lesson'` permiten enlazar de vuelta a F.12 sin
//     duplicar el almacenamiento.
//
//   - Búsqueda: si la query incluye `?search=foo`, se reusa
//     `searchArticles()` del motor sobre la lista cargada. La búsqueda
//     léxica es 100% client-side al endpoint (Firestore no tiene
//     full-text nativo y queremos mantener el determinismo).
//
//   - Filtro por categoría: `?category=glossary|faq|procedure|guide|
//     norm_summary|lesson|experience|standard|procedure`. El alias
//     `category` se mapea contra el `kind` legacy del motor + nuevos
//     `sourceType` para no romper el SKU del servicio.
//
//   - Mutaciones determinísticas: `/use` incrementa viewCount + bumpea
//     `lastReviewedAt`. `/flag-obsolete` setea `isObsolete=true` con
//     `obsoleteReason` y `obsoleteAt` para auditoría posterior.

const kbCreateSchema = z.object({
  title: z.string().min(3).max(300),
  content: z.string().min(3).max(20_000),
  category: z
    .enum(['glossary', 'faq', 'procedure', 'guide', 'norm_summary'])
    .optional()
    .default('guide'),
  tags: z.array(z.string().min(1).max(100)).max(50).optional().default([]),
  sourceType: z
    .enum(['lesson', 'procedure', 'standard', 'experience'])
    .optional()
    .default('experience'),
});

const kbFlagObsoleteSchema = z.object({
  reason: z.string().min(3).max(2000),
});

router.get('/:projectId/knowledge-base', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const category =
      typeof req.query.category === 'string' && req.query.category.length > 0
        ? req.query.category
        : null;
    const search =
      typeof req.query.search === 'string' && req.query.search.length > 0
        ? req.query.search
        : null;

    // Tenant-scoped collection — entries are reusable across projects
    // of the same tenant. Per the §185-190 spec, knowledge can be
    // shared up; the page filters by category client-side.
    const colRef = db
      .collection('tenants')
      .doc(g.tenantId)
      .collection('projects')
      .doc(projectId)
      .collection('knowledge_base');

    // Best-effort read with graceful degradation; first read tries
    // project-scoped, then falls back to a tenant-level shared store
    // (some tenants seed glossary at tenant root).
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.knowledgeBase.read.${label}.failed`, err);
        return [];
      }
    };

    type KbDoc = {
      id: string;
      kind: 'glossary' | 'faq' | 'procedure' | 'guide' | 'norm_summary';
      title: string;
      content: string;
      tags: string[];
      lastReviewedAt: string;
      viewCount: number;
      averageRating?: number;
      isObsolete: boolean;
      authorUid: string;
      sourceType?: 'lesson' | 'procedure' | 'standard' | 'experience';
      obsoleteReason?: string;
      obsoleteAt?: string;
    };

    const projectEntries = await safeRead<KbDoc>('project', async () => {
      const snap = await colRef.get();
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          kind: (typeof data.kind === 'string' ? data.kind : 'guide') as KbDoc['kind'],
          title: typeof data.title === 'string' ? data.title : '',
          content: typeof data.content === 'string' ? data.content : '',
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          lastReviewedAt:
            typeof data.lastReviewedAt === 'string'
              ? data.lastReviewedAt
              : new Date(0).toISOString(),
          viewCount:
            typeof data.viewCount === 'number' && Number.isFinite(data.viewCount)
              ? data.viewCount
              : 0,
          averageRating:
            typeof data.averageRating === 'number' ? data.averageRating : undefined,
          isObsolete: Boolean(data.isObsolete),
          authorUid: typeof data.authorUid === 'string' ? data.authorUid : 'unknown',
          sourceType:
            typeof data.sourceType === 'string'
              ? (data.sourceType as KbDoc['sourceType'])
              : 'experience',
          obsoleteReason:
            typeof data.obsoleteReason === 'string' ? data.obsoleteReason : undefined,
          obsoleteAt:
            typeof data.obsoleteAt === 'string' ? data.obsoleteAt : undefined,
        };
      });
    });

    // Filter by category — `category` is an alias for `kind` to keep the
    // §185-190 spec's preferred terminology while reusing the engine.
    let entries = projectEntries;
    if (category) {
      entries = entries.filter((e) => e.kind === category);
    }

    // Lexical search via the engine. We pre-filter then search so the
    // category narrows the search-space first.
    if (search) {
      const { searchArticles } = await import(
        '../../services/knowledgeBase/knowledgeBaseService.js'
      );
      const results = searchArticles(entries, search, {
        excludeObsolete: false,
      });
      return res.json({
        entries: results,
        searched: true,
        category: category ?? null,
      });
    }

    return res.json({
      entries,
      searched: false,
      category: category ?? null,
    });
  } catch (err) {
    logger.error?.('sprintK.knowledgeBase.list.error', err);
    captureRouteError(err, 'sprintK.knowledgeBase.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post(
  '/:projectId/knowledge-base',
  verifyAuth,
  validate(kbCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof kbCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const colRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base');

      const now = new Date().toISOString();
      const docRef = colRef.doc();
      const entry = {
        id: docRef.id,
        kind: body.category,
        title: body.title,
        content: body.content,
        tags: body.tags,
        lastReviewedAt: now,
        viewCount: 0,
        isObsolete: false,
        authorUid: callerUid,
        sourceType: body.sourceType,
        createdAt: now,
      };
      await docRef.set(entry);
      return res.status(201).json({ entry });
    } catch (err) {
      logger.error?.('sprintK.knowledgeBase.create.error', err);
      captureRouteError(err, 'sprintK.knowledgeBase.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/knowledge-base/:id/use',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base')
        .doc(id);

      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });

      // Atomic increment via Firestore FieldValue. We also bump
      // `lastReviewedAt` so the obsolescence detector treats actively-
      // used entries as fresh enough to skip the stale gate.
      await docRef.update({
        viewCount: admin.firestore.FieldValue.increment(1),
        lastReviewedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      });
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.knowledgeBase.use.error', err);
      captureRouteError(err, 'sprintK.knowledgeBase.use');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/knowledge-base/:id/flag-obsolete',
  verifyAuth,
  validate(kbFlagObsoleteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof kbFlagObsoleteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base')
        .doc(id);

      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });

      await docRef.update({
        isObsolete: true,
        obsoleteReason: body.reason,
        obsoleteAt: new Date().toISOString(),
        obsoleteByUid: callerUid,
      });
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.knowledgeBase.flagObsolete.error', err);
      captureRouteError(err, 'sprintK.knowledgeBase.flagObsolete');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Sprint K §195-200 — Ciclo PDCA + No Conformidades (ISO 45001 §10.2)
// ─────────────────────────────────────────────────────────────────────
//
// Exposes the deterministic PDCA cycle engine (services/pdca/*) over
// HTTP so the page can render a kanban-style Plan/Do/Check/Act board
// linked to non-conformities (NC). Storage:
//
//   tenants/{tid}/projects/{pid}/pdca_cycles/{id}        — PDCAProject
//   tenants/{tid}/projects/{pid}/non_conformities/{id}   — NonConformity
//
// All reads go through `safeRead<T>` so a single collection failure
// (missing index, permissions hiccup) doesn't blank the whole board —
// the panel shows the partial state honestly.
//
// IMPORTANT: this endpoint NEVER pushes to external regulators
// (SUSESO/SII/MINSAL/OSHA). It only persists the cycle so the company
// can later sign + submit on its own surface (Directiva 3 from
// product_signing_no_blocking_directives_2026-05-06).

const pdcaOriginEnum = z.enum(['audit', 'incident', 'finding', 'inspection']);

const pdcaCreateSchema = z.object({
  id: z.string().min(1),
  nonConformityId: z.string().min(1),
  origin: pdcaOriginEnum,
  ownerUid: z.string().min(1),
  notes: z.string().max(4000).optional(),
  startedAt: z.string().min(10).optional(),
});

const pdcaAdvanceSchema = z.object({
  evidence: z.array(z.string().min(1)).min(1).max(50),
  notes: z.string().max(4000).optional(),
  efficacyScore: z.number().min(0).max(100).optional(),
});

const ncCreateSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1).max(200),
  severity: z.enum(['minor', 'major', 'critical']),
  description: z.string().min(3).max(4000),
  location: z.string().min(1).max(400),
  detectedAt: z.string().min(10).optional(),
  taskId: z.string().min(1).optional(),
  responsibleUid: z.string().min(1),
});

/** Internal: safe parallel reader so a single failure doesn't blank the board. */
async function pdcaSafeRead<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    logger.warn?.(`sprintK.pdca.read.${label}.failed`, err);
    return [];
  }
}

// GET /:projectId/pdca/cycles — list active PDCA cycles
router.get('/:projectId/pdca/cycles', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const path = `tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`;
    const cycles = await pdcaSafeRead('cycles', async () => {
      const snap = await db.collection(path).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });
    return res.json({ cycles });
  } catch (err) {
    logger.error?.('sprintK.pdca.list.error', err);
    captureRouteError(err, 'sprintK.pdca.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /:projectId/pdca/cycles — create a new cycle for an NC
router.post(
  '/:projectId/pdca/cycles',
  verifyAuth,
  validate(pdcaCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof pdcaCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const nowIso = body.startedAt ?? new Date().toISOString();
      const project = {
        id: body.id,
        currentStage: 'plan' as const,
        cycleNumber: 1,
        nonConformityId: body.nonConformityId,
        origin: body.origin,
        ownerUid: body.ownerUid,
        createdAt: nowIso,
        createdByUid: callerUid,
        stages: [
          {
            kind: 'plan' as const,
            activityId: `${body.id}-cycle-1-plan`,
            notes: body.notes ?? '',
            ownerUid: body.ownerUid,
            startedAt: nowIso,
          },
        ],
      };
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`)
        .doc(body.id)
        .set(project, { merge: false });
      return res.status(201).json({ ok: true, cycle: project });
    } catch (err) {
      logger.error?.('sprintK.pdca.create.error', err);
      captureRouteError(err, 'sprintK.pdca.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// POST /:projectId/pdca/cycles/:id/advance — advance to the next stage
router.post(
  '/:projectId/pdca/cycles/:id/advance',
  verifyAuth,
  validate(pdcaAdvanceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof pdcaAdvanceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { advanceStage } = await import(
        '../../services/pdca/pdcaCycleEngine.js'
      );
      type PdcaStage = 'plan' | 'do' | 'check' | 'act';
      interface PdcaEntry {
        kind: PdcaStage;
        activityId: string;
        notes: string;
        ownerUid: string;
        startedAt: string;
        completedAt?: string;
        evidence?: string[];
        efficacyScore?: number;
      }
      interface StoredCycle {
        id: string;
        currentStage: PdcaStage;
        stages: PdcaEntry[];
        cycleNumber: number;
        nonConformityId?: string;
        origin?: string;
        ownerUid?: string;
        createdAt?: string;
        createdByUid?: string;
      }
      const db = admin.firestore();
      const ref = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`)
        .doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'cycle_not_found' });
      }
      const stored = snap.data() as StoredCycle;
      const nowIso = new Date().toISOString();

      // Close the current stage with the supplied notes/efficacyScore
      // before handing off to the engine — `advanceStage` requires the
      // last entry to carry `completedAt`.
      const stages = [...(stored.stages ?? [])];
      let lastIdx = -1;
      for (let i = stages.length - 1; i >= 0; i--) {
        if (stages[i].kind === stored.currentStage) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx < 0) {
        return res.status(400).json({ error: 'no_entry_for_current_stage' });
      }
      const closed: PdcaEntry = {
        ...stages[lastIdx],
        completedAt: nowIso,
        notes: body.notes ?? stages[lastIdx].notes,
      };
      if (
        stored.currentStage === 'act' &&
        typeof body.efficacyScore === 'number'
      ) {
        closed.efficacyScore = body.efficacyScore;
      }
      stages[lastIdx] = closed;

      const result = advanceStage(
        {
          id: stored.id,
          currentStage: stored.currentStage,
          stages,
          cycleNumber: stored.cycleNumber,
        },
        body.evidence,
        nowIso,
      );
      if (!result.advanced) {
        return res.status(400).json({
          error: 'cannot_advance',
          reason: result.reason ?? 'unknown',
        });
      }
      const merged: StoredCycle = {
        ...stored,
        currentStage: result.project.currentStage,
        stages: result.project.stages as PdcaEntry[],
        cycleNumber: result.project.cycleNumber,
      };
      await ref.set(merged, { merge: false });
      return res.json({ ok: true, cycle: merged });
    } catch (err) {
      logger.error?.('sprintK.pdca.advance.error', err);
      captureRouteError(err, 'sprintK.pdca.advance');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// GET /:projectId/pdca/non-conformities — list NCs feeding the cycles
router.get(
  '/:projectId/pdca/non-conformities',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const path = `tenants/${g.tenantId}/projects/${projectId}/non_conformities`;
      const ncs = await pdcaSafeRead('non_conformities', async () => {
        const snap = await db.collection(path).get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      });
      return res.json({ nonConformities: ncs });
    } catch (err) {
      logger.error?.('sprintK.pdca.nc.list.error', err);
      captureRouteError(err, 'sprintK.pdca.nc.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// POST /:projectId/pdca/non-conformities — create a NC inline
router.post(
  '/:projectId/pdca/non-conformities',
  verifyAuth,
  validate(ncCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof ncCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const nc = {
        id: body.id,
        category: body.category,
        severity: body.severity,
        description: body.description,
        location: body.location,
        detectedAt: body.detectedAt ?? new Date().toISOString(),
        taskId: body.taskId,
        responsibleUid: body.responsibleUid,
        status: 'open' as const,
        createdByUid: callerUid,
      };
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/non_conformities`,
        )
        .doc(body.id)
        .set(nc, { merge: false });
      return res.status(201).json({ ok: true, nonConformity: nc });
    } catch (err) {
      logger.error?.('sprintK.pdca.nc.create.error', err);
      captureRouteError(err, 'sprintK.pdca.nc.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// GET /:projectId/pdca/summary — counts per phase + closure rate
router.get('/:projectId/pdca/summary', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    type PdcaStage = 'plan' | 'do' | 'check' | 'act';
    interface StoredCycleRow {
      id: string;
      currentStage?: PdcaStage;
      stages?: Array<{ kind: PdcaStage; completedAt?: string }>;
      cycleNumber?: number;
    }
    const db = admin.firestore();
    const cyclesPath = `tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`;
    const cycles = await pdcaSafeRead<StoredCycleRow>('cycles', async () => {
      const snap = await db.collection(cyclesPath).get();
      return snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as StoredCycleRow,
      );
    });

    const byPhase: Record<PdcaStage, number> = {
      plan: 0,
      do: 0,
      check: 0,
      act: 0,
    };
    let closedCycles = 0;
    for (const c of cycles) {
      const stage: PdcaStage = (c.currentStage ?? 'plan') as PdcaStage;
      byPhase[stage] = (byPhase[stage] ?? 0) + 1;
      // A cycle is "closed" when at least one full P→D→C→A round
      // completed (cycleNumber > 1 OR the act stage has a completedAt).
      const hasCompletedAct = (c.stages ?? []).some(
        (s) => s.kind === 'act' && !!s.completedAt,
      );
      if ((c.cycleNumber ?? 1) > 1 || hasCompletedAct) closedCycles += 1;
    }
    const total = cycles.length;
    const closureRate =
      total > 0 ? Math.round((closedCycles / total) * 100) : 0;

    return res.json({
      summary: {
        total,
        byPhase,
        closedCycles,
        closureRate,
      },
    });
  } catch (err) {
    logger.error?.('sprintK.pdca.summary.error', err);
    captureRouteError(err, 'sprintK.pdca.summary');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Sprint K §90-91 — Calidad de Proveedores + Ranking de Riesgo
// ────────────────────────────────────────────────────────────────────────
//
// Endpoints HTTP que exponen el motor determinístico de scoring de
// proveedores/contratistas (`supplierScoring.ts`) + calidad SLA
// (`supplierQualityService.ts`).

const supplierRiskLevels = ['low', 'medium', 'high'] as const;
type SupplierRiskLevel = (typeof supplierRiskLevels)[number];

interface StoredSupplierIncident {
  id: string;
  occurredAt: string;
  severity: 'near_miss' | 'incident';
  description: string;
  recordedByUid: string;
}

interface StoredSupplierAudit {
  id: string;
  auditedAt: string;
  documentComplianceRatio: number;
  avgResponseHours: number;
  reputationScore: number;
  notes?: string;
  recordedByUid: string;
}

interface StoredSupplier {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  registeredByUid: string;
  incidents: StoredSupplierIncident[];
  audits: StoredSupplierAudit[];
}

function latestAudit(audits: StoredSupplierAudit[]): StoredSupplierAudit | null {
  if (audits.length === 0) return null;
  const sorted = [...audits].sort((a, b) => b.auditedAt.localeCompare(a.auditedAt));
  return sorted[0];
}

function latestIncidentAt(incidents: StoredSupplierIncident[]): string | null {
  if (incidents.length === 0) return null;
  return incidents
    .map((i) => i.occurredAt)
    .sort((a, b) => b.localeCompare(a))[0];
}

function deriveKpis(s: StoredSupplier, now: number = Date.now()): SupplierKpis {
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(now - TWELVE_MONTHS_MS).toISOString();
  const recent = s.incidents.filter((i) => i.occurredAt >= cutoffIso);
  const incidents = recent.filter((i) => i.severity === 'incident').length;
  const nearMisses = recent.filter((i) => i.severity === 'near_miss').length;
  const audit = latestAudit(s.audits);
  const documentComplianceRatio = audit ? audit.documentComplianceRatio : 0.5;
  const avgResponseHours = audit ? audit.avgResponseHours : 24;
  const reputationScore = audit ? audit.reputationScore : 0.5;
  return {
    incidents,
    nearMisses,
    documentComplianceRatio,
    avgResponseHours,
    reputationScore,
  };
}

function riskLevelForScore(score: number): SupplierRiskLevel {
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

function deriveTrend(s: StoredSupplier, now: number = Date.now()): 'improving' | 'stable' | 'worsening' {
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const recentCut = new Date(now - TWELVE_MONTHS_MS).toISOString();
  const priorCut = new Date(now - 2 * TWELVE_MONTHS_MS).toISOString();
  const recent = s.incidents.filter((i) => i.occurredAt >= recentCut).length;
  const prior = s.incidents.filter(
    (i) => i.occurredAt >= priorCut && i.occurredAt < recentCut,
  ).length;
  if (recent < prior) return 'improving';
  if (recent > prior) return 'worsening';
  return 'stable';
}

interface SupplierView {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  score: number;
  riskLevel: SupplierRiskLevel;
  trend: 'improving' | 'stable' | 'worsening';
  lastIncidentAt: string | null;
  lastAuditAt: string | null;
  incidentCount: number;
  auditCount: number;
}

function toView(s: StoredSupplier): SupplierView {
  const kpis = deriveKpis(s);
  const record: SupplierRecord = { id: s.id, legalName: s.legalName, kpis };
  let scored: ScoredSupplier;
  try {
    scored = scoreSupplier(record);
  } catch {
    scored = {
      id: s.id,
      legalName: s.legalName,
      score: 0,
      breakdown: {
        safetyPerformance: 0,
        documentCompliance: 0,
        responsiveness: 0,
        reputation: 0,
      },
    };
  }
  const audit = latestAudit(s.audits);
  return {
    id: s.id,
    legalName: s.legalName,
    taxId: s.taxId,
    services: s.services,
    criticalRoles: s.criticalRoles,
    active: s.active,
    registeredAt: s.registeredAt,
    score: scored.score,
    riskLevel: riskLevelForScore(scored.score),
    trend: deriveTrend(s),
    lastIncidentAt: latestIncidentAt(s.incidents),
    lastAuditAt: audit ? audit.auditedAt : null,
    incidentCount: s.incidents.length,
    auditCount: s.audits.length,
  };
}

async function readSuppliers(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
): Promise<StoredSupplier[]> {
  const snap = await db
    .collection(`tenants/${tenantId}/projects/${projectId}/suppliers`)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      legalName: typeof data.legalName === 'string' ? data.legalName : '',
      taxId: typeof data.taxId === 'string' ? data.taxId : '',
      services: Array.isArray(data.services)
        ? (data.services as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      criticalRoles: Array.isArray(data.criticalRoles)
        ? (data.criticalRoles as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      active: typeof data.active === 'boolean' ? data.active : true,
      registeredAt:
        typeof data.registeredAt === 'string' ? data.registeredAt : new Date(0).toISOString(),
      registeredByUid:
        typeof data.registeredByUid === 'string' ? data.registeredByUid : 'unknown',
      incidents: Array.isArray(data.incidents)
        ? (data.incidents as StoredSupplierIncident[])
        : [],
      audits: Array.isArray(data.audits)
        ? (data.audits as StoredSupplierAudit[])
        : [],
    } as StoredSupplier;
  });
}

const supplierListQuerySchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high', 'all']).optional(),
});

router.get('/:projectId/suppliers', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const parsed = supplierListQuerySchema.safeParse({
    riskLevel: typeof req.query.riskLevel === 'string' ? req.query.riskLevel : undefined,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query' });
  }
  const filter = parsed.data.riskLevel ?? 'all';
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.suppliers.read.${label}.failed`, err);
        return [];
      }
    };
    const stored = await safeRead('suppliers', () =>
      readSuppliers(admin.firestore(), g.tenantId, projectId),
    );
    const views = stored.map(toView);
    const filtered =
      filter === 'all' ? views : views.filter((s) => s.riskLevel === filter);
    return res.json({ suppliers: filtered, total: views.length });
  } catch (err) {
    logger.error?.('sprintK.suppliers.list.error', err);
    captureRouteError(err, 'sprintK.suppliers.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const supplierCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(2).max(200),
  taxId: z.string().min(2).max(40),
  services: z.array(z.string().min(1).max(80)).min(1).max(40),
  criticalRoles: z.array(z.string().min(1).max(120)).max(40).optional(),
  active: z.boolean().optional(),
});

router.post(
  '/:projectId/suppliers',
  verifyAuth,
  validate(supplierCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof supplierCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const collection = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/suppliers`,
      );
      const docRef = body.id ? collection.doc(body.id) : collection.doc();
      const supplier: StoredSupplier = {
        id: docRef.id,
        legalName: body.name,
        taxId: body.taxId,
        services: body.services,
        criticalRoles: body.criticalRoles ?? [],
        active: body.active ?? true,
        registeredAt: new Date().toISOString(),
        registeredByUid: callerUid,
        incidents: [],
        audits: [],
      };
      await docRef.set(supplier, { merge: false });
      return res.status(201).json({ ok: true, supplier: toView(supplier) });
    } catch (err) {
      logger.error?.('sprintK.suppliers.create.error', err);
      captureRouteError(err, 'sprintK.suppliers.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const supplierIncidentSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  occurredAt: z.string().min(10).max(40),
  severity: z.enum(['near_miss', 'incident']),
  description: z.string().min(3).max(2000),
});

router.post(
  '/:projectId/suppliers/:id/incidents',
  verifyAuth,
  validate(supplierIncidentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof supplierIncidentSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/suppliers`)
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'supplier_not_found' });
      }
      const data = snap.data() as Partial<StoredSupplier>;
      const incidents = Array.isArray(data.incidents) ? data.incidents : [];
      const entry: StoredSupplierIncident = {
        id: body.id ?? db.collection('_ids').doc().id,
        occurredAt: body.occurredAt,
        severity: body.severity,
        description: body.description,
        recordedByUid: callerUid,
      };
      await docRef.set(
        {
          incidents: [...incidents, entry],
          lastIncidentAt: entry.occurredAt,
        },
        { merge: true },
      );
      return res.status(201).json({ ok: true, incident: entry });
    } catch (err) {
      logger.error?.('sprintK.suppliers.incident.error', err);
      captureRouteError(err, 'sprintK.suppliers.incident');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const supplierAuditSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  auditedAt: z.string().min(10).max(40),
  documentComplianceRatio: z.number().min(0).max(1),
  avgResponseHours: z.number().min(0).max(720),
  reputationScore: z.number().min(0).max(1),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/suppliers/:id/audits',
  verifyAuth,
  validate(supplierAuditSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof supplierAuditSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/suppliers`)
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'supplier_not_found' });
      }
      const data = snap.data() as Partial<StoredSupplier>;
      const audits = Array.isArray(data.audits) ? data.audits : [];
      const entry: StoredSupplierAudit = {
        id: body.id ?? db.collection('_ids').doc().id,
        auditedAt: body.auditedAt,
        documentComplianceRatio: body.documentComplianceRatio,
        avgResponseHours: body.avgResponseHours,
        reputationScore: body.reputationScore,
        notes: body.notes,
        recordedByUid: callerUid,
      };
      await docRef.set(
        {
          audits: [...audits, entry],
          lastAuditAt: entry.auditedAt,
        },
        { merge: true },
      );
      return res.status(201).json({ ok: true, audit: entry });
    } catch (err) {
      logger.error?.('sprintK.suppliers.audit.error', err);
      captureRouteError(err, 'sprintK.suppliers.audit');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get('/:projectId/suppliers/ranking', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.suppliers.read.${label}.failed`, err);
        return [];
      }
    };
    const stored = await safeRead('suppliers_ranking', () =>
      readSuppliers(admin.firestore(), g.tenantId, projectId),
    );
    if (stored.length === 0) {
      return res.json({ ranking: [], total: 0 });
    }
    const records: SupplierRecord[] = stored.map((s) => ({
      id: s.id,
      legalName: s.legalName,
      kpis: deriveKpis(s),
    }));
    const scored = rankSuppliersByScore(records);
    const byId = new Map(stored.map((s) => [s.id, s]));
    const ranking = scored.map((sc, idx) => {
      const s = byId.get(sc.id)!;
      const view = toView(s);
      return {
        rank: idx + 1,
        ...view,
        breakdown: sc.breakdown,
      };
    });
    return res.json({ ranking, total: ranking.length });
  } catch (err) {
    logger.error?.('sprintK.suppliers.ranking.error', err);
    captureRouteError(err, 'sprintK.suppliers.ranking');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Sprint K §291-295 — Revisión Anual del SGI (ISO 45001 §9.3)
// ────────────────────────────────────────────────────────────────────────

const annualReviewPath = (tenantId: string, projectId: string, year: number) =>
  `tenants/${tenantId}/projects/${projectId}/annual_reviews/${year}`;

const objectiveInputSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  description: z.string().max(4000).default(''),
  metric: z.enum([
    'count_reduction',
    'count_increase',
    'percent_completion',
    'percent_reduction',
  ]),
  baseline: z.number().finite(),
  target: z.number().finite(),
  currentValue: z.number().finite().default(0),
  deadline: z.string().min(10),
  ownerUid: z.string().min(1).max(200),
  status: z
    .enum(['planned', 'in_progress', 'on_track', 'at_risk', 'achieved', 'missed'])
    .default('planned'),
  linkedActionIds: z.array(z.string().min(1)).max(500).default([]),
  evidenceUrls: z.array(z.string().min(1)).max(500).default([]),
});

const setObjectivesSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  objectives: z.array(objectiveInputSchema).max(200),
});

const evidenceSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  objectiveId: z.string().min(1).max(200),
  evidenceUrl: z.string().min(1).max(2000),
  evidenceKind: z
    .enum(['document', 'audit', 'incident', 'training', 'other'])
    .default('other'),
  caption: z.string().max(500).optional(),
});

const concludeSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  conclusion: z.string().min(10).max(8000),
  signedOffByUid: z.string().min(1).max(200),
  signedOffByName: z.string().min(1).max(300),
});

interface AnnualReviewEvidence {
  objectiveId: string;
  evidenceUrl: string;
  evidenceKind: 'document' | 'audit' | 'incident' | 'training' | 'other';
  caption?: string;
  attachedAt: string;
  attachedByUid: string;
}

interface AnnualReviewSnapshot {
  fiscalYear: number;
  tenantId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  updatedByUid: string;
  objectives: import('../../services/annualReview/annualSgiReview.js').PreventiveObjective[];
  evidences: AnnualReviewEvidence[];
  analysis: string;
  conclusion: string | null;
  signedOffByUid: string | null;
  signedOffByName: string | null;
  concludedAt: string | null;
  isConcluded: boolean;
}

function defaultSnapshot(
  tenantId: string,
  projectId: string,
  year: number,
  uid: string,
): AnnualReviewSnapshot {
  const now = new Date().toISOString();
  return {
    fiscalYear: year,
    tenantId,
    projectId,
    createdAt: now,
    updatedAt: now,
    updatedByUid: uid,
    objectives: [],
    evidences: [],
    analysis: '',
    conclusion: null,
    signedOffByUid: null,
    signedOffByName: null,
    concludedAt: null,
    isConcluded: false,
  };
}

router.get(
  '/:projectId/annual-review/current',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const yearParam =
        typeof req.query.year === 'string' ? Number.parseInt(req.query.year, 10) : NaN;
      const year =
        Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
          ? yearParam
          : new Date().getUTCFullYear();
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, year));
      const safeRead = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.annualReview.read.${label}.failed`, err);
          return null;
        }
      };
      const snap = await safeRead('snapshot', async () => ref.get());
      const exists = snap?.exists ?? false;
      const snapshot: AnnualReviewSnapshot | null = exists
        ? ((snap!.data() as AnnualReviewSnapshot) ?? null)
        : null;
      return res.json({ year, exists, snapshot });
    } catch (err) {
      logger.error?.('sprintK.annualReview.current.error', err);
      captureRouteError(err, 'sprintK.annualReview.current');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/annual-review/objectives',
  verifyAuth,
  validate(setObjectivesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof setObjectivesSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, body.year));
      const snap = await ref.get();
      const existing = snap.exists
        ? (snap.data() as AnnualReviewSnapshot)
        : defaultSnapshot(g.tenantId, projectId, body.year, callerUid);
      if (existing.isConcluded) {
        return res.status(409).json({ error: 'review_already_concluded' });
      }
      const objectives = body.objectives.map((o) => ({
        id: o.id,
        fiscalYear: body.year,
        title: o.title,
        description: o.description,
        metric: o.metric,
        baseline: o.baseline,
        target: o.target,
        currentValue: o.currentValue,
        deadline: o.deadline,
        ownerUid: o.ownerUid,
        status: o.status,
        linkedActionIds: o.linkedActionIds,
        evidenceUrls: o.evidenceUrls,
      }));
      const next: AnnualReviewSnapshot = {
        ...existing,
        objectives,
        analysis:
          typeof (req.body as Record<string, unknown>).analysis === 'string'
            ? ((req.body as Record<string, unknown>).analysis as string).slice(0, 8000)
            : existing.analysis,
        updatedAt: new Date().toISOString(),
        updatedByUid: callerUid,
      };
      await ref.set(next, { merge: false });
      return res.status(200).json({ ok: true, snapshot: next });
    } catch (err) {
      logger.error?.('sprintK.annualReview.objectives.error', err);
      captureRouteError(err, 'sprintK.annualReview.objectives');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/annual-review/evidence',
  verifyAuth,
  validate(evidenceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evidenceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, body.year));
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'review_not_found' });
      }
      const existing = snap.data() as AnnualReviewSnapshot;
      if (existing.isConcluded) {
        return res.status(409).json({ error: 'review_already_concluded' });
      }
      const obj = existing.objectives.find((o) => o.id === body.objectiveId);
      if (!obj) {
        return res.status(404).json({ error: 'objective_not_found' });
      }
      const now = new Date().toISOString();
      const newEvidence: AnnualReviewEvidence = {
        objectiveId: body.objectiveId,
        evidenceUrl: body.evidenceUrl,
        evidenceKind: body.evidenceKind,
        caption: body.caption,
        attachedAt: now,
        attachedByUid: callerUid,
      };
      const isDup = existing.evidences.some(
        (e) =>
          e.objectiveId === newEvidence.objectiveId &&
          e.evidenceUrl === newEvidence.evidenceUrl,
      );
      const nextEvidences = isDup
        ? existing.evidences
        : [...existing.evidences, newEvidence];
      const nextObjectives = existing.objectives.map((o) => {
        if (o.id !== body.objectiveId) return o;
        if (o.evidenceUrls.includes(body.evidenceUrl)) return o;
        return { ...o, evidenceUrls: [...o.evidenceUrls, body.evidenceUrl] };
      });
      const next: AnnualReviewSnapshot = {
        ...existing,
        objectives: nextObjectives,
        evidences: nextEvidences,
        updatedAt: now,
        updatedByUid: callerUid,
      };
      await ref.set(next, { merge: false });
      return res.status(200).json({ ok: true, snapshot: next });
    } catch (err) {
      logger.error?.('sprintK.annualReview.evidence.error', err);
      captureRouteError(err, 'sprintK.annualReview.evidence');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/annual-review/conclude',
  verifyAuth,
  validate(concludeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof concludeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, body.year));
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'review_not_found' });
      }
      const existing = snap.data() as AnnualReviewSnapshot;
      if (existing.isConcluded) {
        return res.status(409).json({ error: 'review_already_concluded' });
      }
      const now = new Date().toISOString();
      const next: AnnualReviewSnapshot = {
        ...existing,
        conclusion: body.conclusion,
        signedOffByUid: body.signedOffByUid,
        signedOffByName: body.signedOffByName,
        concludedAt: now,
        isConcluded: true,
        updatedAt: now,
        updatedByUid: callerUid,
      };
      await ref.set(next, { merge: false });
      return res.status(200).json({ ok: true, snapshot: next });
    } catch (err) {
      logger.error?.('sprintK.annualReview.conclude.error', err);
      captureRouteError(err, 'sprintK.annualReview.conclude');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);


export default router;
