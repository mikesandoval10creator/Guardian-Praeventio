// Praeventio Guard — Tamper-Proof Audit Hash Chain client hook (4 mutators).

import type {
  AuditEvent,
  AppendInput,
  VerifyResult,
} from '../services/audit/tamperProofChain';
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

// ── 1. append ──────────────────────────────────────────────────────────

export interface AppendAuditEventInput {
  prev: AuditEvent | null;
  input: AppendInput;
}
export interface AppendAuditEventResponse {
  event: AuditEvent;
}

export async function appendAuditEvent(
  projectId: string,
  input: AppendAuditEventInput,
): Promise<AppendAuditEventResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-chain/append`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AppendAuditEventResponse>(res);
}

// ── 2. verify ──────────────────────────────────────────────────────────

export interface VerifyAuditChainInput {
  chain: AuditEvent[];
}
export interface VerifyAuditChainResponse {
  result: VerifyResult;
}

export async function verifyAuditChain(
  projectId: string,
  input: VerifyAuditChainInput,
): Promise<VerifyAuditChainResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-chain/verify`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<VerifyAuditChainResponse>(res);
}

// ── 3. anchor ──────────────────────────────────────────────────────────

export interface AuditChainAnchorResponse {
  anchor: string | null;
}

export async function getAuditChainAnchor(
  projectId: string,
  input: VerifyAuditChainInput,
): Promise<AuditChainAnchorResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-chain/anchor`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AuditChainAnchorResponse>(res);
}

// ── 4. find-gap ────────────────────────────────────────────────────────

export interface AuditChainGapResponse {
  gap: { gapAt: number } | null;
}

export async function findAuditChainGap(
  projectId: string,
  input: VerifyAuditChainInput,
): Promise<AuditChainGapResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/audit-chain/find-gap`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AuditChainGapResponse>(res);
}
