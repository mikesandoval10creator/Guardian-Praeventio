// Praeventio Guard — Operational Change (MOC) client hook (4 mutators).

import type {
  OperationalChange,
  ChangeKind,
  ChangeImpact,
  ChangeAcknowledgementSummary,
} from '../services/changeMgmt/operationalChangeService';
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

// ── 1. declare ─────────────────────────────────────────────────────────

/**
 * declaredByUid and projectId are server-side identity overrides; the
 * caller does not pass them. The role is still required because
 * Praeventio enforces APPROVER_ROLES at the engine layer (supervisor /
 * prevencionista / gerente / admin).
 */
export interface DeclareChangeInput {
  id?: string;
  kind: ChangeKind;
  whatChanged: string;
  previousValue: string;
  newValue: string;
  rationale: string;
  impact: ChangeImpact;
  affectedWorkerUids: string[];
  declaredByRole: string;
  effectiveFrom: string;
  referenceDocumentId?: string;
}
export interface DeclareChangeResponse {
  change: OperationalChange;
}

export async function declareOperationalChange(
  projectId: string,
  input: DeclareChangeInput,
): Promise<DeclareChangeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/change-mgmt/declare`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DeclareChangeResponse>(res);
}

// ── 2. acknowledge ─────────────────────────────────────────────────────

export interface AcknowledgeChangeInput {
  change: OperationalChange;
  /** Defaults to the authenticated caller. */
  workerUid?: string;
  ackedAt?: string;
}
export interface AcknowledgeChangeResponse {
  change: OperationalChange;
}

export async function acknowledgeOperationalChange(
  projectId: string,
  input: AcknowledgeChangeInput,
): Promise<AcknowledgeChangeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/change-mgmt/acknowledge`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AcknowledgeChangeResponse>(res);
}

// ── 3. revert ──────────────────────────────────────────────────────────

export interface RevertChangeInput {
  change: OperationalChange;
  reason: string;
  now?: string;
}
export interface RevertChangeResponse {
  change: OperationalChange;
}

export async function revertOperationalChange(
  projectId: string,
  input: RevertChangeInput,
): Promise<RevertChangeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/change-mgmt/revert`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RevertChangeResponse>(res);
}

// ── 4. summarize-acks ──────────────────────────────────────────────────

export interface SummarizeAcksInput {
  change: OperationalChange;
}
export interface SummarizeAcksResponse {
  summary: ChangeAcknowledgementSummary;
}

export async function summarizeChangeAcks(
  projectId: string,
  input: SummarizeAcksInput,
): Promise<SummarizeAcksResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/change-mgmt/summarize-acks`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeAcksResponse>(res);
}
