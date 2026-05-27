// Praeventio Guard — PYME Wizard (fast onboarding plan) HTTP surface.
//
// Sprint K §105 — one stateless endpoint over the engine under
// `src/services/pymeWizard/pymeOnboardingWizard.ts`:
//
//   POST /:projectId/pyme-wizard/build-plan
//     body: PymeOnboardingInput
//     200:  { plan: OnboardingPlan }
//     400:  { error } cuando workerCount < 1
//
// Quick onboarding < 30 minutos para empresas 5-50 trabajadores. Cubre
// críticos legales (RIOHS + CPHS si aplica) + training por riesgo +
// módulos recomendados por industria.

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
  buildOnboardingPlan,
  type PymeOnboardingInput,
  type PymeIndustry,
  type PymeKeyRisk,
} from '../../services/pymeWizard/pymeOnboardingWizard.js';

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

const INDUSTRIES = [
  'construction',
  'mining',
  'agriculture',
  'industrial',
  'logistics',
  'services',
  'retail',
] as const satisfies readonly PymeIndustry[];

const KEY_RISKS = [
  'falls_from_height',
  'chemical_exposure',
  'manual_handling',
  'vehicle_traffic',
  'noise',
  'electrical',
  'fire',
  'psychosocial',
  'biological',
] as const satisfies readonly PymeKeyRisk[];

const inputSchema = z.object({
  industry: z.enum(INDUSTRIES),
  workerCount: z.number().int().positive().max(10_000_000),
  keyRisks: z.array(z.enum(KEY_RISKS)).max(KEY_RISKS.length),
  hasExistingRiohs: z.boolean().optional(),
  hasExistingCphs: z.boolean().optional(),
}) as unknown as z.ZodType<PymeOnboardingInput>;

router.post(
  '/:projectId/pyme-wizard/build-plan',
  verifyAuth,
  validate(inputSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof inputSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = buildOnboardingPlan(body);
      return res.json({ plan });
    } catch (err) {
      if (err instanceof Error && err.message.includes('workerCount')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('pymeWizard.buildPlan.error', err);
      captureRouteError(err, 'pymeWizard.buildPlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
