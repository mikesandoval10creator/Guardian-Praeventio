// Praeventio Guard — Read receipts client hook (6 mutators).

import type {
  DocumentAudience,
  DocumentForRead,
  WorkerForRead,
  ReadReceipt,
  ReadReceiptStatus,
  ReceiptSummary,
} from '../services/readReceipts/readReceiptService';
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

// ── 1. resolve-audience ────────────────────────────────────────────────

export interface ResolveAudienceInput {
  audience: DocumentAudience;
  workers: WorkerForRead[];
}
export interface ResolveAudienceResponse { resolved: WorkerForRead[] }

export async function resolveReadAudience(
  projectId: string,
  input: ResolveAudienceInput,
): Promise<ResolveAudienceResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/read-receipts/resolve-audience`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ResolveAudienceResponse>(res);
}

// ── 2. build-initial ───────────────────────────────────────────────────

export interface BuildInitialInput {
  doc: DocumentForRead;
  audience: WorkerForRead[];
}
export interface BuildInitialResponse { receipts: ReadReceipt[] }

export async function buildInitialReadReceipts(
  projectId: string,
  input: BuildInitialInput,
): Promise<BuildInitialResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/read-receipts/build-initial`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildInitialResponse>(res);
}

// ── 3. compute-deadline ────────────────────────────────────────────────

export interface ComputeDeadlineInput {
  publishedAt: string;
  deadlineDays: number;
}
export interface ComputeDeadlineResponse { deadlineAt: string }

export async function computeReadDeadline(
  projectId: string,
  input: ComputeDeadlineInput,
): Promise<ComputeDeadlineResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/read-receipts/compute-deadline`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeDeadlineResponse>(res);
}

// ── 4. derive-status ───────────────────────────────────────────────────

export interface DeriveStatusInput {
  receipt: ReadReceipt;
  now?: string;
}
export interface DeriveStatusResponse { status: ReadReceiptStatus }

export async function deriveReadReceiptStatus(
  projectId: string,
  input: DeriveStatusInput,
): Promise<DeriveStatusResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/read-receipts/derive-status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DeriveStatusResponse>(res);
}

// ── 5. acknowledge (server-side enforces workerUid === caller) ─────────

export interface AcknowledgeInput {
  receipt: ReadReceipt;
  ackedAt?: string;
}
export interface AcknowledgeResponse { receipt: ReadReceipt }

export async function acknowledgeReadReceipt(
  projectId: string,
  input: AcknowledgeInput,
): Promise<AcknowledgeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/read-receipts/acknowledge`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AcknowledgeResponse>(res);
}

// ── 6. summarize ───────────────────────────────────────────────────────

export interface SummarizeReceiptsInput {
  doc: DocumentForRead;
  receipts: ReadReceipt[];
  now?: string;
}
export interface SummarizeReceiptsResponse { summary: ReceiptSummary }

export async function summarizeReadReceipts(
  projectId: string,
  input: SummarizeReceiptsInput,
): Promise<SummarizeReceiptsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/read-receipts/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeReceiptsResponse>(res);
}
