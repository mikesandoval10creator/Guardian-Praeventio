// Praeventio Guard — Multi-Project Comparator HTTP surface.
//
// Sprint 41 Fase F.27 — vista multi-proyecto tier Empresa. Compares
// SST metrics across N projects of the tenant to identify best
// practices + projects at risk. Output feeds the executive dashboard.
//
// 3 stateless endpoints over the engine under
// `src/services/multiProject/projectComparator.ts`:
//
//   POST /:projectId/multi-project/compare
//     body: { snapshots: ProjectSnapshot[] }
//     200:  { report: ComparisonReport }
//
//   POST /:projectId/multi-project/best-practices
//     body: { report: ComparisonReport }
//     200:  { practices: BestPractice[] }
//
//   POST /:projectId/multi-project/risk-projects
//     body: { report: ComparisonReport }
//     200:  { alerts: RiskProjectAlert[] }
//
// Pure compute — no Firestore reads/writes. Caller assembles the
// snapshots from their own project metrics. NOTE: `:projectId` here is
// the "lens" project used for auth; the engine compares many projects
// passed in the body.

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
  compareProjects,
  extractBestPractices,
  flagRiskProjects,
  type ComparisonReport,
  type ProjectSnapshot,
} from '../../services/multiProject/projectComparator.js';

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

// ProjectSnapshot + ComparisonReport are deep engine shapes; accept
// loosely (the engine validates internally; HTTP layer doesn't
// duplicate the IncidentCounts / ExposureInput nesting).
const snapshotSchema = z.unknown() as unknown as z.ZodType<ProjectSnapshot>;
const reportSchema = z.unknown() as unknown as z.ZodType<ComparisonReport>;

// ────────────────────────────────────────────────────────────────────────
// 1. compare
// ────────────────────────────────────────────────────────────────────────

const compareSchema = z.object({
  snapshots: z.array(snapshotSchema).max(200),
});

router.post(
  '/:projectId/multi-project/compare',
  verifyAuth,
  validate(compareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof compareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = compareProjects(body.snapshots);
      return res.json({ report });
    } catch (err) {
      logger.error?.('multiProject.compare.error', err);
      captureRouteError(err, 'multiProject.compare');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. best-practices
// ────────────────────────────────────────────────────────────────────────

const bestPracticesSchema = z.object({
  report: reportSchema,
});

router.post(
  '/:projectId/multi-project/best-practices',
  verifyAuth,
  validate(bestPracticesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof bestPracticesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const practices = extractBestPractices(body.report);
      return res.json({ practices });
    } catch (err) {
      logger.error?.('multiProject.bestPractices.error', err);
      captureRouteError(err, 'multiProject.bestPractices');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. risk-projects
// ────────────────────────────────────────────────────────────────────────

const riskProjectsSchema = z.object({
  report: reportSchema,
});

router.post(
  '/:projectId/multi-project/risk-projects',
  verifyAuth,
  validate(riskProjectsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof riskProjectsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const alerts = flagRiskProjects(body.report);
      return res.json({ alerts });
    } catch (err) {
      logger.error?.('multiProject.riskProjects.error', err);
      captureRouteError(err, 'multiProject.riskProjects');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
