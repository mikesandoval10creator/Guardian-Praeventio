// Praeventio Guard — Root cause classifier HTTP surface.
//
// Sprint 39 I.3 (§28) — two stateless endpoints over the engine under
// `src/services/rootCause/rootCauseClassifier.ts`:
//
//   POST /:projectId/root-cause/build-analysis    { input }
//   POST /:projectId/root-cause/compute-stats     { analyses }
//
// Plus three pure helpers from noBlameInvestigation:
//
//   POST /:projectId/root-cause/analyze-punitive-language  { text }
//   POST /:projectId/root-cause/get-investigation-questions { dimension }
//   POST /:projectId/root-cause/get-starter-questionnaire   {}
//
// Pure compute — no Firestore writes. analyzedByUid forced to caller on
// build-analysis.

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
  buildAnalysis,
  computeStats,
  RootCauseValidationError,
  type RootCauseAnalysis,
  type CauseFactor,
} from '../../services/rootCause/rootCauseClassifier.js';
import {
  analyzePunitiveLanguage,
  getInvestigationQuestions,
  getStarterQuestionnaire,
  type InvestigationDimension,
} from '../../services/rootCause/noBlameInvestigation.js';

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

const FACTORS: readonly CauseFactor[] = [
  'condicion_subestandar',
  'acto_subestandar',
  'falla_supervision',
  'falla_procedimiento',
  'falla_mantenimiento',
  'factor_ambiental',
  'factor_organizacional',
  'falla_capacitacion',
  'falla_epp',
  'falla_diseno',
];

const analysisSchema = z.object({
  incidentId: z.string().min(1).max(200),
  factors: z.array(z.enum(FACTORS as readonly [CauseFactor, ...CauseFactor[]])).max(FACTORS.length),
  primaryFactor: z.enum(FACTORS as readonly [CauseFactor, ...CauseFactor[]]),
  fiveWhys: z.array(z.string().min(1).max(2000)).max(5),
  analyzedByUid: z.string().min(1).max(200),
  analyzedAt: z.string().min(10),
  suggestedActions: z.array(z.string().min(1).max(2000)).max(50),
}) as unknown as z.ZodType<RootCauseAnalysis>;

// ────────────────────────────────────────────────────────────────────────
// 1. build-analysis (analyzedByUid forced)
// ────────────────────────────────────────────────────────────────────────

const buildSchema = z.object({
  incidentId: z.string().min(1).max(200),
  factors: z.array(z.enum(FACTORS as readonly [CauseFactor, ...CauseFactor[]])).min(1).max(FACTORS.length),
  primaryFactor: z.enum(FACTORS as readonly [CauseFactor, ...CauseFactor[]]),
  fiveWhys: z.array(z.string().min(15).max(2000)).min(1).max(5),
  suggestedActions: z.array(z.string().min(1).max(2000)).min(1).max(50),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/root-cause/build-analysis',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const analysis = buildAnalysis({
        incidentId: body.incidentId,
        factors: body.factors,
        primaryFactor: body.primaryFactor,
        fiveWhys: body.fiveWhys,
        analyzedByUid: callerUid,
        suggestedActions: body.suggestedActions,
        now: body.now ? new Date(body.now) : undefined,
      });
      return res.json({ analysis });
    } catch (err) {
      if (err instanceof RootCauseValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('rootCause.buildAnalysis.error', err);
      captureRouteError(err, 'rootCause.buildAnalysis');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. compute-stats
// ────────────────────────────────────────────────────────────────────────

const statsSchema = z.object({
  analyses: z.array(analysisSchema).max(50_000),
});

router.post(
  '/:projectId/root-cause/compute-stats',
  verifyAuth,
  validate(statsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof statsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const stats = computeStats(body.analyses);
      return res.json({ stats });
    } catch (err) {
      logger.error?.('rootCause.computeStats.error', err);
      captureRouteError(err, 'rootCause.computeStats');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. analyze-punitive-language
// ────────────────────────────────────────────────────────────────────────

const punitiveSchema = z.object({
  text: z.string().min(0).max(100_000),
});

router.post(
  '/:projectId/root-cause/analyze-punitive-language',
  verifyAuth,
  validate(punitiveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof punitiveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = analyzePunitiveLanguage(body.text);
      return res.json({ report });
    } catch (err) {
      logger.error?.('rootCause.analyzePunitiveLanguage.error', err);
      captureRouteError(err, 'rootCause.analyzePunitiveLanguage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. get-investigation-questions
// ────────────────────────────────────────────────────────────────────────

const dimensionSchema = z.object({
  dimension: z.string().min(1).max(50),
});

router.post(
  '/:projectId/root-cause/get-investigation-questions',
  verifyAuth,
  validate(dimensionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof dimensionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const questions = getInvestigationQuestions(body.dimension as InvestigationDimension);
      return res.json({ questions });
    } catch (err) {
      logger.error?.('rootCause.getInvestigationQuestions.error', err);
      captureRouteError(err, 'rootCause.getInvestigationQuestions');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. get-starter-questionnaire
// ────────────────────────────────────────────────────────────────────────

const emptySchema = z.object({}).strict();

router.post(
  '/:projectId/root-cause/get-starter-questionnaire',
  verifyAuth,
  validate(emptySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const questions = getStarterQuestionnaire();
      return res.json({ questions });
    } catch (err) {
      logger.error?.('rootCause.getStarterQuestionnaire.error', err);
      captureRouteError(err, 'rootCause.getStarterQuestionnaire');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
