// Praeventio Guard — Contingency Simulation HTTP surface.
//
// Sprint 52 §237-242: scenario builder + tabletop exercise evaluator
// for continuity / emergency preparedness drills.
//
// 4 stateless endpoints over the engines under
// `src/services/contingencySimulation/`:
//
//   POST /:projectId/contingency/build-scenario
//     body: { kind, severity, options? }
//     200:  { scenario: ContingencyScenario }
//     400:  unknown kind → { error }
//
//   POST /:projectId/contingency/list-available-scenarios
//     body: { industry? }
//     200:  { scenarios: ContingencyScenario[] }
//
//   POST /:projectId/contingency/count-available-templates
//     body: {}
//     200:  { count: number }
//
//   POST /:projectId/contingency/evaluate-tabletop
//     body: { attempt, scenario }
//     200:  { result: TabletopResult }
//     400:  scenario mismatch → { error }
//
// Both engines are pure compute — no Firestore writes. Caller persists
// scenarios + tabletop results to their own collections.

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
  buildScenario,
  listAvailableScenarios,
  countAvailableTemplates,
  type BuildScenarioOptions,
  type ContingencyScenario,
} from '../../services/contingencySimulation/contingencyScenarioBuilder.js';
import {
  evaluateTabletop,
  type TabletopAttempt,
} from '../../services/contingencySimulation/tabletopExerciseEngine.js';

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

const SCENARIO_KINDS = [
  'fire',
  'earthquake',
  'flood',
  'chemical_spill',
  'power_outage',
  'cyber_attack',
  'mass_casualty',
  'evacuation_blocked',
  'leader_unavailable',
  'supplier_failure',
] as const;

const SCENARIO_SEVERITIES = [
  'minor',
  'moderate',
  'major',
  'catastrophic',
] as const;

const INDUSTRIES = [
  'construction',
  'mining',
  'industrial',
  'logistics',
  'office',
  'healthcare',
] as const;

const TIME_OF_DAY = ['day', 'night', 'shift_change'] as const;

const initialConditionsSchema = z.object({
  time: z.enum(TIME_OF_DAY).optional(),
  weather: z.string().min(1).max(120).optional(),
  staffPresent: z.number().int().nonnegative().max(100_000).optional(),
  criticalSystemsDown: z.array(z.string().min(1).max(120)).max(50).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// 1. build-scenario
// ────────────────────────────────────────────────────────────────────────

const buildScenarioSchema = z.object({
  kind: z.enum(SCENARIO_KINDS),
  severity: z.enum(SCENARIO_SEVERITIES),
  options: z
    .object({
      id: z.string().min(1).max(200).optional(),
      initialConditions: initialConditionsSchema.optional(),
      industry: z.enum(INDUSTRIES).optional(),
    })
    .optional() as unknown as z.ZodType<BuildScenarioOptions | undefined>,
});

router.post(
  '/:projectId/contingency/build-scenario',
  verifyAuth,
  validate(buildScenarioSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildScenarioSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const scenario = buildScenario(body.kind, body.severity, body.options);
      return res.json({ scenario });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Sin plantilla')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('contingencySimulation.buildScenario.error', err);
      captureRouteError(err, 'contingencySimulation.buildScenario');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. list-available-scenarios
// ────────────────────────────────────────────────────────────────────────

const listScenariosSchema = z.object({
  industry: z.enum(INDUSTRIES).optional(),
});

router.post(
  '/:projectId/contingency/list-available-scenarios',
  verifyAuth,
  validate(listScenariosSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof listScenariosSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const scenarios = listAvailableScenarios(body.industry);
      return res.json({ scenarios });
    } catch (err) {
      logger.error?.('contingencySimulation.listScenarios.error', err);
      captureRouteError(err, 'contingencySimulation.listScenarios');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. count-available-templates
// ────────────────────────────────────────────────────────────────────────

const countTemplatesSchema = z.object({}).strict();

router.post(
  '/:projectId/contingency/count-available-templates',
  verifyAuth,
  validate(countTemplatesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const count = countAvailableTemplates();
      return res.json({ count });
    } catch (err) {
      logger.error?.('contingencySimulation.countTemplates.error', err);
      captureRouteError(err, 'contingencySimulation.countTemplates');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. evaluate-tabletop
// ────────────────────────────────────────────────────────────────────────

// TabletopAttempt + ContingencyScenario are deep nested shapes; the engine
// validates the rest internally. But it dereferences attempt.scenarioId and
// scenario.id BEFORE any of its own checks, so a missing/undefined attempt or
// scenario used to slip past validation and throw a TypeError → 500 instead of
// a clean 400. Require at least those keys here. `.passthrough()` keeps the
// remaining fields and the cast preserves the engine-call types; the handler
// reads the original `req.body` (validate() does not mutate it), so the full
// payload still reaches evaluateTabletop().
const tabletopAttemptSchema = z
  .object({ scenarioId: z.string() })
  .passthrough() as unknown as z.ZodType<TabletopAttempt>;
const scenarioSchema = z
  .object({ id: z.string() })
  .passthrough() as unknown as z.ZodType<ContingencyScenario>;

const evaluateTabletopSchema = z.object({
  attempt: tabletopAttemptSchema,
  scenario: scenarioSchema,
});

router.post(
  '/:projectId/contingency/evaluate-tabletop',
  verifyAuth,
  validate(evaluateTabletopSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evaluateTabletopSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = evaluateTabletop(body.attempt, body.scenario);
      return res.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Scenario mismatch')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('contingencySimulation.evaluateTabletop.error', err);
      captureRouteError(err, 'contingencySimulation.evaluateTabletop');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
