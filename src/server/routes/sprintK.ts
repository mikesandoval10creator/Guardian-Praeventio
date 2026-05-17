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
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';

const router = Router();

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
          // collection commonly has: name/fullName, hireDate or
          // createdAt, optional fatigueRisk + nightShiftHistory.
          const hireRaw =
            typeof data.hireDate === 'string'
              ? data.hireDate
              : typeof data.createdAt === 'string'
                ? data.createdAt
                : null;
          const hireDate = hireRaw ? new Date(hireRaw) : null;
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
        const snap = await byProject('incidents')
          .where('occurredAt', '>=', sevenDaysAgo)
          .limit(50)
          .get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const sev = typeof data.severity === 'string' ? data.severity : 'medium';
          return {
            id: d.id,
            severity: (['low', 'medium', 'high', 'critical'].includes(sev)
              ? sev
              : 'medium') as 'low' | 'medium' | 'high' | 'critical',
            occurredAt: String(
              data.occurredAt ?? data.createdAt ?? new Date().toISOString(),
            ),
          };
        });
      }),
      safeRead('tasks', async () => {
        // Tasks may have `plannedDate` / `scheduledFor` and a
        // `criticality` or boolean `isCriticalTask` flag. Read both
        // conservatively. The composer only needs id + category +
        // isCriticalTask + requiresPermit.
        const snap = await byProject('tasks').limit(100).get();
        return snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const planned =
              typeof data.plannedDate === 'string'
                ? data.plannedDate
                : typeof data.scheduledFor === 'string'
                  ? data.scheduledFor
                  : null;
            // Filter in JS so we don't need a Firestore composite index
            // for plannedDate + criticality.
            if (planned && planned < todayStartIso) return null;
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
        const snap = await byProject('assets').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const nextMaintRaw =
            typeof data.nextMaintenanceAt === 'string'
              ? data.nextMaintenanceAt
              : typeof data.nextMaintenance === 'string'
                ? data.nextMaintenance
                : null;
          const overdue = nextMaintRaw
            ? new Date(nextMaintRaw).getTime() < Date.now()
            : false;
          return {
            id: d.id,
            code: String(data.code ?? data.name ?? d.id),
            overdueMaintenance: overdue,
          };
        });
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

    // Map environment doc (NASA POWER / Open-Meteo cached blob) to
    // ShiftRiskInputs.weather. Use conservative defaults when fields
    // are missing so the composer always returns a valid score.
    const envDoc = environment[0] ?? {};
    const env = envDoc as Record<string, unknown>;
    const weather = {
      rainProbability:
        typeof env.rainProbability === 'number'
          ? env.rainProbability
          : 0,
      windSpeedMs:
        typeof env.windSpeedMs === 'number'
          ? env.windSpeedMs
          : typeof env.windSpeed === 'number'
            ? (env.windSpeed as number)
            : 0,
      uvIndex: typeof env.uvIndex === 'number' ? env.uvIndex : 0,
      temperatureC:
        typeof env.temperatureC === 'number'
          ? env.temperatureC
          : typeof env.temperature === 'number'
            ? (env.temperature as number)
            : 20,
      lightningRiskWithinHours:
        typeof env.lightningRiskWithinHours === 'number'
          ? env.lightningRiskWithinHours
          : undefined,
      visibilityKm:
        typeof env.visibilityKm === 'number' ? env.visibilityKm : 10,
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

export default router;
