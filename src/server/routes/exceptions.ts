// Praeventio Guard — Exception engine HTTP surface.
//
// Sprint 39 G.2 — six stateless endpoints over the engine under
// `src/services/exceptions/exceptionEngine.ts`:
//
//   POST /:projectId/exceptions/create            { input }
//   POST /:projectId/exceptions/derive-status     { record, now? }
//   POST /:projectId/exceptions/revoke            { record, revokedReason, now? }
//   POST /:projectId/exceptions/mark-fulfilled    { record, now? }
//   POST /:projectId/exceptions/filter-active-at  { records, now? }
//   POST /:projectId/exceptions/summarize         { records, now? }
//
// Pure compute — no Firestore writes.
// Server-side identity overrides: approvedByUid (create) and
// revokedByUid (revoke) forced to the authenticated caller.

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
  createException,
  deriveStatus,
  revokeException,
  markFulfilled,
  filterActiveAt,
  summarize,
  ExceptionValidationError,
  type ExceptionRecord,
  type ExceptionDomain,
  type ExceptionStatus,
  type CreateExceptionInput,
} from '../../services/exceptions/exceptionEngine.js';

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

const DOMAINS: readonly ExceptionDomain[] = [
  'training_gap',
  'epp_expired',
  'permit_pending',
  'document_expired',
  'medical_fitness_pending',
  'equipment_inspection',
  'staffing_gap',
  'other',
];
const STATUSES: readonly ExceptionStatus[] = ['active', 'expired', 'revoked', 'fulfilled'];
const SUBJECT_KINDS = ['WORKER', 'EPP', 'TASK', 'EQUIPMENT', 'DOCUMENT'] as const;

const recordSchema = z.object({
  id: z.string().min(1).max(200),
  domain: z.enum(DOMAINS as readonly [ExceptionDomain, ...ExceptionDomain[]]),
  subjectRef: z.object({
    kind: z.enum(SUBJECT_KINDS),
    id: z.string().min(1).max(200),
  }),
  reason: z.string().min(1).max(5000),
  alternativeMitigation: z.string().min(1).max(5000),
  approvedByUid: z.string().min(1).max(200),
  approvedByRole: z.string().min(1).max(200),
  approvedAt: z.string().min(10),
  validUntil: z.string().min(10),
  status: z.enum(STATUSES as readonly [ExceptionStatus, ...ExceptionStatus[]]),
  evidenceUrls: z.array(z.string().min(1).max(2000)).max(100).optional(),
  notes: z.string().min(0).max(5000).optional(),
  fulfilledAt: z.string().min(10).optional(),
  revokedAt: z.string().min(10).optional(),
  revokedByUid: z.string().min(1).max(200).optional(),
  revokedReason: z.string().min(1).max(5000).optional(),
}) as unknown as z.ZodType<ExceptionRecord>;

// ────────────────────────────────────────────────────────────────────────
// 1. create — approvedByUid forced to caller
// ────────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  id: z.string().min(1).max(200),
  domain: z.enum(DOMAINS as readonly [ExceptionDomain, ...ExceptionDomain[]]),
  subjectRef: z.object({
    kind: z.enum(SUBJECT_KINDS),
    id: z.string().min(1).max(200),
  }),
  reason: z.string().min(20).max(5000),
  alternativeMitigation: z.string().min(20).max(5000),
  approvedByRole: z.string().min(1).max(200),
  durationHours: z.number().int().min(1).max(168),
  evidenceUrls: z.array(z.string().min(1).max(2000)).max(100).optional(),
  notes: z.string().min(0).max(5000).optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/exceptions/create',
  verifyAuth,
  validate(createSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const input: CreateExceptionInput = {
        ...body,
        approvedByUid: callerUid,
        now: body.now ? new Date(body.now) : undefined,
      };
      const record = createException(input);
      return res.json({ record });
    } catch (err) {
      if (err instanceof ExceptionValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('exceptions.create.error', err);
      captureRouteError(err, 'exceptions.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. derive-status
// ────────────────────────────────────────────────────────────────────────

const deriveSchema = z.object({
  record: recordSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/exceptions/derive-status',
  verifyAuth,
  validate(deriveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof deriveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const status = deriveStatus(body.record, now);
      return res.json({ status });
    } catch (err) {
      logger.error?.('exceptions.deriveStatus.error', err);
      captureRouteError(err, 'exceptions.deriveStatus');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. revoke — revokedByUid forced to caller
// ────────────────────────────────────────────────────────────────────────

const revokeSchema = z.object({
  record: recordSchema,
  revokedReason: z.string().min(1).max(5000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/exceptions/revoke',
  verifyAuth,
  validate(revokeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof revokeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const record = revokeException(body.record, callerUid, body.revokedReason, now);
      return res.json({ record });
    } catch (err) {
      if (err instanceof ExceptionValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('exceptions.revoke.error', err);
      captureRouteError(err, 'exceptions.revoke');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. mark-fulfilled
// ────────────────────────────────────────────────────────────────────────

const fulfilledSchema = z.object({
  record: recordSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/exceptions/mark-fulfilled',
  verifyAuth,
  validate(fulfilledSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof fulfilledSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const record = markFulfilled(body.record, now);
      return res.json({ record });
    } catch (err) {
      if (err instanceof ExceptionValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('exceptions.markFulfilled.error', err);
      captureRouteError(err, 'exceptions.markFulfilled');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. filter-active-at  /  6. summarize
// ────────────────────────────────────────────────────────────────────────

const recordsSchema = z.object({
  records: z.array(recordSchema).max(10_000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/exceptions/filter-active-at',
  verifyAuth,
  validate(recordsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recordsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const active = filterActiveAt(body.records, now);
      return res.json({ active });
    } catch (err) {
      logger.error?.('exceptions.filterActiveAt.error', err);
      captureRouteError(err, 'exceptions.filterActiveAt');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/exceptions/summarize',
  verifyAuth,
  validate(recordsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recordsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const summary = summarize(body.records, now);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('exceptions.summarize.error', err);
      captureRouteError(err, 'exceptions.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
