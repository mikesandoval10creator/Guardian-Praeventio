// Praeventio Guard — Sync Status client hook (5 mutators + real-queue hook).
//
// B16 wire (2026-06): `useSyncQueueStatus` below is the hook the app shell
// actually mounts (SyncQueueIndicator). It reads the REAL central offline
// queue — OfflineSyncStateMachine (src/services/sync/syncStateMachine.ts),
// the same queue OfflineSyncManager drains — and derives the visible
// summary/badge ON-DEVICE via the pure syncQueueTracker engine. The 5 HTTP
// wrappers that follow are kept for server-verified flows, but they are NOT
// in the badge path: the badge exists precisely for when the worker is
// offline, so its derivation can never depend on an HTTP round-trip.

import { useEffect, useMemo, useState } from 'react';

import { apiAuthHeaders } from '../lib/apiAuth';
import {
  offlineSync,
  type OfflineSyncStateMachine,
  type SyncOperation,
  type SyncStateSnapshot,
} from '../services/sync/syncStateMachine';
import {
  deriveBadge,
  summarizeQueue,
  type SyncStatus,
} from '../services/syncStatus/syncQueueTracker';
import type {
  SyncItem,
  QueueSummary,
  SyncBadge,
  CreateItemInput,
} from '../services/syncStatus/syncQueueTracker';

// ── 0. useSyncQueueStatus — REAL queue → visible badge (B16 wire) ──────

export interface SyncQueueStatus {
  summary: QueueSummary;
  badge: SyncBadge;
  /** Fuerza un drain inmediato de la cola real (fire-and-forget). */
  retry: () => void;
}

/**
 * Maps a state-machine SyncOperation onto the tracker's SyncItem shape so
 * the pure engine (summarizeQueue/deriveBadge) can run over the REAL queue.
 * `synced` never appears here by construction: synced ops leave the queue.
 */
function opToItem(op: SyncOperation, machineSyncing: boolean): SyncItem {
  const status: SyncStatus = op.deadLettered
    ? 'sync_failed'
    : machineSyncing
      ? 'syncing'
      : op.attempts > 0
        ? 'sync_error'
        : 'saved_local';
  return {
    id: op.id,
    collection: op.collection,
    op: op.type === 'set' ? 'update' : op.type,
    payload: (op.data ?? {}) as Record<string, unknown>,
    status,
    createdAt: new Date(op.createdAt).toISOString(),
    attempts: op.attempts,
    ...(op.lastAttemptMs
      ? { lastAttemptAt: new Date(op.lastAttemptMs).toISOString() }
      : {}),
    ...(op.lastError ? { lastError: op.lastError } : {}),
  };
}

export function useSyncQueueStatus(
  machine: OfflineSyncStateMachine = offlineSync,
): SyncQueueStatus {
  const [snap, setSnap] = useState<SyncStateSnapshot>(() => machine.getState());

  useEffect(() => {
    // subscribe fires synchronously with the current snapshot, so the first
    // post-mount render is already consistent with the hydrated queue.
    return machine.subscribe(setSnap);
  }, [machine]);

  return useMemo(() => {
    const syncing = snap.state === 'online_syncing';
    const items = [
      ...snap.operations.map((op) => opToItem(op, syncing)),
      // Dead-letters are excluded from the snapshot's pending ops but they
      // are exactly what the worker must see ("N fallidos" → escalate).
      ...machine.deadLetters().map((op) => opToItem(op, false)),
    ];
    const summary = summarizeQueue(items);
    return {
      summary,
      badge: deriveBadge(summary),
      retry: () => {
        void machine.syncNow();
      },
    };
  }, [snap, machine]);
}

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. create-item ─────────────────────────────────────────────────────

export async function createSyncItemApi(
  projectId: string,
  input: Omit<CreateItemInput, 'now'>,
): Promise<{ item: SyncItem }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/sync-status/create-item`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ item: SyncItem }>(res);
}

// ── 2. transition ──────────────────────────────────────────────────────

export type SyncTransition =
  | { transition: 'syncing'; item: SyncItem }
  | { transition: 'synced'; item: SyncItem }
  | { transition: 'error'; item: SyncItem; errorMessage: string };

export async function transitionSyncItemApi(
  projectId: string,
  input: SyncTransition,
): Promise<{ item: SyncItem }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/sync-status/transition`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ item: SyncItem }>(res);
}

// ── 3. summarize ───────────────────────────────────────────────────────

export async function summarizeSyncQueueApi(
  projectId: string,
  input: { items: SyncItem[] },
): Promise<{ summary: QueueSummary }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/sync-status/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ summary: QueueSummary }>(res);
}

// ── 4. find-ready ──────────────────────────────────────────────────────

export async function findSyncItemsReadyForRetryApi(
  projectId: string,
  input: { items: SyncItem[] },
): Promise<{ ready: SyncItem[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/sync-status/find-ready`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ ready: SyncItem[] }>(res);
}

// ── 5. derive-badge ────────────────────────────────────────────────────

export async function deriveSyncBadgeApi(
  projectId: string,
  input: { summary: QueueSummary },
): Promise<{ badge: SyncBadge }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/sync-status/derive-badge`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ badge: SyncBadge }>(res);
}
