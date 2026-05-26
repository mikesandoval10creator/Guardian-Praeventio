// Praeventio Guard — Stoppage client hook.
//
// Wraps `src/server/routes/stoppage.ts`. Firebase ID-token auth, JSON-only.
// Mirrors the readReceipts / loneWorker client patterns.
//
// Directiva founder: el sistema RECOMIENDA paro, nunca lo ejecuta. La
// firma biométrica del resume ocurre en el componente, no aquí; este
// hook solo transporta la attestation booleana acordada con el route.

import { auth } from '../services/firebase';
import type {
  Stoppage,
  StoppageCategory,
  StoppageScope,
  StoppageStatus,
  StoppageSummary,
} from '../services/stoppage/stoppageEngine';

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
      code?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. recommend ───────────────────────────────────────────────────────

export interface RecommendStoppageInput {
  id: string;
  category: StoppageCategory;
  scope: StoppageScope;
  scopeTargetId: string;
  reason: string;
  declaredByRole: string;
  resumptionPreconditions: Array<{ id: string; label: string }>;
  now?: string;
}
export interface RecommendStoppageResponse {
  stoppage: Stoppage;
}

export async function recommendStoppage(
  projectId: string,
  input: RecommendStoppageInput,
  idempotencyKey?: string,
): Promise<RecommendStoppageResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/recommend`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<RecommendStoppageResponse>(res);
}

// ── 2. active ──────────────────────────────────────────────────────────

export interface ActiveStoppagesResponse {
  stoppages: Stoppage[];
  summary: StoppageSummary;
}

export async function fetchActiveStoppages(
  projectId: string,
): Promise<ActiveStoppagesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/active`,
    { method: 'GET' },
  );
  return json<ActiveStoppagesResponse>(res);
}

// ── 3. acknowledge ─────────────────────────────────────────────────────

export interface AcknowledgeStoppageInput {
  stoppage: Stoppage;
  preconditionId: string;
  evidenceUrl?: string;
  now?: string;
}
export interface AcknowledgeStoppageResponse {
  stoppage: Stoppage;
}

export async function acknowledgeStoppage(
  projectId: string,
  input: AcknowledgeStoppageInput,
  idempotencyKey?: string,
): Promise<AcknowledgeStoppageResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/acknowledge`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<AcknowledgeStoppageResponse>(res);
}

// ── 4. resume (justification + signature attestation) ──────────────────

export interface ResumeStoppageInput {
  stoppage: Stoppage;
  justification: string;
  measuresAdopted: string[];
  resumedByRole: string;
  signatureAttested: true;
  now?: string;
}
export interface ResumeStoppageResponse {
  stoppage: Stoppage;
  audit: {
    justification: string;
    measuresAdopted: string[];
    signatureAttested: true;
  };
}

export async function resumeStoppage(
  projectId: string,
  input: ResumeStoppageInput,
  idempotencyKey?: string,
): Promise<ResumeStoppageResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/resume`,
    { method: 'POST', body: JSON.stringify(input), headers },
  );
  return json<ResumeStoppageResponse>(res);
}

// ── 5. history ─────────────────────────────────────────────────────────

export interface StoppageHistoryQuery {
  status?: StoppageStatus;
}
export interface StoppageHistoryResponse {
  stoppages: Stoppage[];
  summary: StoppageSummary;
}

export async function fetchStoppageHistory(
  projectId: string,
  q: StoppageHistoryQuery = {},
): Promise<StoppageHistoryResponse> {
  const qs = q.status ? `?status=${encodeURIComponent(q.status)}` : '';
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/history${qs}`,
    { method: 'GET' },
  );
  return json<StoppageHistoryResponse>(res);
}
