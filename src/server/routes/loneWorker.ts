// Praeventio Guard — Sprint 39 Fase G.11 — Lone Worker HTTP surface.
//
// Mirrors the readReceipts wire pattern: pure-compute endpoints over the
// engine at `src/services/loneWorker/loneWorkerService.ts`. The engine is
// deterministic and stateless — these routes only marshal JSON in/out,
// verify the caller is a project member, and surface idempotency support
// for mutating calls (check-in, end-session).
//
// Endpoints:
//   POST /:projectId/lone-worker/start-session   { checkInIntervalMin, startedAt?, lastKnownLocation? }
//   POST /:projectId/lone-worker/check-in        { session, checkIn }
//   POST /:projectId/lone-worker/end-session     { session, endedAt? }
//   POST /:projectId/lone-worker/derive-status   { session, now? }
//   POST /:projectId/lone-worker/decide-escalation { session, now? }
//   POST /:projectId/lone-worker/admin-overview  { sessions, now? }
//
// Anti-blame note (mirror of read-receipts.acknowledge):
//   • A worker starts/checks-in their OWN session: start-session stamps
//     `workerUid` from the verified TOKEN (never the body) and mints the id
//     server-side; check-in requires `session.workerUid === caller`.
//   • Anyone with project membership can end-session (supervisors close out).
//   • Admin-overview is project-membership gated; no per-worker filtering.
//
// Persistence model: these routes are pure-compute + audit only (the engine is
// stateless). The client persists the returned session to Firestore
// (`projects/{pid}/lone_worker_sessions/{id}`, rules gate create to
// workerUid==auth.uid). start-session is the AUDITED creation point so every
// started lone-worker session is traced (the man-down escalation cron reads
// these docs — a session that began must leave an audit trail).

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { randomId } from '../../utils/randomId.js';
import {
  startLoneWorkerSession,
  recordCheckIn,
  endSession,
  deriveLoneWorkerStatus,
  decideEscalation,
  type LoneWorkerSession,
  type LoneWorkerStatus,
  type EscalationDecision,
} from '../../services/loneWorker/loneWorkerService.js';

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

// ── shared schemas ─────────────────────────────────────────────────────

const statusSchema = z.enum([
  'active',
  'overdue_warning',
  'overdue_critical',
  'help_requested',
  'ended',
]) as unknown as z.ZodType<LoneWorkerStatus>;

const checkInEntrySchema = z.object({
  at: z.string().min(10),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  status: z.enum(['ok', 'help']),
});

const lastKnownLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  at: z.string().min(10),
});

const sessionSchema = z.object({
  id: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  startedAt: z.string().min(10),
  checkInIntervalMin: z.number().int().min(1).max(720),
  lastKnownLocation: lastKnownLocationSchema.optional(),
  checkIns: z.array(checkInEntrySchema).max(10_000),
  endedAt: z.string().min(10).optional(),
  status: statusSchema,
}) as unknown as z.ZodType<LoneWorkerSession>;

// ────────────────────────────────────────────────────────────────────────
// 0. start-session — worker begins a monitored solo-work session (AUDITED)
// ────────────────────────────────────────────────────────────────────────
//
// The previous flow built the session entirely client-side and wrote it
// straight to Firestore with NO audit_logs entry — the only lone-worker
// lifecycle action that wasn't audited. workerUid + id are now server-stamped
// (identity from the token, id from randomId — no client RNG). The session is
// still persisted client-side; this route is the audited creation record.
const startSessionSchema = z.object({
  checkInIntervalMin: z.number().int().min(1).max(720),
  startedAt: z.string().min(10).optional(),
  lastKnownLocation: lastKnownLocationSchema.optional(),
});

