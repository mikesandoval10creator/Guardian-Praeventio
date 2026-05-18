// Praeventio Guard — Corrective-Action Efficacy Verification HTTP surface.
//
// Sprint 44 F.11: 30 days after closing a corrective action, the engine
// evaluates whether the underlying risk reappeared (same location /
// crew / kind) and emits a verdict + recommendation.
//
// 2 stateless endpoints over the engine under
// `src/services/efficacyVerification/efficacyVerifier.ts`:
//
//   POST /:projectId/efficacy/verify
//     body: VerifyEfficacyInput + { now? }
//     200:  { result: EfficacyVerificationResult }
//
//   POST /:projectId/efficacy/default-window
//     body: { closedAt, recurrences?, leading?, windowDays? }
//     200:  { window: PostActionWindow }
//
// Pure compute — no Firestore writes. Caller decides what to do with
// the resulting verdict (reopen, extend, ratify, etc.).

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
  verifyEfficacy,
  defaultPostActionWindow,
  type VerifyEfficacyInput,
  type PostActionWindow,
} from '../../services/efficacyVerification/efficacyVerifier.js';

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

// The engine input is a deeply nested shape (baseline + window +
// actions). Accept it loosely via the engine's own validation rather
// than duplicating field-level taxonomy at the HTTP boundary.
const verifyEfficacyInputSchema = z.unknown() as unknown as z.ZodType<VerifyEfficacyInput>;
const windowRecurrenceSchema = z.unknown() as unknown as z.ZodType<PostActionWindow['recurrenceIncidents']>;
const windowLeadingSchema = z.unknown() as unknown as z.ZodType<PostActionWindow['leadingIndicators']>;

// ────────────────────────────────────────────────────────────────────────
// 1. verify
// ────────────────────────────────────────────────────────────────────────

const verifySchema = z.object({
  input: verifyEfficacyInputSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/efficacy/verify',
  verifyAuth,
  validate(verifySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof verifySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = verifyEfficacy(body.input, {
        now: body.now ? new Date(body.now) : undefined,
      });
      return res.json({ result });
    } catch (err) {
      logger.error?.('efficacy.verify.error', err);
      captureRouteError(err, 'efficacy.verify');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. default-window
// ────────────────────────────────────────────────────────────────────────

const defaultWindowSchema = z.object({
  closedAt: z.string().min(10),
  recurrences: windowRecurrenceSchema.optional(),
  leading: windowLeadingSchema.optional(),
  windowDays: z.number().int().positive().max(365).optional(),
});

router.post(
  '/:projectId/efficacy/default-window',
  verifyAuth,
  validate(defaultWindowSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof defaultWindowSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const window = defaultPostActionWindow(
        body.closedAt,
        body.recurrences,
        body.leading,
        body.windowDays,
      );
      return res.json({ window });
    } catch (err) {
      logger.error?.('efficacy.defaultWindow.error', err);
      captureRouteError(err, 'efficacy.defaultWindow');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
