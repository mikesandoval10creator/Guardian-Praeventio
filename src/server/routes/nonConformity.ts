// Praeventio Guard — Non-Conformity engine HTTP surface.
//
// Sprint 49 §196-199 — three stateless endpoints over the engine under
// `src/services/nonConformity/nonConformityEngine.ts`:
//
//   POST /:projectId/non-conformity/link-to-action
//     body: { nc, action, now? }
//     200:  { nc: NonConformity, link: NcActionLink }
//
//   POST /:projectId/non-conformity/evaluate-cycle-stage
//     body: { nc }
//     200:  { status: NonConformityStatus }
//
//   POST /:projectId/non-conformity/bulk-classify-by-pattern
//     body: { ncs, top? }
//     200:  { buckets: PatternBucket[] }
//
// Pure compute — no Firestore writes. Complements `pdca` (PDCA semantics);
// this engine focuses on NC↔action linkage records + stage transitions +
// root-cause-kind pattern bulk classification.

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
  linkNcToAction,
  evaluateNcCycleStage,
  bulkClassifyByPattern,
  type NonConformity,
  type CorrectiveActionRef,
  type NonConformitySource,
  type NonConformitySeverity,
  type NonConformityStatus,
} from '../../services/nonConformity/nonConformityEngine.js';

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

const SOURCES: readonly NonConformitySource[] = [
  'audit',
  'inspection',
  'incident',
  'self_report',
  'external_audit',
  'client_complaint',
];
const SEVERITIES: readonly NonConformitySeverity[] = ['minor', 'major', 'critical'];
const STATUSES: readonly NonConformityStatus[] = [
  'open',
  'investigating',
  'action_planned',
  'closed',
  'efficacy_reviewed',
];

const ncSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.enum(SOURCES as readonly [NonConformitySource, ...NonConformitySource[]]),
  detectedAt: z.string().min(10),
  description: z.string().min(1).max(5000),
  severity: z.enum(SEVERITIES as readonly [NonConformitySeverity, ...NonConformitySeverity[]]),
  status: z.enum(STATUSES as readonly [NonConformityStatus, ...NonConformityStatus[]]),
  rootCauseKind: z.string().min(1).max(200).optional(),
  correctiveActionIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  investigationStartedAt: z.string().min(10).optional(),
  actionPlannedAt: z.string().min(10).optional(),
  closedAt: z.string().min(10).optional(),
  efficacyReviewedAt: z.string().min(10).optional(),
}) as unknown as z.ZodType<NonConformity>;

const actionRefSchema = z.object({
  id: z.string().min(1).max(200),
  ownerUid: z.string().min(1).max(200),
  createdAt: z.string().min(10),
}) as unknown as z.ZodType<CorrectiveActionRef>;

// ────────────────────────────────────────────────────────────────────────
// 1. link-to-action
// ────────────────────────────────────────────────────────────────────────

const linkSchema = z.object({
  nc: ncSchema,
  action: actionRefSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/non-conformity/link-to-action',
  verifyAuth,
  validate(linkSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof linkSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const out = linkNcToAction(body.nc, body.action, body.now);
      return res.json(out);
    } catch (err) {
      logger.error?.('nonConformity.linkToAction.error', err);
      captureRouteError(err, 'nonConformity.linkToAction');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. evaluate-cycle-stage
// ────────────────────────────────────────────────────────────────────────

const evaluateSchema = z.object({
  nc: ncSchema,
});

router.post(
  '/:projectId/non-conformity/evaluate-cycle-stage',
  verifyAuth,
  validate(evaluateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evaluateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const status = evaluateNcCycleStage(body.nc);
      return res.json({ status });
    } catch (err) {
      logger.error?.('nonConformity.evaluateCycleStage.error', err);
      captureRouteError(err, 'nonConformity.evaluateCycleStage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. bulk-classify-by-pattern
// ────────────────────────────────────────────────────────────────────────

const bulkSchema = z.object({
  ncs: z.array(ncSchema).max(50_000),
  top: z.number().int().nonnegative().max(10_000).optional(),
});

router.post(
  '/:projectId/non-conformity/bulk-classify-by-pattern',
  verifyAuth,
  validate(bulkSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof bulkSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const buckets = bulkClassifyByPattern(
        body.ncs,
        body.top !== undefined ? { top: body.top } : undefined,
      );
      return res.json({ buckets });
    } catch (err) {
      logger.error?.('nonConformity.bulkClassifyByPattern.error', err);
      captureRouteError(err, 'nonConformity.bulkClassifyByPattern');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
