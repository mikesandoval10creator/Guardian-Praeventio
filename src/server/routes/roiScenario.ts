// Praeventio Guard — ROI Scenario Comparator HTTP surface.
//
// Sprint 53 §175 extendido — multi-scenario comparator de inversiones HSE
// sobre `roiCalculator.ts` (Sprint 51) con sensitivity band ±20% y
// recommendationScore 0-100.
//
// 1 stateless endpoint over the engine under
// `src/services/roiScenario/roiScenarioSimulator.ts`:
//
//   POST /:projectId/roi-scenario/compare
//     body: { scenarios, baseline }
//     200:  { comparison: ScenarioComparison }
//
// Pure compute — no Firestore writes.

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
  compareScenarios,
  type InvestmentScenario,
  type BaselineState,
} from '../../services/roiScenario/roiScenarioSimulator.js';

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

const PREVENTION_CATEGORIES = ['training', 'epp', 'engineering', 'controls', 'audits'] as const;
const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

const scenarioInvestmentSchema = z.object({
  category: z.enum(PREVENTION_CATEGORIES),
  amountClp: z.number().nonnegative().max(1e15),
});

const scenarioAssumptionsSchema = z.object({
  expectedIncidentReductionPct: z.number().min(0).max(100),
  expectedComplianceImprovementPct: z.number().min(0).max(100),
  paybackMonthsEstimate: z.number().nonnegative().max(1200),
  confidenceLevel: z.enum(CONFIDENCE_LEVELS),
});

const investmentScenarioSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  description: z.string().min(0).max(2000),
  investments: z.array(scenarioInvestmentSchema).min(0).max(50),
  assumptions: scenarioAssumptionsSchema,
}) as unknown as z.ZodType<InvestmentScenario>;

const baselineStateSchema = z.object({
  averageDirectCostPerIncidentClp: z.number().nonnegative().max(1e15),
  baselineRatePerYear: z.number().nonnegative().max(100_000),
  workersCount: z.number().int().nonnegative().max(10_000_000),
  indirectMultiplier: z.number().nonnegative().max(20),
}) as unknown as z.ZodType<BaselineState>;

const compareSchema = z.object({
  scenarios: z.array(investmentScenarioSchema).min(1).max(20),
  baseline: baselineStateSchema,
});

router.post(
  '/:projectId/roi-scenario/compare',
  verifyAuth,
  validate(compareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof compareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const comparison = compareScenarios(body.scenarios, body.baseline);
      return res.json({ comparison });
    } catch (err) {
      logger.error?.('roiScenario.compare.error', err);
      captureRouteError(err, 'roiScenario.compare');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
