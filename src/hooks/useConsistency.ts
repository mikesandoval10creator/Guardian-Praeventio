// Praeventio Guard — Consistency Auditor client hook (2 mutators).

import { auth } from '../services/firebase';
import type {
  ConsistencyState,
  Inconsistency,
} from '../services/consistency/consistencyAuditor';

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

// ── 1. run-audit ───────────────────────────────────────────────────────

export interface RunConsistencyAuditInput {
  state: ConsistencyState;
}
export interface RunConsistencyAuditResponse {
  issues: Inconsistency[];
}

export async function runConsistencyAuditRemote(
  projectId: string,
  input: RunConsistencyAuditInput,
): Promise<RunConsistencyAuditResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/consistency/run-audit`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RunConsistencyAuditResponse>(res);
}

// ── 2. summarize-audit ─────────────────────────────────────────────────

export interface SummarizeConsistencyInput {
  issues: Inconsistency[];
}
export interface SummarizeConsistencyResponse {
  summary: {
    critical: number;
    warning: number;
    info: number;
    total: number;
    byCategory: Record<string, number>;
  };
}

export async function summarizeConsistencyAuditRemote(
  projectId: string,
  input: SummarizeConsistencyInput,
): Promise<SummarizeConsistencyResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/consistency/summarize-audit`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeConsistencyResponse>(res);
}
