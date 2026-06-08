// Praeventio Guard — TODO.md §12.2.2 / B16: conflict_queue HTTP surface.
//
// Durable persistence + supervisor-resolution surface for safety-doc sync
// conflicts. The pure engine lives in `src/services/sync/conflictQueue.ts`;
// this router is the ONLY writer (Admin SDK) so identity + timestamps are
// server-stamped and the Firestore rules keep the collection client-read-only.
//
// Storage path: tenants/{tid}/conflict_queue/{queueId}.
//   queueId is the engine's deterministic sha256 (idempotent enqueue). The
//   engine hashes `enqueuedAt` into the id, so to keep a network retry of the
//   SAME conflict collapsing onto the SAME doc we feed a STABLE `now` derived
//   from the conflict's own server-divergence timestamp (`serverUpdatedAt`),
//   NOT a fresh wall-clock per request. See `stableEnqueuedAt()` below.
//
// Endpoints (all under /api/sprint-k):
//   POST /:projectId/conflict-queue/enqueue                   (member)
//   GET  /:projectId/conflict-queue[?status=]                 (member)
//   POST /:projectId/conflict-queue/:queueId/mark-in-review   (approver)
//   POST /:projectId/conflict-queue/:queueId/resolve          (approver)
//   POST /:projectId/conflict-queue/:queueId/reject           (approver)
//
// §12.2.2: para Inspection/IncidentReport/EmergencyAlert/MedicalRecord/
// TrainingCompletion NUNCA last-write-wins — la resolución la APRUEBA un
// superior (admin/gerente). El gate de rol vive aquí (server-side), reflejando
// ConflictResolutionDrawer.APPROVER_ROLES (que es solo UX). Cada cambio de
// estado escribe audit_logs.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  shouldEnqueueForHumanResolution,
  buildConflictQueueEntry,
  resolveConflictQueueEntry,
  markInReview,
  rejectAsInvalid,
  ConflictQueueValidationError,
  type ConflictQueueEntry,
  type ConflictQueueStatus,
} from '../../services/sync/conflictQueue.js';
import type { Conflict } from '../../services/sync/conflictResolver.js';

const router = Router();

// Roles que pueden APROBAR resolución (mirror server-side de
// ConflictResolutionDrawer.APPROVER_ROLES). El gate de UI es solo UX; la
// barrera real vive aquí (CLAUDE.md #11).
const APPROVER_ROLES: ReadonlySet<string> = new Set(['admin', 'gerente']);

/**
 * Stable timestamp for the deterministic queueId.
 *
 * The engine's `deterministicQueueId` hashes `enqueuedAt`. If we passed a
 * fresh `new Date()` per call, a network retry of the SAME conflict would
 * hash to a DIFFERENT id and write a duplicate doc — breaking idempotency.
 * Derive `enqueuedAt` from the conflict's own deterministic identity
 * (`serverUpdatedAt` — the moment the server doc diverged), which is stable
 * across retries of the same conflict. Fall back to a hash-stable epoch if
 * the value is somehow unparseable so the id stays deterministic.
 */
function stableEnqueuedAt(conflict: Conflict): Date {
  const ms = Date.parse(conflict.serverUpdatedAt);
  return Number.isFinite(ms) ? new Date(ms) : new Date(0);
}

async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  const members = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .where('uid', '==', callerUid)
    .limit(1)
    .get();
  if (!members.empty) {
    const tid = members.docs[0]?.data()?.tenantId;
    if (typeof tid === 'string') return tid;
  }
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

function isApprover(role: string | undefined): boolean {
  return typeof role === 'string' && APPROVER_ROLES.has(role);
}

function queueRef(tenantId: string, queueId: string) {
  return admin
    .firestore()
    .collection(`tenants/${tenantId}/conflict_queue`)
    .doc(queueId);
}

function toEntry(snap: admin.firestore.DocumentSnapshot): ConflictQueueEntry {
  return snap.data() as ConflictQueueEntry;
}

// ── Shared zod fragments ──────────────────────────────────────────────

const fieldConflictSchema = z.object({
  field: z.string().min(1).max(200),
  localValue: z.unknown(),
  remoteValue: z.unknown(),
  critical: z.boolean(),
});

