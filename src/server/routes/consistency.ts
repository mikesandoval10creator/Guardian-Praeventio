// Praeventio Guard — Cross-module consistency auditor HTTP surface.
//
// Sprint 39 Fase G.3 — two stateless endpoints over the engine under
// `src/services/consistency/consistencyAuditor.ts`:
//
//   POST /:projectId/consistency/run-audit
//     body: { state: ConsistencyState }
//     200:  { issues: Inconsistency[] }
//
//   POST /:projectId/consistency/summarize-audit
//     body: { issues: Inconsistency[] }
//     200:  { summary: ConsistencyAuditSummary }
//
// Pure compute — no Firestore writes. 12+ deterministic cross-module
// consistency rules.

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
  runConsistencyAudit,
  summarizeConsistencyAudit,
  type ConsistencyState,
  type Inconsistency,
  type InconsistencySeverity,
} from '../../services/consistency/consistencyAuditor.js';

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

const SEVERITIES: readonly InconsistencySeverity[] = ['info', 'warning', 'critical'];

const stateSchema = z.object({
  workers: z.array(z.object({
    uid: z.string().min(1).max(200),
    role: z.string().min(1).max(200),
    activeTrainings: z.array(z.string().min(1).max(200)).max(500),
    activeEppLabels: z.array(z.string().min(1).max(200)).max(500),
    isActive: z.boolean(),
  })).max(50_000),
  taskAssignments: z.array(z.object({
    taskId: z.string().min(1).max(200),
    workerUid: z.string().min(1).max(200),
    riskType: z.string().min(1).max(200),
    requiredTrainings: z.array(z.string().min(1).max(200)).max(50),
    requiredEpp: z.array(z.string().min(1).max(200)).max(50),
  })).max(50_000),
  documents: z.array(z.object({
    id: z.string().min(1).max(200),
    status: z.enum(['draft', 'approved', 'signed', 'expired']),
    signedBy: z.string().min(1).max(200).nullable().optional(),
    approvedAt: z.string().min(10).nullable().optional(),
  })).max(50_000),
  correctiveActions: z.array(z.object({
    id: z.string().min(1).max(200),
    status: z.enum(['open', 'closed', 'verified']),
    closedAt: z.string().min(10).nullable().optional(),
    evidenceRequired: z.boolean(),
    evidenceUrls: z.array(z.string().min(1).max(2000)).max(100).optional(),
  })).max(50_000),
  workPermits: z.array(z.object({
    id: z.string().min(1).max(200),
    approverUid: z.string().min(1).max(200),
    expiresAt: z.string().min(10).optional(),
    status: z.enum(['active', 'expired']),
  })).max(50_000),
  trainings: z.array(z.object({
    id: z.string().min(1).max(200),
    workerUid: z.string().min(1).max(200),
    course: z.string().min(1).max(500),
    completedAt: z.string().min(10).nullable().optional(),
    attendanceRegistered: z.boolean(),
  })).max(50_000),
  validRoles: z.array(z.string().min(1).max(200)).max(500),
  eppByRole: z.record(z.string(), z.array(z.string().min(1).max(200)).max(50)).optional(),
  activeApproverUids: z.array(z.string().min(1).max(200)).max(10_000),
}) as unknown as z.ZodType<ConsistencyState>;

const issueSchema = z.object({
  ruleId: z.string().min(1).max(200),
  severity: z.enum(SEVERITIES as readonly [InconsistencySeverity, ...InconsistencySeverity[]]),
  category: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  involvedIds: z.array(z.string().min(1).max(500)).max(500),
  suggestedAction: z.string().min(1).max(5000),
}) as unknown as z.ZodType<Inconsistency>;

// ────────────────────────────────────────────────────────────────────────
// 1. run-audit
// ────────────────────────────────────────────────────────────────────────

const runSchema = z.object({
  state: stateSchema,
});

router.post(
  '/:projectId/consistency/run-audit',
  verifyAuth,
  validate(runSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof runSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const issues = runConsistencyAudit(body.state);
      return res.json({ issues });
    } catch (err) {
      logger.error?.('consistency.runAudit.error', err);
      captureRouteError(err, 'consistency.runAudit');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. summarize-audit
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  issues: z.array(issueSchema).max(50_000),
});

router.post(
  '/:projectId/consistency/summarize-audit',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeConsistencyAudit(body.issues);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('consistency.summarizeAudit.error', err);
      captureRouteError(err, 'consistency.summarizeAudit');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
