// Praeventio Guard — Sprint K endpoints bridge.
//
// Endpoints HTTP que exponen los servicios Sprint L/K al frontend.
// Patrón consistente con insights.ts: verifyAuth + projectMember +
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

// ────────────────────────────────────────────────────────────────────────
// Vulnerability map
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/vulnerability/latest', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// SIF precursors
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/sif/pending-review', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
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
    const callerUid = (req as any).user.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof sifReviewSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// Positive observations
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/positive-observations/worker/:workerUid',
  verifyAuth,
  async (req, res) => {
    const callerUid = (req as any).user.uid;
    const { projectId, workerUid } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return;
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
    const callerUid = (req as any).user.uid;
    const callerRole = (req as any).user.role ?? 'worker';
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof positiveObsSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// Waste inventory
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/waste/inventory', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// Visitors
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/visitors/active', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// Lessons learned (tenant-scoped, but still gated by project membership)
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/lessons', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
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
    const callerUid = (req as any).user.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof lessonSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// Corrective actions
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/corrective-actions', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
  try {
    const adapter = new CorrectiveActionsAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    const validStatus =
      status === 'open' || status === 'closed' || status === 'verified'
        ? status
        : 'open';
    const [byStatus, systemic] = await Promise.all([
      adapter.listByStatus(validStatus as 'open' | 'closed' | 'verified'),
      adapter.listSystemic(),
    ]);
    return res.json({ actions: byStatus, systemic });
  } catch (err) {
    logger.error?.('sprintK.correctiveActions.list.error', err);
    captureRouteError(err, 'sprintK.correctiveActions.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

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
    const callerUid = (req as any).user.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof correctiveActionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// LOTO digital
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/loto', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
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

// ────────────────────────────────────────────────────────────────────────
// Equipment
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/equipment', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return;
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

export default router;
