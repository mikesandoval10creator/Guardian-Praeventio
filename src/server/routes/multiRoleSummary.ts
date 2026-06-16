// Praeventio Guard — Multi-Role Summary HTTP surface.
//
// 3 stateless endpoints (pure compute over caller-supplied snapshot):
//   POST /:projectId/role-summary/compose
//     body: { snapshot, audience, language? }
//     200:  { summary: RoleSummary }
//   POST /:projectId/role-summary/compose-all
//     body: { snapshot, language? }
//     200:  { summaries: Record<SummaryAudience, RoleSummary> }
//   POST /:projectId/role-summary/filter-lessons
//     body: { lessons, context }
//     200:  { lessons: ApplicableLessons }
//
// No Firestore writes — the engine is pure compute over a snapshot the
// caller assembles. Persistence of the snapshot lives in different
// collections per project (incidents, training, inspections) and is the
// caller's responsibility.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { requireTier } from '../middleware/requireTier.js';
import { tierGateEnforced } from '../middleware/tierRouteTable.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  composeRoleSummary,
  composeAllAudiences,
  filterTransferableLessons,
  type ProjectSnapshot,
  type LessonApplicabilityContext,
} from '../../services/multiRoleSummary/roleSummaryComposer.js';

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

const AUDIENCES = [
  'worker',
  'supervisor',
  'prevencionista',
  'executive',
  'client_mandante',
  'mutuality',
  'cphs',
  'auditor_external',
] as const;

const LANGUAGES = [
  'es-CL',
  'es-AR',
  'es-MX',
  'es-PE',
  'pt-BR',
  'en-US',
  'en-GB',
] as const;

const HIGHLIGHT_KINDS = [
  'achievement',
  'concern',
  'milestone',
  'critical_decision',
] as const;

const LESSON_APPLICABILITY = [
  'similar_industry',
  'similar_size',
  'similar_risk_profile',
  'any',
] as const;

const WORKFORCE_SIZES = ['small', 'medium', 'large'] as const;
const RISK_PROFILES = ['low', 'medium', 'high', 'extreme'] as const;

const snapshotSchema = z.object({
  projectId: z.string().min(1).max(200),
  projectName: z.string().min(1).max(200),
  periodFrom: z.string().min(10),
  periodTo: z.string().min(10),
  metrics: z
    .object({
      incidentsCount: z.number().nonnegative().optional(),
      sifIncidentsCount: z.number().nonnegative().optional(),
      trir: z.number().nonnegative().optional(),
      ltifr: z.number().nonnegative().optional(),
      workersActive: z.number().nonnegative().optional(),
      workersWithCompleteEpp: z.number().nonnegative().optional(),
      inspectionsCompleted: z.number().nonnegative().optional(),
      correctiveActionsClosed: z.number().nonnegative().optional(),
      correctiveActionsOpen: z.number().nonnegative().optional(),
      complianceScore: z.number().min(0).max(100).optional(),
      averageReadinessScore: z.number().min(0).max(100).optional(),
      daysSinceLastSif: z.number().nonnegative().optional(),
    })
    .optional(),
  highlights: z
    .array(
      z.object({
        kind: z.enum(HIGHLIGHT_KINDS),
        text: z.string().min(1).max(2000),
        relevantTo: z.array(z.enum(AUDIENCES)).min(1).max(8),
      }),
    )
    .max(50)
    .optional(),
  transferableLessons: z
    .array(
      z.object({
        summary: z.string().min(1).max(2000),
        applicableTo: z.enum(LESSON_APPLICABILITY),
      }),
    )
    .max(50)
    .optional(),
}) as unknown as z.ZodType<ProjectSnapshot>;

const composeSchema = z.object({
  snapshot: snapshotSchema,
  audience: z.enum(AUDIENCES),
  language: z.enum(LANGUAGES).optional(),
});

router.post(
  '/:projectId/role-summary/compose',
  verifyAuth,
  requireTier('platino', { enforce: tierGateEnforced(), route: 'multiRoleSummary' }),
  validate(composeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof composeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = composeRoleSummary(
        body.snapshot,
        body.audience,
        body.language,
      );
      return res.json({ summary });
    } catch (err) {
      logger.error?.('multiRoleSummary.compose.error', err);
      captureRouteError(err, 'multiRoleSummary.compose');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const composeAllSchema = z.object({
  snapshot: snapshotSchema,
  language: z.enum(LANGUAGES).optional(),
});

router.post(
  '/:projectId/role-summary/compose-all',
  verifyAuth,
  requireTier('platino', { enforce: tierGateEnforced(), route: 'multiRoleSummary' }),
  validate(composeAllSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof composeAllSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summaries = composeAllAudiences(body.snapshot, body.language);
      return res.json({ summaries });
    } catch (err) {
      logger.error?.('multiRoleSummary.composeAll.error', err);
      captureRouteError(err, 'multiRoleSummary.composeAll');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const filterLessonsSchema = z.object({
  lessons: z
    .array(
      z.object({
        summary: z.string().min(1).max(2000),
        applicableTo: z.enum(LESSON_APPLICABILITY),
      }),
    )
    .min(1)
    .max(100),
  context: z.object({
    industry: z.string().max(120).optional(),
    workforceSize: z.enum(WORKFORCE_SIZES).optional(),
    riskProfile: z.enum(RISK_PROFILES).optional(),
    source: z
      .object({
        industry: z.string().max(120).optional(),
        workforceSize: z.enum(WORKFORCE_SIZES).optional(),
        riskProfile: z.enum(RISK_PROFILES).optional(),
      })
      .optional(),
  }) as unknown as z.ZodType<LessonApplicabilityContext>,
});

router.post(
  '/:projectId/role-summary/filter-lessons',
  verifyAuth,
  requireTier('platino', { enforce: tierGateEnforced(), route: 'multiRoleSummary' }),
  validate(filterLessonsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof filterLessonsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const lessons = filterTransferableLessons(body.lessons, body.context);
      return res.json({ lessons });
    } catch (err) {
      logger.error?.('multiRoleSummary.filterLessons.error', err);
      captureRouteError(err, 'multiRoleSummary.filterLessons');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
