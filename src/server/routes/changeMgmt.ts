// Praeventio Guard — Operational Change (MOC) HTTP surface.
//
// Sprint 39 F.J6 — four stateless endpoints over the engine under
// `src/services/changeMgmt/operationalChangeService.ts`:
//
//   POST /:projectId/change-mgmt/declare              { kind, whatChanged, previousValue, newValue, rationale, impact, affectedWorkerUids, declaredByRole, effectiveFrom, referenceDocumentId? }
//   POST /:projectId/change-mgmt/acknowledge          { change, workerUid?, ackedAt? }
//   POST /:projectId/change-mgmt/revert                { change, reason, now? }
//   POST /:projectId/change-mgmt/summarize-acks       { change }
//
// Pure compute — no Firestore writes. (Persistence flows through the
// existing `OperationalChangeAdapter` class which is a separate concern.)
//
// Server-side identity overrides:
//   - declareChange: declaredByUid forced to caller; projectId from URL.
//   - acknowledgeChange: workerUid defaults to caller if omitted.

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
  declareChange,
  acknowledgeChange,
  revertChange,
  summarizeAcknowledgments,
  ChangeValidationError,
  type OperationalChange,
  type ChangeKind,
  type ChangeImpact,
} from '../../services/changeMgmt/operationalChangeService.js';

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

const KINDS: readonly ChangeKind[] = [
  'supervisor',
  'procedure',
  'equipment',
  'shift',
  'work_zone',
  'mandatory_epp',
  'applicable_norm',
  'critical_control',
  'other',
];
const IMPACTS: readonly ChangeImpact[] = ['low', 'medium', 'high'];

const changeSchema = z.object({
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  kind: z.enum(KINDS as readonly [ChangeKind, ...ChangeKind[]]),
  whatChanged: z.string().min(1).max(2000),
  previousValue: z.string().min(0).max(2000),
  newValue: z.string().min(0).max(2000),
  rationale: z.string().min(1).max(5000),
  impact: z.enum(IMPACTS as readonly [ChangeImpact, ...ChangeImpact[]]),
  affectedWorkerUids: z.array(z.string().min(1).max(200)).max(10_000),
  declaredByUid: z.string().min(1).max(200),
  declaredByRole: z.string().min(1).max(200),
  effectiveFrom: z.string().min(10),
  declaredAt: z.string().min(10),
  referenceDocumentId: z.string().min(1).max(200).optional(),
  acknowledgments: z.array(z.object({
    workerUid: z.string().min(1).max(200),
    ackedAt: z.string().min(10),
  })).max(10_000),
  revertedAt: z.string().min(10).optional(),
  revertedReason: z.string().min(1).max(5000).optional(),
}) as unknown as z.ZodType<OperationalChange>;

// ────────────────────────────────────────────────────────────────────────
// 1. declare
// ────────────────────────────────────────────────────────────────────────

const declareSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  kind: z.enum(KINDS as readonly [ChangeKind, ...ChangeKind[]]),
  whatChanged: z.string().min(1).max(2000),
  previousValue: z.string().min(0).max(2000),
  newValue: z.string().min(0).max(2000),
  rationale: z.string().min(20).max(5000),
  impact: z.enum(IMPACTS as readonly [ChangeImpact, ...ChangeImpact[]]),
  affectedWorkerUids: z.array(z.string().min(1).max(200)).max(10_000),
  declaredByRole: z.string().min(1).max(200),
  effectiveFrom: z.string().min(10),
  referenceDocumentId: z.string().min(1).max(200).optional(),
});

router.post(
  '/:projectId/change-mgmt/declare',
  verifyAuth,
  validate(declareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof declareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const change = declareChange({
        ...body,
        projectId,
        declaredByUid: callerUid,
      });
      return res.json({ change });
    } catch (err) {
      if (err instanceof ChangeValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('changeMgmt.declare.error', err);
      captureRouteError(err, 'changeMgmt.declare');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. acknowledge
// ────────────────────────────────────────────────────────────────────────

const ackSchema = z.object({
  change: changeSchema,
  workerUid: z.string().min(1).max(200).optional(),
  ackedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/change-mgmt/acknowledge',
  verifyAuth,
  validate(ackSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof ackSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const workerUid = body.workerUid ?? callerUid;
      const change = acknowledgeChange(body.change, workerUid, body.ackedAt);
      return res.json({ change });
    } catch (err) {
      if (err instanceof ChangeValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('changeMgmt.acknowledge.error', err);
      captureRouteError(err, 'changeMgmt.acknowledge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. revert
// ────────────────────────────────────────────────────────────────────────

const revertSchema = z.object({
  change: changeSchema,
  reason: z.string().min(15).max(5000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/change-mgmt/revert',
  verifyAuth,
  validate(revertSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof revertSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const change = revertChange(body.change, body.reason, now);
      return res.json({ change });
    } catch (err) {
      if (err instanceof ChangeValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('changeMgmt.revert.error', err);
      captureRouteError(err, 'changeMgmt.revert');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. summarize-acks
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  change: changeSchema,
});

router.post(
  '/:projectId/change-mgmt/summarize-acks',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeAcknowledgments(body.change);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('changeMgmt.summarizeAcks.error', err);
      captureRouteError(err, 'changeMgmt.summarizeAcks');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
