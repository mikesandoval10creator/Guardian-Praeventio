// Praeventio Guard — Risk Ranking HTTP surface.
//
// Sprint 39 I.6 — four stateless rankers over the engine under
// `src/services/riskRanking/riskRankingEngine.ts`:
//
//   POST /:projectId/risk-ranking/risks         → top N risks
//   POST /:projectId/risk-ranking/weak-controls → top N weak controls
//   POST /:projectId/risk-ranking/zones         → top N zones by findings
//   POST /:projectId/risk-ranking/tasks         → top N tasks by risk
//
// Pure compute. Caller pre-aggregates the counters from Zettelkasten /
// firestore views; engine never recommends decisions (directive #2).

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
  rankRisks,
  rankWeakControls,
  rankZonesByFindings,
  rankTasksByRisk,
  type RiskRecord,
  type ControlRecord,
  type ZoneStats,
  type TaskRiskRecord,
} from '../../services/riskRanking/riskRankingEngine.js';

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

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const topNSchema = z.number().int().positive().max(100).optional();

// ────────────────────────────────────────────────────────────────────────
// 1. risks
// ────────────────────────────────────────────────────────────────────────

const riskRecordSchema = z.object({
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  category: z.string().min(1).max(200),
  severity: z.enum(SEVERITIES),
  exposedWorkerCount: z.number().nonnegative().max(1_000_000),
  recentFindingCount: z.number().nonnegative().max(1_000_000),
  linkedIncidentCount: z.number().nonnegative().max(1_000_000),
  overdueActionCount: z.number().nonnegative().max(1_000_000),
}) as unknown as z.ZodType<RiskRecord>;

const ranksRisksSchema = z.object({
  records: z.array(riskRecordSchema).max(50_000),
  topN: topNSchema,
});

router.post(
  '/:projectId/risk-ranking/risks',
  verifyAuth,
  validate(ranksRisksSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof ranksRisksSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankRisks(body.records, body.topN);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('riskRanking.risks.error', err);
      captureRouteError(err, 'riskRanking.risks');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. weak-controls
// ────────────────────────────────────────────────────────────────────────

const controlRecordSchema = z.object({
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  verificationCount: z.number().nonnegative().max(1_000_000),
  failureCount: z.number().nonnegative().max(1_000_000),
  lastVerifiedAt: z.string().min(10).max(64).optional(),
  daysSinceLastVerification: z.number().nonnegative().max(10_000),
}) as unknown as z.ZodType<ControlRecord>;

const weakControlsSchema = z.object({
  records: z.array(controlRecordSchema).max(50_000),
  topN: topNSchema,
});

router.post(
  '/:projectId/risk-ranking/weak-controls',
  verifyAuth,
  validate(weakControlsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof weakControlsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankWeakControls(body.records, body.topN);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('riskRanking.weakControls.error', err);
      captureRouteError(err, 'riskRanking.weakControls');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. zones
// ────────────────────────────────────────────────────────────────────────

const zoneStatsSchema = z.object({
  zoneId: z.string().min(1).max(200),
  findingsCount: z.number().nonnegative().max(1_000_000),
  incidentsCount: z.number().nonnegative().max(1_000_000),
  workersAssigned: z.number().nonnegative().max(1_000_000),
}) as unknown as z.ZodType<ZoneStats>;

const zonesSchema = z.object({
  zones: z.array(zoneStatsSchema).max(50_000),
  topN: topNSchema,
});

router.post(
  '/:projectId/risk-ranking/zones',
  verifyAuth,
  validate(zonesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof zonesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankZonesByFindings(body.zones, body.topN);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('riskRanking.zones.error', err);
      captureRouteError(err, 'riskRanking.zones');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. tasks
// ────────────────────────────────────────────────────────────────────────

const taskRiskSchema = z.object({
  taskId: z.string().min(1).max(200),
  riskCategory: z.string().min(1).max(200),
  workersAssigned: z.number().nonnegative().max(1_000_000),
  incidentHistory: z.number().nonnegative().max(1_000_000),
  missingCriticalControls: z.number().nonnegative().max(1_000_000),
}) as unknown as z.ZodType<TaskRiskRecord>;

const tasksSchema = z.object({
  tasks: z.array(taskRiskSchema).max(50_000),
  topN: topNSchema,
});

router.post(
  '/:projectId/risk-ranking/tasks',
  verifyAuth,
  validate(tasksSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof tasksSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankTasksByRisk(body.tasks, body.topN);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('riskRanking.tasks.error', err);
      captureRouteError(err, 'riskRanking.tasks');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