router.post(
  '/:projectId/lone-worker/start-session',
  verifyAuth,
  idempotencyKey(),
  validate(startSessionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof startSessionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      // workerUid + id are server-stamped: a worker starts their OWN session,
      // and the id is server-minted (no client Math.random). The engine
      // normalizes to a fresh active session (no carried-over check-ins).
      const session = startLoneWorkerSession({
        id: randomId(),
        workerUid: callerUid,
        startedAt: body.startedAt,
        checkInIntervalMin: body.checkInIntervalMin,
        ...(body.lastKnownLocation ? { lastKnownLocation: body.lastKnownLocation } : {}),
      });
      // CLAUDE.md #3: the START of a lone-worker session is a safety-critical
      // state change — audit it with the server-stamped actor.
      // CLAUDE.md #14: the session already started; an audit-log failure must
      // NOT 500 the worker's request. Capture for observability and continue.
      try {
        await auditServerEvent(req, 'loneWorker.startSession', 'loneWorker', {
          sessionId: session.id,
          workerUid: session.workerUid,
          checkInIntervalMin: session.checkInIntervalMin,
          projectId,
        }, { projectId });
      } catch (auditErr) {
        logger.error?.('audit_event_failed', auditErr);
        captureRouteError(auditErr, 'loneWorker.startSession.audit', { callerUid, projectId });
      }
      return res.json({ session });
    } catch (err) {
      logger.error?.('loneWorker.startSession.error', err);
      captureRouteError(err, 'loneWorker.startSession', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 1. check-in  — worker pulses heartbeat (or "help")
// ────────────────────────────────────────────────────────────────────────

const checkInSchema = z.object({
  session: sessionSchema,
  checkIn: z.object({
    at: z.string().min(10).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    status: z.enum(['ok', 'help']).optional(),
  }),
});

router.post(
  '/:projectId/lone-worker/check-in',
  verifyAuth,
  idempotencyKey(),
  validate(checkInSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof checkInSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    // Anti-blame: a worker can only check-in for themselves. Supervisors
    // wanting to mark a check-in for another worker must go through a
    // separate audited flow (out-of-scope here).
    if (body.session.workerUid !== callerUid) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Only the worker themselves can record their own check-in.',
      });
    }
    try {
      const session = recordCheckIn(body.session, body.checkIn);
      // CLAUDE.md #3: a safety-critical lone-worker check-in (esp. status:'help')
      // must be audited even though the session itself isn't server-persisted.
      // CLAUDE.md #14 (LIFE-SAFETY): a check-in — especially status:'help' — must
      // reach the worker as success once recordCheckIn succeeds. An audit-log
      // outage must NOT 500 a distress signal (the worker would think help was
      // not received). Capture the audit failure out-of-band and still respond OK.
      try {
        await auditServerEvent(req, 'loneWorker.checkIn', 'loneWorker', {
          sessionId: session.id,
          workerUid: session.workerUid,
          help: body.checkIn.status === 'help',
          projectId,
        }, { projectId });
      } catch (auditErr) {
        logger.error?.('audit_event_failed', auditErr);
        captureRouteError(auditErr, 'loneWorker.checkIn.audit', { callerUid, projectId });
      }
      return res.json({ session });
    } catch (err) {
      logger.error?.('loneWorker.checkIn.error', err);
      captureRouteError(err, 'loneWorker.checkIn', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. end-session — supervisor / worker closes the active session
// ────────────────────────────────────────────────────────────────────────

const endSessionSchema = z.object({
  session: sessionSchema,
  endedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/lone-worker/end-session',
  verifyAuth,
  idempotencyKey(),
  validate(endSessionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof endSessionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const session = endSession(body.session, body.endedAt);
      // CLAUDE.md #14: session already ended; audit failure must not 500 it.
      try {
        await auditServerEvent(req, 'loneWorker.endSession', 'loneWorker', {
          sessionId: session.id,
          workerUid: session.workerUid,
          projectId,
        }, { projectId });
      } catch (auditErr) {
        logger.error?.('audit_event_failed', auditErr);
        captureRouteError(auditErr, 'loneWorker.endSession.audit', { callerUid, projectId });
      }
      return res.json({ session });
    } catch (err) {
      logger.error?.('loneWorker.endSession.error', err);
      captureRouteError(err, 'loneWorker.endSession', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. derive-status — pure read of derived state
// ────────────────────────────────────────────────────────────────────────

const deriveSchema = z.object({
  session: sessionSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/lone-worker/derive-status',
  verifyAuth,
  validate(deriveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof deriveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const status = deriveLoneWorkerStatus(body.session, now);
      return res.json({ status });
    } catch (err) {
      logger.error?.('loneWorker.deriveStatus.error', err);
      captureRouteError(err, 'loneWorker.deriveStatus', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. decide-escalation — pure read of escalation decision (nullable)
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/lone-worker/decide-escalation',
  verifyAuth,
  validate(deriveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof deriveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const escalation: EscalationDecision | null = decideEscalation(body.session, now);
      return res.json({ escalation });
    } catch (err) {
      logger.error?.('loneWorker.decideEscalation.error', err);
      captureRouteError(err, 'loneWorker.decideEscalation', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. admin-overview — derive status+escalation across many sessions in one
//    call (mobile admin dashboard convenience).
// ────────────────────────────────────────────────────────────────────────

const overviewSchema = z.object({
  sessions: z.array(sessionSchema).max(2_000),
  now: z.string().min(10).optional(),
});

interface OverviewEntry {
  session: LoneWorkerSession;
  status: LoneWorkerStatus;
  escalation: EscalationDecision | null;
}

router.post(
  '/:projectId/lone-worker/admin-overview',
  verifyAuth,
  validate(overviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof overviewSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const overview: OverviewEntry[] = body.sessions.map((session) => ({
        session,
        status: deriveLoneWorkerStatus(session, now),
        escalation: decideEscalation(session, now),
      }));
      return res.json({ overview });
    } catch (err) {
      logger.error?.('loneWorker.adminOverview.error', err);
      captureRouteError(err, 'loneWorker.adminOverview', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
