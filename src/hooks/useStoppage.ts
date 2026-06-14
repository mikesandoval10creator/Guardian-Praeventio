// Praeventio Guard — Stoppage client hook (5 mutators).
//
// declaredByUid / verifierUid / resumedByUid / cancelledByUid are forced
// server-side from the authenticated caller, so they are NOT part of the
// client input.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  Stoppage,
  StoppageCategory,
  StoppageScope,
} from '../services/stoppage/stoppageEngine';

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

// ── 1. declare ────────────────────────────────────────────────────────

// id + declaredByRole are NOT part of the client input: the server mints the
// id (no client RNG) and derives declaredByRole from the verified token (a
// client role would let a worker fabricate an approver-level declaration).
export interface DeclareStoppageClientInput {
  category: StoppageCategory;
  scope: StoppageScope;
  scopeTargetId: string;
  reason: string;
  resumptionPreconditions: Array<{ id: string; label: string }>;
}

export async function declareStoppageApi(
  projectId: string,
  input: DeclareStoppageClientInput,
): Promise<{ stoppage: Stoppage }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/declare`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ stoppage: Stoppage }>(res);
}

// ── 2. mark-precondition-fulfilled ────────────────────────────────────

export async function markStoppagePreconditionFulfilledApi(
  projectId: string,
  input: { stoppage: Stoppage; preconditionId: string; evidenceUrl?: string },
): Promise<{ stoppage: Stoppage }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/mark-precondition-fulfilled`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ stoppage: Stoppage }>(res);
}

// ── 3. resume (server-authoritative) ──────────────────────────────────
//
// Fused single resume client (was: dead `resumeStoppageApi` echo-stub +
// `resumeStoppage` stub). The server route is SERVER-AUTHORITATIVE: it reads
// the stoppage by id, derives the approver role from the verified token (the
// `resumedByRole` carried by the modal is display-only and intentionally NOT
// sent), requires the signature attestation, and persists + audits the act.

export interface ResumeStoppageClientInput {
  /** The pending_resumption stoppage being lifted (only its id reaches the wire). */
  stoppage: Stoppage;
  /** Free-form justification (≥15 chars, enforced client + server). */
  justification: string;
  /** Concrete measures that enable the resumption (≥1). */
  measuresAdopted: string[];
  /** Caller's role — display-only; the server uses the token claim. */
  resumedByRole: string;
  /** Biometric signature attested — the server rejects a resume without it. */
  signatureAttested: boolean;
}

export async function resumeStoppage(
  projectId: string,
  input: ResumeStoppageClientInput,
  idempotencyKey: string,
): Promise<{ stoppage: Stoppage }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/resume`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        stoppageId: input.stoppage.id,
        justification: input.justification,
        measuresAdopted: input.measuresAdopted,
        signatureAttested: input.signatureAttested,
      }),
    },
  );
  return json<{ stoppage: Stoppage }>(res);
}

// ── 4. cancel ─────────────────────────────────────────────────────────

export async function cancelStoppageApi(
  projectId: string,
  input: { stoppage: Stoppage; reason: string },
): Promise<{ stoppage: Stoppage }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/cancel`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ stoppage: Stoppage }>(res);
}

// ── 5. summarize ──────────────────────────────────────────────────────

export interface StoppageSummary {
  total: number;
  active: number;
  pendingResumption: number;
  resumed: number;
  cancelled: number;
  longestActiveHours: number;
}

export async function summarizeStoppagesApi(
  projectId: string,
  input: { stoppages: Stoppage[] },
): Promise<{ summary: StoppageSummary }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ summary: StoppageSummary }>(res);
}
