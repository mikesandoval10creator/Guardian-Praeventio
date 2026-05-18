// Praeventio Guard — Business Continuity HTTP surface.
//
// Sprint K §237-243 — three stateless endpoints over the engine under
// `src/services/continuity/continuityPlanning.ts`:
//
//   POST /:projectId/continuity/detect-spofs
//     body: { input: ContinuityInput }
//     200:  { spofs: SinglePointOfFailure[] }
//
//   POST /:projectId/continuity/simulate-outage
//     body: { input: ScenarioInput }
//     200:  { outcome: ScenarioOutcome }
//
//   POST /:projectId/continuity/build-polyvalence-plan
//     body: { matrix: Array<{ workerUid, skills: string[] }>, requiredSkills, minCoveragePercent? }
//     200:  { plan: PolyvalencePlan }
//
// Pure compute — no Firestore writes. Determinístico, sin LLM. Note: the
// engine's SkillMatrix uses Set<string> which is not JSON-serializable;
// the route accepts string[] and converts before invoking the engine.

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
  detectSPOFs,
  simulateOutage,
  buildPolyvalencePlan,
  type ContinuityInput,
  type SinglePointOfFailure,
  type ScenarioInput,
  type SkillMatrix,
} from '../../services/continuity/continuityPlanning.js';

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

const SPOF_KINDS = ['person', 'equipment', 'supplier', 'document', 'permit'] as const;
const IMPACT_SCOPES = ['operational', 'safety', 'compliance'] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. detect-spofs
// ────────────────────────────────────────────────────────────────────────

const continuityInputSchema = z.object({
  uniqueSkillHolders: z.array(z.object({
    uid: z.string().min(1).max(200),
    skill: z.string().min(1).max(500),
    dependentTasks: z.array(z.string().min(1).max(500)).max(500),
  })).max(5000),
  equipmentWithoutBackup: z.array(z.object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(500),
    dependentTasks: z.array(z.string().min(1).max(500)).max(500),
  })).max(5000),
  soleSuppliers: z.array(z.object({
    supplierId: z.string().min(1).max(200),
    service: z.string().min(1).max(500),
  })).max(5000),
  unbackedCriticalDocs: z.array(z.object({
    docId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
  })).max(5000),
}) as unknown as z.ZodType<ContinuityInput>;

const detectSchema = z.object({
  input: continuityInputSchema,
});

router.post(
  '/:projectId/continuity/detect-spofs',
  verifyAuth,
  validate(detectSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof detectSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const spofs = detectSPOFs(body.input);
      return res.json({ spofs });
    } catch (err) {
      logger.error?.('continuity.detectSPOFs.error', err);
      captureRouteError(err, 'continuity.detectSPOFs');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. simulate-outage
// ────────────────────────────────────────────────────────────────────────

const spofSchema = z.object({
  kind: z.enum(SPOF_KINDS),
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  dependentTasks: z.array(z.string().min(1).max(500)).max(500),
  impactScopes: z.array(z.enum(IMPACT_SCOPES)).max(IMPACT_SCOPES.length),
  mitigation: z.string().min(1).max(2000),
}) as unknown as z.ZodType<SinglePointOfFailure>;

const scenarioSchema = z.object({
  resourceId: z.string().min(1).max(200),
  resourceKind: z.enum(SPOF_KINDS),
  outageHours: z.number().nonnegative().max(8760),
  spofs: z.array(spofSchema).max(5000),
}) as unknown as z.ZodType<ScenarioInput>;

const simulateSchema = z.object({
  input: scenarioSchema,
});

router.post(
  '/:projectId/continuity/simulate-outage',
  verifyAuth,
  validate(simulateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof simulateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const outcome = simulateOutage(body.input);
      return res.json({ outcome });
    } catch (err) {
      logger.error?.('continuity.simulateOutage.error', err);
      captureRouteError(err, 'continuity.simulateOutage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. build-polyvalence-plan
// ────────────────────────────────────────────────────────────────────────

const polyvalenceSchema = z.object({
  matrix: z.array(z.object({
    workerUid: z.string().min(1).max(200),
    skills: z.array(z.string().min(1).max(200)).max(500),
  })).max(20_000),
  requiredSkills: z.array(z.string().min(1).max(200)).max(500),
  minCoveragePercent: z.number().min(0).max(100).optional(),
});

router.post(
  '/:projectId/continuity/build-polyvalence-plan',
  verifyAuth,
  validate(polyvalenceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof polyvalenceSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const matrix: SkillMatrix[] = body.matrix.map((m) => ({
        workerUid: m.workerUid,
        skills: new Set(m.skills),
      }));
      const plan = buildPolyvalencePlan(matrix, body.requiredSkills, body.minCoveragePercent);
      return res.json({ plan });
    } catch (err) {
      logger.error?.('continuity.buildPolyvalencePlan.error', err);
      captureRouteError(err, 'continuity.buildPolyvalencePlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
