// Praeventio Guard — Event Replay Audit Tool HTTP surface.
//
// Sprint 53 §147-152 — three stateless endpoints over the engine under
// `src/services/eventReplay/eventReplayAuditTool.ts`:
//
//   POST /:projectId/event-replay/execute
//     body: { events, query, initialState? }
//     200:  { result: ReplayResult<unknown> }
//     400:  { error: 'validation_error', code, message }
//
//   POST /:projectId/event-replay/diff-states
//     body: { before, after, meta }
//     200:  { diff: StateDiff<unknown> }
//
//   POST /:projectId/event-replay/export-trail
//     body: { replays, format }
//     200:  { trail: string }
//     400:  { error: 'validation_error', code, message }
//
// Pure compute — no Firestore writes. Caller supplies events (typically
// pulled from `domainEventStore` Sprint 45). Reducer is left as identity
// at this surface — the audit metadata (eventTypeBreakdown, eventsApplied,
// auditEntry) is what the caller persists to its append-only audit log.

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
  executeAuditReplay,
  diffStates,
  exportComplianceTrail,
  ReplayAuditError,
  type DomainEventLike,
  type EventStoreLike,
  type ReplayQuery,
  type ReplayResult,
} from '../../services/eventReplay/eventReplayAuditTool.js';

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

const REPLAY_REASONS = [
  'legal_request',
  'compliance_audit',
  'incident_investigation',
  'internal_review',
  'data_subject_access',
] as const;

const FORMATS = ['markdown', 'csv'] as const;

const domainEventSchema = z.object({
  id: z.string().min(1).max(200),
  occurredAt: z.string().min(10),
  type: z.string().min(1).max(200),
  entityRef: z.string().min(1).max(500),
  tenantId: z.string().min(1).max(200),
  actorUid: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
  schemaVersion: z.number().int().nonnegative(),
  correlationId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<DomainEventLike>;

const replayQuerySchema = z.object({
  tenantId: z.string().min(1).max(200),
  entityRef: z.string().min(1).max(500).optional(),
  eventTypeIn: z.array(z.string().min(1).max(200)).max(200).optional(),
  pointInTime: z.string().min(10),
  auditorUid: z.string().min(1).max(200),
  reason: z.enum(REPLAY_REASONS),
}) as unknown as z.ZodType<ReplayQuery>;

const replayResultSchema = z.unknown() as unknown as z.ZodType<ReplayResult<unknown>>;

// ────────────────────────────────────────────────────────────────────────
// 1. execute (identity reducer — produces audit metadata only)
// ────────────────────────────────────────────────────────────────────────

const executeSchema = z.object({
  events: z.array(domainEventSchema).max(50_000),
  query: replayQuerySchema,
  // initialState is forwarded but not used (identity reducer).
  initialState: z.unknown().optional(),
  nowOverride: z.string().min(10).optional(),
});

router.post(
  '/:projectId/event-replay/execute',
  verifyAuth,
  validate(executeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof executeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      // Force auditorUid from authenticated caller — clients cannot ghost-write audit log entries.
      const query: ReplayQuery = { ...body.query, auditorUid: callerUid };
      const store: EventStoreLike = {
        listByEntity: (tenantId, entityRef) =>
          body.events
            .filter((e) => e.tenantId === tenantId && e.entityRef === entityRef)
            .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
      };
      // Identity reducer — surface returns metadata, not reconstructed state.
      const initialState = body.initialState ?? {};
      const result = executeAuditReplay(
        store,
        query,
        initialState,
        (state) => state,
        body.nowOverride,
      );
      return res.json({ result });
    } catch (err) {
      if (err instanceof ReplayAuditError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('eventReplay.execute.error', err);
      captureRouteError(err, 'eventReplay.execute');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. diff-states
// ────────────────────────────────────────────────────────────────────────

const diffSchema = z.object({
  before: z.unknown(),
  after: z.unknown(),
  meta: z.object({
    beforeAt: z.string().min(10),
    afterAt: z.string().min(10),
  }),
});

router.post(
  '/:projectId/event-replay/diff-states',
  verifyAuth,
  validate(diffSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof diffSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const diff = diffStates(body.before, body.after, body.meta);
      return res.json({ diff });
    } catch (err) {
      logger.error?.('eventReplay.diffStates.error', err);
      captureRouteError(err, 'eventReplay.diffStates');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. export-trail
// ────────────────────────────────────────────────────────────────────────

const exportSchema = z.object({
  replays: z.array(replayResultSchema).min(1).max(1000),
  format: z.enum(FORMATS),
});

router.post(
  '/:projectId/event-replay/export-trail',
  verifyAuth,
  validate(exportSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof exportSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const trail = exportComplianceTrail({
        replays: body.replays as ReplayResult<unknown>[],
        format: body.format,
      });
      return res.json({ trail });
    } catch (err) {
      if (err instanceof ReplayAuditError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('eventReplay.exportTrail.error', err);
      captureRouteError(err, 'eventReplay.exportTrail');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
