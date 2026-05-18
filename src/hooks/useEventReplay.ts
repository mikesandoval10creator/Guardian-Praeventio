// Praeventio Guard — Event Replay Audit Tool client hook (3 mutators).

import { auth } from '../services/firebase';
import type {
  DomainEventLike,
  ReplayQuery,
  ReplayResult,
  StateDiff,
} from '../services/eventReplay/eventReplayAuditTool';

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. execute ─────────────────────────────────────────────────────────

export interface ExecuteReplayInput<S = unknown> {
  events: DomainEventLike[];
  query: ReplayQuery;
  initialState?: S;
  nowOverride?: string;
}
export interface ExecuteReplayResponse<S = unknown> {
  result: ReplayResult<S>;
}

export async function executeEventReplay<S = unknown>(
  projectId: string,
  input: ExecuteReplayInput<S>,
): Promise<ExecuteReplayResponse<S>> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/event-replay/execute`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ExecuteReplayResponse<S>>(res);
}

// ── 2. diff-states ─────────────────────────────────────────────────────

export interface DiffStatesInput<S = unknown> {
  before: S;
  after: S;
  meta: { beforeAt: string; afterAt: string };
}
export interface DiffStatesResponse<S = unknown> {
  diff: StateDiff<S>;
}

export async function diffReplayStates<S = unknown>(
  projectId: string,
  input: DiffStatesInput<S>,
): Promise<DiffStatesResponse<S>> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/event-replay/diff-states`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DiffStatesResponse<S>>(res);
}

// ── 3. export-trail ────────────────────────────────────────────────────

export interface ExportTrailInput {
  replays: ReplayResult<unknown>[];
  format: 'markdown' | 'csv';
}
export interface ExportTrailResponse {
  trail: string;
}

export async function exportReplayTrail(
  projectId: string,
  input: ExportTrailInput,
): Promise<ExportTrailResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/event-replay/export-trail`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ExportTrailResponse>(res);
}
