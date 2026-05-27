// Praeventio Guard — PYME Onboarding (Maturity + 30-day plan) HTTP surface.
//
// Sprint K §104-105, §110, F.26 — two stateless endpoints over the engine
// under `src/services/pymeOnboarding/pymeWizard.ts`:
//
//   POST /:projectId/pyme-onboarding/maturity
//     body: PymeWizardInput
//     200:  { maturity: MaturityReport }
//
//   POST /:projectId/pyme-onboarding/plan
//     body: { maturity, industry }
//     200:  { plan: PlanAction[] }
//
// Determinístico, sin LLM.

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
  computeMaturity,
  buildThirtyDayPlan,
  type PymeWizardInput,
  type MaturityReport,
  type PymeIndustry,
} from '../../services/pymeOnboarding/pymeWizard.js';

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

const PYME_INDUSTRIES = [
  'construction',
  'mining',
  'agriculture',
  'industrial',
  'logistics',
  'services',
] as const satisfies readonly PymeIndustry[];

const MATURITY_LABELS = [
  'reactive',
  'compliant',
  'proactive',
  'systematic',
  'autonomous',
] as const;

const wizardInputSchema = z.object({
  industry: z.enum(PYME_INDUSTRIES),
  workerCount: z.number().int().nonnegative().max(10_000_000),
  hasSupervisor: z.boolean(),
  hasCphs: z.boolean(),
  hasRiohs: z.boolean(),
  hasTrainingProgram: z.boolean(),
  registersIncidents: z.boolean(),
  hasMutualidad: z.boolean(),
  usesNormedEpp: z.boolean(),
}) as unknown as z.ZodType<PymeWizardInput>;

// ────────────────────────────────────────────────────────────────────────
// 1. maturity
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/pyme-onboarding/maturity',
  verifyAuth,
  validate(wizardInputSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof wizardInputSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const maturity = computeMaturity(body);
      return res.json({ maturity });
    } catch (err) {
      logger.error?.('pymeOnboarding.maturity.error', err);
      captureRouteError(err, 'pymeOnboarding.maturity');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. plan (30 days)
// ────────────────────────────────────────────────────────────────────────

const maturitySchema = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  label: z.enum(MATURITY_LABELS),
  score: z.number().min(0).max(100),
  missingCapabilities: z.array(z.string().max(1000)).max(200),
  nextSteps: z.array(z.string().max(1000)).max(200),
}) as unknown as z.ZodType<MaturityReport>;

const planSchema = z.object({
  maturity: maturitySchema,
  industry: z.enum(PYME_INDUSTRIES),
});

router.post(
  '/:projectId/pyme-onboarding/plan',
  verifyAuth,
  validate(planSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof planSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = buildThirtyDayPlan(body.maturity, body.industry);
      return res.json({ plan });
    } catch (err) {
      logger.error?.('pymeOnboarding.plan.error', err);
      captureRouteError(err, 'pymeOnboarding.plan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
