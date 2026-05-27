// Praeventio Guard — Sync Status client hook (5 mutators).

import { auth } from '../services/firebase';
import type {
  SyncItem,
  QueueSummary,
  SyncBadge,
  CreateItemInput,
} from '../services/syncStatus/syncQueueTracker';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
