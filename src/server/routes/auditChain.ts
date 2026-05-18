// Praeventio Guard — Tamper-Proof Audit Hash Chain HTTP surface.
//
// 4 stateless endpoints over the engine under
// `src/services/audit/tamperProofChain.ts`:
//
//   POST /:projectId/audit-chain/append
//     body: { prev: AuditEvent | null, input: AppendInput }
//     200:  { event: AuditEvent }
//     400:  { error: 'validation_error', code, message }
//
//   POST /:projectId/audit-chain/verify
//     body: { chain: AuditEvent[] }
//     200:  { result: VerifyResult }
//
//   POST /:projectId/audit-chain/anchor
//     body: { chain: AuditEvent[] }
//     200:  { anchor: string | null }
//
//   POST /:projectId/audit-chain/find-gap
//     body: { chain: AuditEvent[] }
//     200:  { gap: { gapAt: number } | null }
//
// Pure compute — no Firestore writes. Caller persists the resulting
// AuditEvent to its append-only audit log (Firestore + GCS write-once
// for tamper resistance per the engine threat model).
//
// Server-side identity override: input.actor on append is forced to the
// authenticated callerUid so clients cannot ghost-sign events as another
// user. Tests / migrations that need a synthetic actor go through the
// engine directly.

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
  appendEvent,
  verifyChain,
  chainAnchor,
  findFirstGap,
  AuditChainError,
  type AuditEvent,
  type AppendInput,
} from '../../services/audit/tamperProofChain.js';

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

const auditEventSchema = z.object({
  seq: z.number().int().nonnegative().max(2_000_000_000),
  timestamp: z.string().min(10),
  prevHash: z.string().min(1).max(200),
  hash: z.string().min(1).max(200),
  actor: z.string().min(1).max(200),
  action: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
}) as unknown as z.ZodType<AuditEvent>;

const appendInputSchema = z.object({
  actor: z.string().min(1).max(200),
  action: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string().min(10).optional(),
}) as unknown as z.ZodType<AppendInput>;

// ────────────────────────────────────────────────────────────────────────
// 1. append
// ────────────────────────────────────────────────────────────────────────

const appendSchema = z.object({
  prev: auditEventSchema.nullable(),
  input: appendInputSchema,
});

router.post(
  '/:projectId/audit-chain/append',
  verifyAuth,
  validate(appendSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof appendSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const enforcedInput: AppendInput = { ...body.input, actor: callerUid };
      const event = await appendEvent(body.prev, enforcedInput);
      return res.json({ event });
    } catch (err) {
      if (err instanceof AuditChainError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
          seq: err.seq,
        });
      }
      logger.error?.('auditChain.append.error', err);
      captureRouteError(err, 'auditChain.append');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. verify
// ────────────────────────────────────────────────────────────────────────

const chainBodySchema = z.object({
  chain: z.array(auditEventSchema).max(100_000),
});

router.post(
  '/:projectId/audit-chain/verify',
  verifyAuth,
  validate(chainBodySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof chainBodySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = await verifyChain(body.chain);
      return res.json({ result });
    } catch (err) {
      logger.error?.('auditChain.verify.error', err);
      captureRouteError(err, 'auditChain.verify');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. anchor
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/audit-chain/anchor',
  verifyAuth,
  validate(chainBodySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof chainBodySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const anchor = chainAnchor(body.chain);
      return res.json({ anchor });
    } catch (err) {
      logger.error?.('auditChain.anchor.error', err);
      captureRouteError(err, 'auditChain.anchor');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. find-gap
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/audit-chain/find-gap',
  verifyAuth,
  validate(chainBodySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof chainBodySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const gap = findFirstGap(body.chain);
      return res.json({ gap });
    } catch (err) {
      logger.error?.('auditChain.findGap.error', err);
      captureRouteError(err, 'auditChain.findGap');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
