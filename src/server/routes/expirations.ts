// Praeventio Guard — Universal expiration scanner HTTP surface.
//
// Sprint 39 B.9 — two stateless endpoints over the engine under
// `src/services/expirations/expirationScanner.ts`:
//
//   POST /:projectId/expirations/scan
//     body: { items, opts? }
//     200:  { result: ScanResult }
//
//   POST /:projectId/expirations/build-finding-payload
//     body: { outcome }
//     200:  { payload }
//
// Pure compute — no Firestore writes. Caller dispatches notifications +
// node persistence based on the bucketed result.

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
  scanForExpirations,
  buildExpirationFindingPayload,
  type ExpirableItem,
  type ExpirationOutcome,
  type ExpirationKind,
  type ExpirationSeverity,
} from '../../services/expirations/expirationScanner.js';

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

const KINDS: readonly ExpirationKind[] = [
  'epp',
  'document',
  'training',
  'occupational_exam',
  'work_permit',
  'license',
  'medical_fitness',
  'contract',
  'audit_action',
];
const SEVERITIES: readonly ExpirationSeverity[] = ['ok', 'warning', 'critical', 'expired'];

const itemSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(KINDS as readonly [ExpirationKind, ...ExpirationKind[]]),
  expiresAt: z.string().min(10).nullable().optional(),
  ownerId: z.string().min(1).max(200).optional(),
  label: z.string().min(0).max(500).optional(),
  status: z.string().min(0).max(50).optional(),
  projectId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<ExpirableItem>;

const optsSchema = z.object({
  now: z.string().min(10).optional(),
  warningWindowDays: z.number().int().min(1).max(3650).optional(),
  criticalWindowDays: z.number().int().min(0).max(3650).optional(),
});

const outcomeSchema = z.object({
  item: itemSchema,
  daysUntilExpiry: z.number().int().min(-3650).max(36500),
  severity: z.enum(SEVERITIES as readonly [ExpirationSeverity, ...ExpirationSeverity[]]),
}) as unknown as z.ZodType<ExpirationOutcome>;

// ────────────────────────────────────────────────────────────────────────
// 1. scan
// ────────────────────────────────────────────────────────────────────────

const scanSchema = z.object({
  items: z.array(itemSchema).max(100_000),
  opts: optsSchema.optional(),
});

router.post(
  '/:projectId/expirations/scan',
  verifyAuth,
  validate(scanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof scanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = scanForExpirations(body.items, {
        now: body.opts?.now ? new Date(body.opts.now) : undefined,
        warningWindowDays: body.opts?.warningWindowDays,
        criticalWindowDays: body.opts?.criticalWindowDays,
      });
      return res.json({ result });
    } catch (err) {
      if (err instanceof RangeError) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('expirations.scan.error', err);
      captureRouteError(err, 'expirations.scan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-finding-payload
// ────────────────────────────────────────────────────────────────────────

const buildPayloadSchema = z.object({
  outcome: outcomeSchema,
});

router.post(
  '/:projectId/expirations/build-finding-payload',
  verifyAuth,
  validate(buildPayloadSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildPayloadSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const payload = buildExpirationFindingPayload(body.outcome);
      return res.json({ payload });
    } catch (err) {
      logger.error?.('expirations.buildFindingPayload.error', err);
      captureRouteError(err, 'expirations.buildFindingPayload');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
