// Praeventio Guard — Read receipts (acknowledgement) HTTP surface.
//
// Sprint 39 G.1 — six stateless endpoints over the engine under
// `src/services/readReceipts/readReceiptService.ts`:
//
//   POST /:projectId/read-receipts/resolve-audience    { audience, workers }
//   POST /:projectId/read-receipts/build-initial       { doc, audience }
//   POST /:projectId/read-receipts/compute-deadline    { publishedAt, deadlineDays }
//   POST /:projectId/read-receipts/derive-status       { receipt, now? }
//   POST /:projectId/read-receipts/acknowledge         { receipt, ackedAt? }
//   POST /:projectId/read-receipts/summarize           { doc, receipts, now? }
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
  resolveAudience,
  buildInitialReceipts,
  computeDeadline,
  deriveStatus,
  acknowledgeReceipt,
  summarizeReceipts,
  type DocumentAudience,
  type DocumentForRead,
  type WorkerForRead,
  type ReadReceipt,
} from '../../services/readReceipts/readReceiptService.js';

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

const audienceSchema = z.object({
  workerUids: z.array(z.string().min(1).max(200)).max(10_000).optional(),
  roles: z.array(z.string().min(1).max(200)).max(500).optional(),
  projectIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  trainingCodes: z.array(z.string().min(1).max(200)).max(500).optional(),
  allWorkers: z.boolean().optional(),
}) as unknown as z.ZodType<DocumentAudience>;

const docSchema = z.object({
  id: z.string().min(1).max(200),
  version: z.number().int().nonnegative().max(100_000),
  title: z.string().min(1).max(500),
  audience: audienceSchema,
  publishedAt: z.string().min(10),
  readDeadlineDays: z.number().int().min(1).max(365),
}) as unknown as z.ZodType<DocumentForRead>;

const workerSchema = z.object({
  uid: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  projectIds: z.array(z.string().min(1).max(200)).max(500),
  activeTrainings: z.array(z.string().min(1).max(200)).max(500),
  isActive: z.boolean(),
}) as unknown as z.ZodType<WorkerForRead>;

const receiptSchema = z.object({
  documentId: z.string().min(1).max(200),
  documentVersion: z.number().int().nonnegative().max(100_000),
  workerUid: z.string().min(1).max(200),
  acknowledgedAt: z.string().min(10).nullable(),
  deadlineAt: z.string().min(10),
  status: z.enum(['pending', 'acknowledged', 'overdue']),
}) as unknown as z.ZodType<ReadReceipt>;

// ────────────────────────────────────────────────────────────────────────
// 1. resolve-audience
// ────────────────────────────────────────────────────────────────────────

const resolveSchema = z.object({
  audience: audienceSchema,
  workers: z.array(workerSchema).max(50_000),
});

router.post(
  '/:projectId/read-receipts/resolve-audience',
  verifyAuth,
  validate(resolveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof resolveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const resolved = resolveAudience(body.audience, body.workers);
      return res.json({ resolved });
    } catch (err) {
      logger.error?.('readReceipts.resolveAudience.error', err);
      captureRouteError(err, 'readReceipts.resolveAudience');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-initial
// ────────────────────────────────────────────────────────────────────────

const buildSchema = z.object({
  doc: docSchema,
  audience: z.array(workerSchema).max(50_000),
});

router.post(
  '/:projectId/read-receipts/build-initial',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const receipts = buildInitialReceipts(body.doc, body.audience);
      return res.json({ receipts });
    } catch (err) {
      logger.error?.('readReceipts.buildInitial.error', err);
      captureRouteError(err, 'readReceipts.buildInitial');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. compute-deadline
// ────────────────────────────────────────────────────────────────────────

const deadlineSchema = z.object({
  publishedAt: z.string().min(10),
  deadlineDays: z.number().int().min(1).max(365),
});

router.post(
  '/:projectId/read-receipts/compute-deadline',
  verifyAuth,
  validate(deadlineSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof deadlineSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const deadlineAt = computeDeadline(body.publishedAt, body.deadlineDays);
      return res.json({ deadlineAt });
    } catch (err) {
      logger.error?.('readReceipts.computeDeadline.error', err);
      captureRouteError(err, 'readReceipts.computeDeadline');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. derive-status
// ────────────────────────────────────────────────────────────────────────

const deriveSchema = z.object({
  receipt: receiptSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/read-receipts/derive-status',
  verifyAuth,
  validate(deriveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof deriveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const status = deriveStatus(body.receipt, now);
      return res.json({ status });
    } catch (err) {
      logger.error?.('readReceipts.deriveStatus.error', err);
      captureRouteError(err, 'readReceipts.deriveStatus');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. acknowledge — workerUid in receipt forced to caller-only-self pattern
// ────────────────────────────────────────────────────────────────────────

const ackSchema = z.object({
  receipt: receiptSchema,
  ackedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/read-receipts/acknowledge',
  verifyAuth,
  validate(ackSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof ackSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    // Anti-blame: a worker can only acknowledge for themselves. Supervisors
    // wanting to backfill on behalf of a worker must go through a separate
    // audited flow (out-of-scope here).
    if (body.receipt.workerUid !== callerUid) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Only the worker themselves can acknowledge a read receipt.',
      });
    }
    try {
      const receipt = acknowledgeReceipt(body.receipt, body.ackedAt);
      return res.json({ receipt });
    } catch (err) {
      logger.error?.('readReceipts.acknowledge.error', err);
      captureRouteError(err, 'readReceipts.acknowledge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. summarize
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  doc: docSchema,
  receipts: z.array(receiptSchema).max(100_000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/read-receipts/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const summary = summarizeReceipts(body.doc, body.receipts, now);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('readReceipts.summarize.error', err);
      captureRouteError(err, 'readReceipts.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
