// Praeventio Guard — Sync Status (offline queue tracker) HTTP surface.
//
// Sprint 39 H.3 — five stateless ops over the engine under
// `src/services/syncStatus/syncQueueTracker.ts`. La cola la mantiene el
// cliente (IndexedDB / SQLite). Estos endpoints son helpers puros para
// que el front pueda delegar transiciones determinísticas cuando opera
// online (idempotencia content-addressed via sha256).
//
//   POST /:projectId/sync-status/create-item
//   POST /:projectId/sync-status/transition       (mark-syncing|synced|error)
//   POST /:projectId/sync-status/summarize        (items[]) → QueueSummary
//   POST /:projectId/sync-status/find-ready       (items[]) → ready for retry
//   POST /:projectId/sync-status/derive-badge     (summary) → SyncBadge

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
  createItem,
  markSyncing,
  markSynced,
  markSyncError,
  summarizeQueue,
  findItemsReadyForRetry,
  deriveBadge,
  type SyncItem,
  type SyncStatus,
  type QueueSummary,
} from '../../services/syncStatus/syncQueueTracker.js';

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

const SYNC_STATUSES = [
  'saved_local',
  'syncing',
  'synced',
  'sync_error',
  'sync_failed',
] as const satisfies readonly SyncStatus[];

const OPS = ['create', 'update', 'delete'] as const;

const syncItemSchema = z.object({
  id: z.string().min(1).max(200),
  collection: z.string().min(1).max(200),
  op: z.enum(OPS),
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(SYNC_STATUSES),
  createdAt: z.string().min(10).max(64),
  lastAttemptAt: z.string().min(10).max(64).optional(),
  syncedAt: z.string().min(10).max(64).optional(),
  attempts: z.number().int().nonnegative().max(1000),
  nextRetryAt: z.string().min(10).max(64).optional(),
  lastError: z.string().max(2000).optional(),
}) as unknown as z.ZodType<SyncItem>;

// ────────────────────────────────────────────────────────────────────────
// 1. create-item
// ────────────────────────────────────────────────────────────────────────

const createItemSchema = z.object({
  collection: z.string().min(1).max(200),
  op: z.enum(OPS),
  payload: z.record(z.string(), z.unknown()),
});

router.post(
  '/:projectId/sync-status/create-item',
  verifyAuth,
  validate(createItemSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createItemSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const item = createItem(body);
      return res.json({ item });
    } catch (err) {
      logger.error?.('syncStatus.createItem.error', err);
      captureRouteError(err, 'syncStatus.createItem');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. transition
// ────────────────────────────────────────────────────────────────────────

const transitionSchema = z.discriminatedUnion('transition', [
  z.object({ transition: z.literal('syncing'), item: syncItemSchema }),
  z.object({ transition: z.literal('synced'), item: syncItemSchema }),
  z.object({
    transition: z.literal('error'),
    item: syncItemSchema,
    errorMessage: z.string().min(1).max(2000),
  }),
]);

router.post(
  '/:projectId/sync-status/transition',
  verifyAuth,
  validate(transitionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof transitionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      let item: SyncItem;
      if (body.transition === 'syncing') item = markSyncing(body.item);
      else if (body.transition === 'synced') item = markSynced(body.item);
      else item = markSyncError(body.item, body.errorMessage);
      return res.json({ item });
    } catch (err) {
      logger.error?.('syncStatus.transition.error', err);
      captureRouteError(err, 'syncStatus.transition');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. summarize
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  items: z.array(syncItemSchema).max(100_000),
});

router.post(
  '/:projectId/sync-status/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeQueue(body.items);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('syncStatus.summarize.error', err);
      captureRouteError(err, 'syncStatus.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. find-ready
// ────────────────────────────────────────────────────────────────────────

const findReadySchema = z.object({
  items: z.array(syncItemSchema).max(100_000),
});

router.post(
  '/:projectId/sync-status/find-ready',
  verifyAuth,
  validate(findReadySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof findReadySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ready = findItemsReadyForRetry(body.items);
      return res.json({ ready });
    } catch (err) {
      logger.error?.('syncStatus.findReady.error', err);
      captureRouteError(err, 'syncStatus.findReady');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. derive-badge
// ────────────────────────────────────────────────────────────────────────

const summaryAsBody = z.object({
  totalItems: z.number().nonnegative().max(1e9),
  byStatus: z.object({
    saved_local: z.number().nonnegative(),
    syncing: z.number().nonnegative(),
    synced: z.number().nonnegative(),
    sync_error: z.number().nonnegative(),
    sync_failed: z.number().nonnegative(),
  }),
  nextRetryAt: z.string().min(10).max(64).optional(),
  failedItems: z.array(syncItemSchema).max(100_000),
}) as unknown as z.ZodType<QueueSummary>;

const deriveBadgeSchema = z.object({ summary: summaryAsBody });

router.post(
  '/:projectId/sync-status/derive-badge',
  verifyAuth,
  validate(deriveBadgeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof deriveBadgeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const badge = deriveBadge(body.summary);
      return res.json({ badge });
    } catch (err) {
      logger.error?.('syncStatus.deriveBadge.error', err);
      captureRouteError(err, 'syncStatus.deriveBadge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
