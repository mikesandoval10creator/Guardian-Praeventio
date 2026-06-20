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
//   GET /:projectId/multi-project/snapshots   (READ-side pipeline, P1)
//     200:  { snapshots: ProjectComparatorSnapshot[] }
//     Aggregates the real per-project KPIs that ProjectsCompare needs
//     (incidents/findings/audits/risks/corrective_actions) for every
//     project the caller is a member of. This is the read-side that was
//     missing — the comparator UI used to receive an empty `snapshots`
//     prop and was therefore unreachable (DEEP-EX-34 H3). See
//     docs/READ-PIPELINES-SPEC.md P1.
//
// The three POST endpoints are pure compute. The GET endpoint reads
// Firestore (no writes → no audit_log). NOTE: `:projectId` here is the
// "lens" project used for auth; the engine compares many projects passed
// in the body / aggregated by the GET.

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
  compareProjects,
  extractBestPractices,
  flagRiskProjects,
  type ComparisonReport,
  type ProjectSnapshot,
} from '../../services/multiProject/projectComparator.js';
import {
  buildProjectSnapshot,
  type DocLike,
} from '../services/projectSnapshotAggregator.js';
import {
  MAX_PROJECTS_TO_COMPARE,
  type ProjectSnapshot as ComparatorSnapshot,
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

// ProjectSnapshot + ComparisonReport are deep engine shapes; accept
// loosely (the engine validates internally; HTTP layer doesn't
// duplicate the IncidentCounts / ExposureInput nesting).
//
// FIX (systemic z.unknown() bug): z.unknown() accepts undefined, so a body
// missing the complex field passes validate(), then the engine dereferences
// it → TypeError → 500. z.record(z.string(), z.unknown()) forces the value
// to be a non-null object (rejects undefined/scalars) while keeping the
// loose structural acceptance. The `as unknown as z.ZodType<T>` casts are
// preserved so TypeScript still sees the correct engine types downstream.
const snapshotSchema = z.record(z.string(), z.unknown()) as unknown as z.ZodType<ProjectSnapshot>;
const reportSchema = z.record(z.string(), z.unknown()) as unknown as z.ZodType<ComparisonReport>;

// ────────────────────────────────────────────────────────────────────────
// 1. compare
// ────────────────────────────────────────────────────────────────────────

const compareSchema = z.object({
  snapshots: z.array(snapshotSchema).max(200),
});

router.post(
  '/:projectId/multi-project/compare',
  verifyAuth,
  requireTier('platino', { enforce: tierGateEnforced(), route: 'multiProject' }),
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
  requireTier('platino', { enforce: tierGateEnforced(), route: 'multiProject' }),
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
  requireTier('platino', { enforce: tierGateEnforced(), route: 'multiProject' }),
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

// ────────────────────────────────────────────────────────────────────────
// 4. snapshots  (READ-side pipeline — P1, closes DEEP-EX-34 H3 / #1049)
// ────────────────────────────────────────────────────────────────────────
//
// Aggregates the REAL per-project KPIs the Project Comparator needs from the
// existing Firestore collections, for every project the caller belongs to.
// Read-only → no audit_log. `:projectId` is the auth "lens" (the caller must
// be a member of it); the response includes ALL projects the caller can see so
// the UI can offer them as comparison candidates.

/** Fetch a project's 5 KPI collections (all keyed by `projectId`). */
async function fetchProjectCollections(
  db: FirebaseFirestore.Firestore,
  projectId: string,
): Promise<{
  incidents: DocLike[];
  findings: DocLike[];
  audits: DocLike[];
  risks: DocLike[];
  correctiveActions: DocLike[];
}> {
  const [incidentsSnap, findingsSnap, auditsSnap, risksSnap, caSnap] =
    await Promise.all([
      db.collection('incidents').where('projectId', '==', projectId).limit(5000).get(),
      db.collection('findings').where('projectId', '==', projectId).limit(5000).get(),
      db.collection('audits').where('projectId', '==', projectId).limit(2000).get(),
      db.collection('risks').where('projectId', '==', projectId).limit(2000).get(),
      db.collection('corrective_actions').where('projectId', '==', projectId).limit(5000).get(),
    ]);
  return {
    incidents: incidentsSnap.docs.map((d) => d.data() as DocLike),
    findings: findingsSnap.docs.map((d) => d.data() as DocLike),
    audits: auditsSnap.docs.map((d) => d.data() as DocLike),
    risks: risksSnap.docs.map((d) => d.data() as DocLike),
    correctiveActions: caSnap.docs.map((d) => d.data() as DocLike),
  };
}

router.get(
  '/:projectId/multi-project/snapshots',
  verifyAuth,
  requireTier('platino', { enforce: tierGateEnforced(), route: 'multiProject' }),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      // Projects the caller is a member of — the comparison candidate set.
      const projectsSnap = await db
        .collection('projects')
        .where('members', 'array-contains', callerUid)
        .limit(MAX_PROJECTS_TO_COMPARE * 8)
        .get();

      const snapshotAt = new Date().toISOString();
      const snapshots: ComparatorSnapshot[] = await Promise.all(
        projectsSnap.docs.map(async (doc) => {
          const data = (doc.data() ?? {}) as DocLike;
          const collections = await fetchProjectCollections(db, doc.id);
          const workersRaw = data.workersCount;
          return buildProjectSnapshot(
            {
              projectId: doc.id,
              projectName:
                typeof data.name === 'string' && data.name.length > 0
                  ? data.name
                  : doc.id,
              workersCount: typeof workersRaw === 'number' ? workersRaw : 0,
            },
            collections,
            snapshotAt,
          );
        }),
      );

      return res.json({ snapshots });
    } catch (err) {
      logger.error?.('multiProject.snapshots.error', err);
      captureRouteError(err, 'multiProject.snapshots');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
