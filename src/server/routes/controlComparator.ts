// Praeventio Guard — Control Comparator HTTP surface.
//
// 4 stateless endpoints (pure compute over caller-supplied inputs):
//   POST /:projectId/controls/compare
//     body: { controlA, controlB }
//     200:  { comparison: ControlComparison }
//   POST /:projectId/controls/failures/lookup
//     body: { controlKind, industry?, symptom? }
//     200:  { patterns: FailureLibraryEntry[] }
//   POST /:projectId/controls/failures/suggest
//     body: { failureMode, controlKind }
//     200:  { actions: string[] }
//   GET  /:projectId/controls/failures/summary
//     200:  { summary: FailureLibrarySummary }
//
// No Firestore writes — the engine is pure compute and the failure
// library is a static catalog. Storage of comparison history is a
// separate follow-up if/when a consumer needs it.

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
  compareControls,
  type ControlHistoricalRecord,
} from '../../services/controlComparator/controlComparator.js';
import {
  lookupFailurePatterns,
  suggestCorrectiveActions,
  summarizeFailureLibrary,
} from '../../services/controlComparator/controlFailureLibrary.js';

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

const CONTROL_LEVELS = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'epp',
] as const;

const FAILURE_MODES = [
  'no_available',
  'not_used',
  'inadequate',
  'not_maintained',
  'not_understood',
  'not_supervised',
  'misapplied',
  'circumvented',
] as const;

const monthlyDatapointSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  incidentsBefore: z.number().nonnegative().optional(),
  incidentsAfter: z.number().nonnegative(),
  nearMissCount: z.number().nonnegative(),
  complianceScore: z.number().min(0).max(100),
  operatingCostClp: z.number().nonnegative(),
  maintenanceHours: z.number().nonnegative(),
});

const historicalRecordSchema = z.object({
  controlId: z.string().min(1).max(200),
  controlKind: z.enum(CONTROL_LEVELS),
  deployedAt: z.string().min(10),
  monthlyData: z.array(monthlyDatapointSchema).min(1).max(120),
}) as unknown as z.ZodType<ControlHistoricalRecord>;

const compareSchema = z.object({
  controlA: historicalRecordSchema,
  controlB: historicalRecordSchema,
});

router.post(
  '/:projectId/controls/compare',
  verifyAuth,
  validate(compareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof compareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const comparison = compareControls(body.controlA, body.controlB);
      return res.json({ comparison });
    } catch (err) {
      logger.error?.('controlComparator.compare.error', err);
      captureRouteError(err, 'controlComparator.compare');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const lookupSchema = z.object({
  controlKind: z.enum(CONTROL_LEVELS),
  industry: z.string().min(1).max(120).optional(),
  symptom: z.string().min(1).max(500).optional(),
});

router.post(
  '/:projectId/controls/failures/lookup',
  verifyAuth,
  validate(lookupSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof lookupSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const patterns = lookupFailurePatterns(
        body.controlKind,
        body.industry,
        body.symptom,
      );
      return res.json({ patterns });
    } catch (err) {
      logger.error?.('controlComparator.failuresLookup.error', err);
      captureRouteError(err, 'controlComparator.failuresLookup');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const suggestSchema = z.object({
  failureMode: z.enum(FAILURE_MODES),
  controlKind: z.enum(CONTROL_LEVELS),
});

router.post(
  '/:projectId/controls/failures/suggest',
  verifyAuth,
  validate(suggestSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof suggestSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const actions = suggestCorrectiveActions(
        body.failureMode,
        body.controlKind,
      );
      return res.json({ actions });
    } catch (err) {
      logger.error?.('controlComparator.failuresSuggest.error', err);
      captureRouteError(err, 'controlComparator.failuresSuggest');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/:projectId/controls/failures/summary',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeFailureLibrary();
      return res.json({ summary });
    } catch (err) {
      logger.error?.('controlComparator.failuresSummary.error', err);
      captureRouteError(err, 'controlComparator.failuresSummary');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
