// Praeventio Guard — Exception engine client hook (6 mutators).

import type {
  ExceptionRecord,
  ExceptionDomain,
  ExceptionStatus,
  ExceptionAuditSummary,
} from '../services/exceptions/exceptionEngine';
import { apiAuthHeaders } from '../lib/apiAuth';

async function authedFetch(
  path: string,
  init: RequestInit = {},

): Promise<Response> {
  // §2.20 migration (2026-05-21) — usa apiAuthHeaders() unificado:
  // prefiere E2E header en MODE=test, fallback a Bearer productivo.
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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. create — approvedByUid server-side ──────────────────────────────

export interface CreateExceptionWireInput {
  id: string;
  domain: ExceptionDomain;
  subjectRef: { kind: 'WORKER' | 'EPP' | 'TASK' | 'EQUIPMENT' | 'DOCUMENT'; id: string };
  reason: string;
  alternativeMitigation: string;
  approvedByRole: string;
  durationHours: number;
  evidenceUrls?: string[];
  notes?: string;
  now?: string;
}
export interface CreateExceptionResponse {
  record: ExceptionRecord;
}

export async function createExceptionRemote(
  projectId: string,
  input: CreateExceptionWireInput,
): Promise<CreateExceptionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/exceptions/create`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CreateExceptionResponse>(res);
}

// ── 2. derive-status ───────────────────────────────────────────────────

export interface DeriveStatusInput {
  record: ExceptionRecord;
  now?: string;
}
export interface DeriveStatusResponse {
  status: ExceptionStatus;
}

export async function deriveExceptionStatus(
  projectId: string,
  input: DeriveStatusInput,
): Promise<DeriveStatusResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/exceptions/derive-status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DeriveStatusResponse>(res);
}

// ── 3. revoke — revokedByUid server-side ───────────────────────────────

export interface RevokeExceptionInput {
  record: ExceptionRecord;
  revokedReason: string;
  now?: string;
}
export interface RevokeExceptionResponse {
  record: ExceptionRecord;
}

export async function revokeExceptionRemote(
  projectId: string,
  input: RevokeExceptionInput,
): Promise<RevokeExceptionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/exceptions/revoke`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RevokeExceptionResponse>(res);
}

// ── 4. mark-fulfilled ──────────────────────────────────────────────────

export interface MarkFulfilledInput {
  record: ExceptionRecord;
  now?: string;
}
export interface MarkFulfilledResponse {
  record: ExceptionRecord;
}

export async function markExceptionFulfilled(
  projectId: string,
  input: MarkFulfilledInput,
): Promise<MarkFulfilledResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/exceptions/mark-fulfilled`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<MarkFulfilledResponse>(res);
}

// ── 5. filter-active-at  /  6. summarize ───────────────────────────────

export interface RecordsInput {
  records: ExceptionRecord[];
  now?: string;
}
export interface FilterActiveResponse {
  active: ExceptionRecord[];
}
export interface SummarizeResponse {
  summary: ExceptionAuditSummary;
}

export async function filterExceptionsActiveAt(
  projectId: string,
  input: RecordsInput,
): Promise<FilterActiveResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/exceptions/filter-active-at`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FilterActiveResponse>(res);
}

export async function summarizeExceptions(
  projectId: string,
  input: RecordsInput,
): Promise<SummarizeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/exceptions/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeResponse>(res);
}
