// Praeventio Guard — Skill Gap Analyzer HTTP surface.
//
// Sprint 51 §246-249: rotación / cross-training, plan capacitación
// brecha individual, matriz polivalencia, sustitución entre trabajadores
// por skill.
//
// 4 stateless endpoints over the engine under
// `src/services/skillGap/skillGapAnalyzer.ts`:
//
//   POST /:projectId/skills/analyze-gaps
//     body: { workerSkills, requirements, now? }
//     200:  { gaps: SkillGap[] }
//
//   POST /:projectId/skills/build-training-plan
//     body: { gaps, skillsCatalog, now?, hoursPerWeek? }
//     200:  { plan: TrainingPlan }
//
//   POST /:projectId/skills/polyvalence-matrix
//     body: { crew, requiredSkills, now? }
//     200:  { matrix: PolyvalenceMatrix }
//
//   POST /:projectId/skills/find-substitutes
//     body: { crew, absentUid, requirementsForRole, now? }
//     200:  { candidates: SubstitutionCandidate[] }
//
// Pure compute — no Firestore writes. Caller persists the resulting
// training plan / polyvalence matrix to their own collection.

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
  analyzeWorkerGaps,
  buildTrainingPlan,
  buildPolyvalenceMatrix,
  findSubstitutes,
  type CrewMember,
  type RequiredSkill,
  type SkillDefinition,
  type SkillGap,
  type WorkerSkill,
} from '../../services/skillGap/skillGapAnalyzer.js';

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

// Engine shapes are nested enough that the HTTP layer accepts them
// loosely via z.unknown() casts — the engine validates internally.
const workerSkillsSchema = z.unknown() as unknown as z.ZodType<WorkerSkill[]>;
const requirementsSchema = z.unknown() as unknown as z.ZodType<RequiredSkill[]>;
const skillsCatalogSchema = z.unknown() as unknown as z.ZodType<SkillDefinition[]>;
const crewSchema = z.unknown() as unknown as z.ZodType<CrewMember[]>;
const gapsSchema = z.unknown() as unknown as z.ZodType<SkillGap[]>;

// ────────────────────────────────────────────────────────────────────────
// 1. analyze-gaps
// ────────────────────────────────────────────────────────────────────────

const analyzeGapsSchema = z.object({
  workerSkills: workerSkillsSchema,
  requirements: requirementsSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/skills/analyze-gaps',
  verifyAuth,
  validate(analyzeGapsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof analyzeGapsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const gaps = analyzeWorkerGaps(body.workerSkills, body.requirements, {
        now: body.now ? new Date(body.now) : new Date(),
      });
      return res.json({ gaps });
    } catch (err) {
      logger.error?.('skillGap.analyzeGaps.error', err);
      captureRouteError(err, 'skillGap.analyzeGaps');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-training-plan
// ────────────────────────────────────────────────────────────────────────

const buildPlanSchema = z.object({
  gaps: gapsSchema,
  skillsCatalog: skillsCatalogSchema,
  now: z.string().min(10).optional(),
  hoursPerWeek: z.number().positive().max(40).optional(),
});

router.post(
  '/:projectId/skills/build-training-plan',
  verifyAuth,
  validate(buildPlanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildPlanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = buildTrainingPlan(body.gaps, body.skillsCatalog, {
        now: body.now ? new Date(body.now) : new Date(),
        hoursPerWeek: body.hoursPerWeek,
      });
      return res.json({ plan });
    } catch (err) {
      logger.error?.('skillGap.buildTrainingPlan.error', err);
      captureRouteError(err, 'skillGap.buildTrainingPlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. polyvalence-matrix
// ────────────────────────────────────────────────────────────────────────

const polyvalenceSchema = z.object({
  crew: crewSchema,
  requiredSkills: requirementsSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/skills/polyvalence-matrix',
  verifyAuth,
  validate(polyvalenceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof polyvalenceSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const matrix = buildPolyvalenceMatrix(body.crew, body.requiredSkills, {
        now: body.now ? new Date(body.now) : new Date(),
      });
      return res.json({ matrix });
    } catch (err) {
      logger.error?.('skillGap.polyvalenceMatrix.error', err);
      captureRouteError(err, 'skillGap.polyvalenceMatrix');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. find-substitutes
// ────────────────────────────────────────────────────────────────────────

const findSubsSchema = z.object({
  crew: crewSchema,
  absentUid: z.string().min(1).max(120),
  requirementsForRole: requirementsSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/skills/find-substitutes',
  verifyAuth,
  validate(findSubsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof findSubsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const candidates = findSubstitutes(
        body.crew,
        body.absentUid,
        body.requirementsForRole,
        { now: body.now ? new Date(body.now) : new Date() },
      );
      return res.json({ candidates });
    } catch (err) {
      logger.error?.('skillGap.findSubstitutes.error', err);
      captureRouteError(err, 'skillGap.findSubstitutes');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
