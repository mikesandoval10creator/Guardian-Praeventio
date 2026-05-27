// Praeventio Guard — Lone worker client hook (5 mutators / queries).
//
// Sprint 39 Fase G.11 — Wraps the HTTP surface at
// `src/server/routes/loneWorker.ts`. Firebase ID-token auth, JSON-only.

import { auth } from '../services/firebase';
import type {
  LoneWorkerSession,
  LoneWorkerStatus,
  EscalationDecision,
} from '../services/loneWorker/loneWorkerService';

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

// ── 1. check-in ────────────────────────────────────────────────────────

export interface CheckInInput {
  session: LoneWorkerSession;
  checkIn: {
    at?: string;
    lat?: number;
    lng?: number;
    status?: 'ok' | 'help';
  };
}
export interface CheckInResponse {
  session: LoneWorkerSession;
}

export async function recordLoneWorkerCheckIn(
  projectId: string,
  input: CheckInInput,
  idempotencyKey?: string,
): Promise<CheckInResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/lone-worker/check-in`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<CheckInResponse>(res);
}

// ── 2. end-session ─────────────────────────────────────────────────────

export interface EndSessionInput {
  session: LoneWorkerSession;
  endedAt?: string;
}
export interface EndSessionResponse {
  session: LoneWorkerSession;
}

export async function endLoneWorkerSession(
  projectId: string,
  input: EndSessionInput,
  idempotencyKey?: string,
): Promise<EndSessionResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/lone-worker/end-session`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<EndSessionResponse>(res);
}

// ── 3. derive-status ───────────────────────────────────────────────────

export interface DeriveStatusInput {
  session: LoneWorkerSession;
  now?: string;
}
export interface DeriveStatusResponse {
  status: LoneWorkerStatus;
}

export async function deriveLoneWorkerStatusRemote(
  projectId: string,
  input: DeriveStatusInput,
): Promise<DeriveStatusResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/lone-worker/derive-status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DeriveStatusResponse>(res);
}

// ── 4. decide-escalation ───────────────────────────────────────────────

export interface DecideEscalationInput {
  session: LoneWorkerSession;
  now?: string;
}
export interface DecideEscalationResponse {
  escalation: EscalationDecision | null;
}

export async function decideLoneWorkerEscalation(
  projectId: string,
  input: DecideEscalationInput,
): Promise<DecideEscalationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/lone-worker/decide-escalation`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DecideEscalationResponse>(res);
}

// ── 5. admin-overview ──────────────────────────────────────────────────

export interface AdminOverviewInput {
  sessions: LoneWorkerSession[];
  now?: string;
}
export interface AdminOverviewEntry {
  session: LoneWorkerSession;
  status: LoneWorkerStatus;
  escalation: EscalationDecision | null;
}
export interface AdminOverviewResponse {
  overview: AdminOverviewEntry[];
}

export async function fetchLoneWorkerAdminOverview(
  projectId: string,
  input: AdminOverviewInput,
): Promise<AdminOverviewResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/lone-worker/admin-overview`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AdminOverviewResponse>(res);
}