const conflictSchema = z.object({
  collection: z.string().min(1).max(200),
  docId: z.string().min(1).max(200),
  docType: z.string().min(1).max(120),
  localUpdatedAt: z.string().min(1).max(64),
  serverUpdatedAt: z.string().min(1).max(64),
  isDeletionConflict: z.boolean(),
  fields: z.array(fieldConflictSchema).min(1).max(200),
}) as unknown as z.ZodType<Conflict>;

// ── POST /:projectId/conflict-queue/enqueue ───────────────────────────

const enqueueSchema = z.object({ conflict: conflictSchema });

router.post(
  '/:projectId/conflict-queue/enqueue',
  verifyAuth,
  validate(enqueueSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof enqueueSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      // Only safety-critical divergences are persisted; non-critical LWW
      // conflicts the client already auto-resolves. Engine decides.
      if (!shouldEnqueueForHumanResolution(body.conflict)) {
        return res.status(200).json({ ok: true, enqueued: false });
      }
      // localAuthorUid is server-stamped from the verified token — the body
      // can NEVER spoof who raised the conflict. `now` is STABLE (derived
      // from the conflict's serverUpdatedAt) so retries are idempotent.
      let entry: ConflictQueueEntry;
      try {
        entry = buildConflictQueueEntry({
          conflict: body.conflict,
          localAuthorUid: callerUid,
          projectId,
          now: stableEnqueuedAt(body.conflict),
        });
      } catch (err) {
        if (err instanceof ConflictQueueValidationError) {
          return res.status(400).json({ error: err.code });
        }
        throw err;
      }
      const ref = queueRef(g.tenantId, entry.queueId);
      const existing = await ref.get();
      if (existing.exists) {
        // Idempotent: deterministic queueId means a network retry of the
        // same conflict returns the stored entry, never a duplicate.
        const data = toEntry(existing);
        return res
          .status(200)
          .json({ ok: true, enqueued: false, entry: { ...data, queueId: entry.queueId } });
      }
      await ref.set({ ...entry, tenantId: g.tenantId });
      try {
        await auditServerEvent(
          req,
          'conflict_queue.enqueued',
          'conflictQueue',
          {
            queueId: entry.queueId,
            docType: entry.conflict.docType,
            docId: entry.conflict.docId,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error('conflict_queue.enqueue.audit_failed', { error: auditErr });
      }
      return res.status(201).json({ ok: true, enqueued: true, entry });
    } catch (err) {
      logger.error('conflict_queue.enqueue.error', { error: err });
      captureRouteError(err, 'conflictQueue.enqueue');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/conflict-queue[?status=] ──────────────────────────

const QUEUE_STATUSES: readonly ConflictQueueStatus[] = [
  'pending',
  'in_review',
  'resolved',
  'rejected',
  'expired',
];

router.get('/:projectId/conflict-queue', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const rawStatus =
      typeof req.query.status === 'string' ? req.query.status : 'all';
    const statusFilter: ConflictQueueStatus | 'all' = (
      ['all', ...QUEUE_STATUSES] as readonly string[]
    ).includes(rawStatus)
      ? (rawStatus as ConflictQueueStatus | 'all')
      : 'all';
    let q: admin.firestore.Query = db
      .collection(`tenants/${g.tenantId}/conflict_queue`)
      .where('projectId', '==', projectId);
    if (statusFilter !== 'all') q = q.where('status', '==', statusFilter);
    const snap = await q.limit(500).get();
    const entries = snap.docs
      .map((d) => d.data() as ConflictQueueEntry)
      .sort((a, b) => (a.enqueuedAt < b.enqueuedAt ? 1 : -1));
    return res.json({ entries });
  } catch (err) {
    logger.error('conflict_queue.list.error', { error: err });
    captureRouteError(err, 'conflictQueue.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── Approver-gated transitions ────────────────────────────────────────

router.post(
  '/:projectId/conflict-queue/:queueId/mark-in-review',
  verifyAuth,
  validate(z.object({})),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, queueId } = req.params;
    if (!isApprover(req.user!.role)) {
      return res.status(403).json({ error: 'approver_role_required' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = queueRef(g.tenantId, queueId);
      const outcome = await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { kind: 'not_found' as const };
        try {
          const next = markInReview(toEntry(snap), callerUid);
          tx.set(ref, { ...next, tenantId: g.tenantId });
          return { kind: 'ok' as const, entry: next };
        } catch (err) {
          if (err instanceof ConflictQueueValidationError) {
            return { kind: 'invalid' as const, code: err.code };
          }
          throw err;
        }
      });
      if (outcome.kind === 'not_found') return res.status(404).json({ error: 'not_found' });
      if (outcome.kind === 'invalid') return res.status(409).json({ error: outcome.code });
      try {
        await auditServerEvent(
          req,
          'conflict_queue.mark_in_review',
          'conflictQueue',
          { queueId },
          { projectId },
        );
      } catch (auditErr) {
        logger.error('conflict_queue.markInReview.audit_failed', { error: auditErr });
      }
      return res.status(200).json({ ok: true, entry: outcome.entry });
    } catch (err) {
      logger.error('conflict_queue.markInReview.error', { error: err });
      captureRouteError(err, 'conflictQueue.markInReview');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const resolveSchema = z.object({
  resolution: z.record(
    z.string().min(1).max(200),
    z.object({
      chosen: z.enum(['local', 'remote', 'manual']),
      value: z.unknown(),
    }),
  ),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/conflict-queue/:queueId/resolve',
  verifyAuth,
  validate(resolveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, queueId } = req.params;
    const body = req.body as z.infer<typeof resolveSchema>;
    if (!isApprover(req.user!.role)) {
      return res.status(403).json({ error: 'approver_role_required' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = queueRef(g.tenantId, queueId);
      const outcome = await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { kind: 'not_found' as const };
        try {
          const next = resolveConflictQueueEntry(
            toEntry(snap),
            callerUid,
            body.resolution,
            body.notes,
          );
          tx.set(ref, { ...next, tenantId: g.tenantId });
          return { kind: 'ok' as const, entry: next };
        } catch (err) {
          if (err instanceof ConflictQueueValidationError) {
            return { kind: 'invalid' as const, code: err.code };
          }
          throw err;
        }
      });
      if (outcome.kind === 'not_found') return res.status(404).json({ error: 'not_found' });
      if (outcome.kind === 'invalid') return res.status(409).json({ error: outcome.code });
      try {
        await auditServerEvent(
          req,
          'conflict_queue.resolved',
          'conflictQueue',
          { queueId, fields: Object.keys(body.resolution) },
          { projectId },
        );
      } catch (auditErr) {
        logger.error('conflict_queue.resolve.audit_failed', { error: auditErr });
      }
      return res.status(200).json({ ok: true, entry: outcome.entry });
    } catch (err) {
      logger.error('conflict_queue.resolve.error', { error: err });
      captureRouteError(err, 'conflictQueue.resolve');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const rejectSchema = z.object({ reason: z.string().min(1).max(2000) });

router.post(
  '/:projectId/conflict-queue/:queueId/reject',
  verifyAuth,
  validate(rejectSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, queueId } = req.params;
    const body = req.body as z.infer<typeof rejectSchema>;
    if (!isApprover(req.user!.role)) {
      return res.status(403).json({ error: 'approver_role_required' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = queueRef(g.tenantId, queueId);
      const outcome = await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { kind: 'not_found' as const };
        try {
          const next = rejectAsInvalid(toEntry(snap), callerUid, body.reason);
          tx.set(ref, { ...next, tenantId: g.tenantId });
          return { kind: 'ok' as const, entry: next };
        } catch (err) {
          if (err instanceof ConflictQueueValidationError) {
            return { kind: 'invalid' as const, code: err.code };
          }
          throw err;
        }
      });
      if (outcome.kind === 'not_found') return res.status(404).json({ error: 'not_found' });
      if (outcome.kind === 'invalid') return res.status(409).json({ error: outcome.code });
      try {
        await auditServerEvent(
          req,
          'conflict_queue.rejected',
          'conflictQueue',
          { queueId },
          { projectId },
        );
      } catch (auditErr) {
        logger.error('conflict_queue.reject.audit_failed', { error: auditErr });
      }
      return res.status(200).json({ ok: true, entry: outcome.entry });
    } catch (err) {
      logger.error('conflict_queue.reject.error', { error: err });
      captureRouteError(err, 'conflictQueue.reject');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
