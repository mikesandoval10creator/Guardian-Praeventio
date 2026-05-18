// Praeventio Guard — 5S Audit + Zone Ranking HTTP surface.
//
// Sprint K §227 — three stateless endpoints over the engine under
// `src/services/fiveS/fiveSAudit.ts`:
//
//   POST /:projectId/five-s/checklist
//     body: {}
//     200:  { items: FiveSAuditChecklistItem[] }
//
//   POST /:projectId/five-s/build-report
//     body: { zoneId, responses }
//     200:  { report: FiveSAuditReport }
//
//   POST /:projectId/five-s/rank-zones
//     body: { reports }
//     200:  { ranking: ZoneScoreEntry[] }
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
  getFiveSChecklist,
  buildFiveSAuditReport,
  rankZonesBy5S,
  type FiveSAuditResponse,
  type FiveSAuditReport,
} from '../../services/fiveS/fiveSAudit.js';

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

const FIVE_S_DIMENSIONS = ['seiri', 'seiton', 'seiso', 'seiketsu', 'shitsuke'] as const;
const LEVELS = ['critical', 'low', 'fair', 'good', 'excellent'] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. checklist
// ────────────────────────────────────────────────────────────────────────

const emptySchema = z.object({}).strict();

router.post(
  '/:projectId/five-s/checklist',
  verifyAuth,
  validate(emptySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const items = getFiveSChecklist();
      return res.json({ items });
    } catch (err) {
      logger.error?.('fiveS.checklist.error', err);
      captureRouteError(err, 'fiveS.checklist');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-report
// ────────────────────────────────────────────────────────────────────────

const responseSchema = z.object({
  itemId: z.string().min(1).max(200),
  rating: z.union([z.literal(0), z.literal(1), z.literal(2)]),
}) as unknown as z.ZodType<FiveSAuditResponse>;

const buildSchema = z.object({
  zoneId: z.string().min(1).max(200),
  responses: z.array(responseSchema).max(500),
});

router.post(
  '/:projectId/five-s/build-report',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildFiveSAuditReport(body.zoneId, body.responses);
      return res.json({ report });
    } catch (err) {
      logger.error?.('fiveS.buildReport.error', err);
      captureRouteError(err, 'fiveS.buildReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. rank-zones
// ────────────────────────────────────────────────────────────────────────

const fiveSReportSchema = z.object({
  zoneId: z.string().min(1).max(200),
  overallScore: z.number().min(0).max(100),
  byDimension: z.record(z.enum(FIVE_S_DIMENSIONS), z.number().min(0).max(100)),
  level: z.enum(LEVELS),
  worstDimension: z.enum(FIVE_S_DIMENSIONS),
  items: z.array(z.unknown()).max(500),
}) as unknown as z.ZodType<FiveSAuditReport>;

const rankSchema = z.object({
  reports: z.array(fiveSReportSchema).max(10_000),
});

router.post(
  '/:projectId/five-s/rank-zones',
  verifyAuth,
  validate(rankSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rankSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankZonesBy5S(body.reports);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('fiveS.rankZones.error', err);
      captureRouteError(err, 'fiveS.rankZones');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
