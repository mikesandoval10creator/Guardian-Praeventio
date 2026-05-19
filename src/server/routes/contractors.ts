// Praeventio Guard — Contractors KPI + Acreditación HTTP surface.
//
// Sprint K §47-48 + §90-91 — four stateless endpoints over the engine
// under `src/services/contractors/contractorKpiService.ts`:
//
//   POST /:projectId/contractors/compute-kpi              { perf }
//   POST /:projectId/contractors/rank-by-risk             { perfs }
//   POST /:projectId/contractors/acreditation-gap-report  { record, nowIso? }
//
// Pure compute — no Firestore writes. TRIR/LTIFR/severity rate
// computed per industry-standard constants (200,000 / 1,000,000).

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
  computeContractorKpi,
  rankContractorsByRisk,
  buildAcreditationGapReport,
  type ContractorPerformance,
  type AcreditationRecord,
  type AcreditationStatus,
} from '../../services/contractors/contractorKpiService.js';

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

const ACREDITATION_STATUSES: readonly AcreditationStatus[] = [
  'pending',
  'in_review',
  'approved',
  'observed',
  'rejected',
];

const perfSchema = z.object({
  contractorId: z.string().min(1).max(200),
  legalName: z.string().min(1).max(500),
  manDaysWorked: z.number().nonnegative().max(10_000_000),
  manHoursWorked: z.number().nonnegative().max(1_000_000_000),
  recordableIncidents: z.number().int().nonnegative().max(1_000_000),
  lostTimeDays: z.number().nonnegative().max(10_000_000),
  overdueActions: z.number().int().nonnegative().max(1_000_000),
  trainingCompletionRate: z.number().min(0).max(1),
  documentationCurrentRate: z.number().min(0).max(1),
}) as unknown as z.ZodType<ContractorPerformance>;

// ────────────────────────────────────────────────────────────────────────
// 1. compute-kpi
// ────────────────────────────────────────────────────────────────────────

const computeSchema = z.object({
  perf: perfSchema,
});

router.post(
  '/:projectId/contractors/compute-kpi',
  verifyAuth,
  validate(computeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof computeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const kpi = computeContractorKpi(body.perf);
      return res.json({ kpi });
    } catch (err) {
      logger.error?.('contractors.computeKpi.error', err);
      captureRouteError(err, 'contractors.computeKpi');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. rank-by-risk
// ────────────────────────────────────────────────────────────────────────

const rankSchema = z.object({
  perfs: z.array(perfSchema).max(10_000),
});

router.post(
  '/:projectId/contractors/rank-by-risk',
  verifyAuth,
  validate(rankSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rankSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankContractorsByRisk(body.perfs);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('contractors.rankByRisk.error', err);
      captureRouteError(err, 'contractors.rankByRisk');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. acreditation-gap-report
// ────────────────────────────────────────────────────────────────────────

const observationSchema = z.object({
  id: z.string().min(1).max(200),
  issue: z.string().min(1).max(2000),
  dueAt: z.string().min(10),
  resolved: z.boolean(),
  resolvedAt: z.string().min(10).optional(),
});

const recordSchema = z.object({
  contractorId: z.string().min(1).max(200),
  status: z.enum(ACREDITATION_STATUSES as readonly [AcreditationStatus, ...AcreditationStatus[]]),
  observations: z.array(observationSchema).max(1000),
  lastReviewedAt: z.string().min(10).optional(),
}) as unknown as z.ZodType<AcreditationRecord>;

const acreditationSchema = z.object({
  record: recordSchema,
  nowIso: z.string().min(10).optional(),
});

router.post(
  '/:projectId/contractors/acreditation-gap-report',
  verifyAuth,
  validate(acreditationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof acreditationSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildAcreditationGapReport(body.record, body.nowIso);
      return res.json({ report });
    } catch (err) {
      logger.error?.('contractors.acreditationGapReport.error', err);
      captureRouteError(err, 'contractors.acreditationGapReport');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
