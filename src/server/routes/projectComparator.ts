// Praeventio Guard — Project Comparator HTTP surface.
//
// Sprint K (Fase F.27) — single stateless endpoint over the engine under
// `src/services/projectComparator/projectComparator.ts`:
//
//   POST /:projectId/project-comparator/compare
//     body: { snapshots: ProjectSnapshot[] }
//     200:  { report: ComparisonReport }
//     400:  { error: code }  when the engine throws ProjectComparatorError
//
// Pure compute — no Firestore writes. The caller pre-aggregates per-project
// KPIs (Zettelkasten or backend aggregator) and this endpoint normalises
// + ranks them. Comparator never recommends a decision (directive #2).

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
  ProjectComparatorError,
  MAX_PROJECTS_TO_COMPARE,
  MIN_PROJECTS_TO_COMPARE,
  type ProjectSnapshot,
} from '../../services/projectComparator/projectComparator.js';

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

const snapshotSchema = z.object({
  projectId: z.string().min(1).max(200),
  projectName: z.string().min(1).max(500),
  snapshotAt: z.string().min(10).max(64),
  metrics: z.object({
    incidentCount: z.number().nonnegative().max(1_000_000),
    openFindingsCount: z.number().nonnegative().max(1_000_000),
    auditCompliancePct: z.number().min(0).max(100),
    criticalRisksCount: z.number().nonnegative().max(1_000_000),
    workersCount: z.number().nonnegative().max(10_000_000),
    correctiveActionsOnTimePct: z.number().min(0).max(100),
  }),
}) as unknown as z.ZodType<ProjectSnapshot>;

const compareSchema = z.object({
  snapshots: z
    .array(snapshotSchema)
    .min(MIN_PROJECTS_TO_COMPARE)
    .max(MAX_PROJECTS_TO_COMPARE),
});

router.post(
  '/:projectId/project-comparator/compare',
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
      if (err instanceof ProjectComparatorError) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('projectComparator.compare.error', err);
      captureRouteError(err, 'projectComparator.compare');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
