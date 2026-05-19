// Praeventio Guard — Product Adoption Analytics HTTP surface.
//
// Sprint K §164-170 — four stateless endpoints over the engine under
// `src/services/adoption/adoptionAnalytics.ts`:
//
//   POST /:projectId/adoption/module-adoption     { snapshots }
//   POST /:projectId/adoption/funnel              { snapshots }
//   POST /:projectId/adoption/churn-risk          { snapshot }
//   POST /:projectId/adoption/first-value         { events, nowIso? }
//
// Pure compute — no Firestore writes. Note: `TenantUsageSnapshot.activeModules`
// is `Set<ModuleUsageKind>` in the engine, which is not JSON-serializable;
// the route accepts string[] and converts to Set before invoking.

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
  buildModuleAdoptionReport,
  buildFunnelReport,
  assessChurnRisk,
  buildFirstValueReport,
  type TenantUsageSnapshot,
  type ModuleUsageKind,
  type FirstValueEvent,
} from '../../services/adoption/adoptionAnalytics.js';

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

const MODULES: readonly ModuleUsageKind[] = [
  'projects',
  'workers',
  'incidents',
  'findings',
  'documents',
  'cphs',
  'training',
  'epp',
  'audit_portal',
  'sitebook',
  'work_permits',
];

const snapshotWireSchema = z.object({
  tenantId: z.string().min(1).max(200),
  snapshotAt: z.string().min(10),
  daysSinceSignup: z.number().int().nonnegative().max(36_500),
  activeModules: z.array(z.enum(MODULES as readonly [ModuleUsageKind, ...ModuleUsageKind[]])).max(MODULES.length),
  events30d: z.number().int().nonnegative().max(1_000_000_000),
  activeWorkers: z.number().int().nonnegative().max(10_000_000),
  activeProjects: z.number().int().nonnegative().max(10_000_000),
  hasPaidPlan: z.boolean(),
});

function deserializeSnapshot(s: z.infer<typeof snapshotWireSchema>): TenantUsageSnapshot {
  return {
    tenantId: s.tenantId,
    snapshotAt: s.snapshotAt,
    daysSinceSignup: s.daysSinceSignup,
    activeModules: new Set(s.activeModules),
    events30d: s.events30d,
    activeWorkers: s.activeWorkers,
    activeProjects: s.activeProjects,
    hasPaidPlan: s.hasPaidPlan,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 1. module-adoption
// ────────────────────────────────────────────────────────────────────────

const snapshotsSchema = z.object({
  snapshots: z.array(snapshotWireSchema).max(50_000),
});

router.post(
  '/:projectId/adoption/module-adoption',
  verifyAuth,
  validate(snapshotsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof snapshotsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildModuleAdoptionReport(body.snapshots.map(deserializeSnapshot));
      return res.json({ report });
    } catch (err) {
      logger.error?.('adoption.moduleAdoption.error', err);
      captureRouteError(err, 'adoption.moduleAdoption');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. funnel
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/adoption/funnel',
  verifyAuth,
  validate(snapshotsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof snapshotsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildFunnelReport(body.snapshots.map(deserializeSnapshot));
      return res.json({ report });
    } catch (err) {
      logger.error?.('adoption.funnel.error', err);
      captureRouteError(err, 'adoption.funnel');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. churn-risk
// ────────────────────────────────────────────────────────────────────────

const churnSchema = z.object({
  snapshot: snapshotWireSchema,
});

router.post(
  '/:projectId/adoption/churn-risk',
  verifyAuth,
  validate(churnSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof churnSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = assessChurnRisk(deserializeSnapshot(body.snapshot));
      return res.json({ report });
    } catch (err) {
      logger.error?.('adoption.churnRisk.error', err);
      captureRouteError(err, 'adoption.churnRisk');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. first-value
// ────────────────────────────────────────────────────────────────────────

const firstValueEventSchema = z.object({
  tenantId: z.string().min(1).max(200),
  signupAt: z.string().min(10),
  firstValueAt: z.string().min(10).optional(),
}) as unknown as z.ZodType<FirstValueEvent>;

const firstValueSchema = z.object({
  events: z.array(firstValueEventSchema).max(50_000),
  nowIso: z.string().min(10).optional(),
});

router.post(
  '/:projectId/adoption/first-value',
  verifyAuth,
  validate(firstValueSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof firstValueSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildFirstValueReport(body.events, body.nowIso);
      return res.json({ report });
    } catch (err) {
      logger.error?.('adoption.firstValue.error', err);
      captureRouteError(err, 'adoption.firstValue');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
