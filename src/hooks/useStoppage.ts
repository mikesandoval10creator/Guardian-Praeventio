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

export interface DeclareStoppageClientInput {
  id: string;
  category: StoppageCategory;
  scope: StoppageScope;
  scopeTargetId: string;
  reason: string;
  declaredByRole: string;
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

// ── 3. resume ─────────────────────────────────────────────────────────

export async function resumeStoppageApi(
  projectId: string,
  input: { stoppage: Stoppage; resumedByRole: string },
): Promise<{ stoppage: Stoppage }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/stoppage/resume`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ stoppage: Stoppage }>(res);
}

/**
 * Stub — orphan UI consumer `src/components/stoppage/StoppageResumeModal.tsx`
 * calls this as `resumeStoppage(projectId, { stoppage, justification,
 * measuresAdopted, resumedByRole, signatureAttested }, idempotencyKey)`,
 * with a richer payload than {@link resumeStoppageApi} accepts. Until the
 * modal is mounted in a route, the stub echoes back the input stoppage.
 * Tracked TODO §13.
 */
export async function resumeStoppage(
  _projectId: string,
  input: {
    stoppage: Stoppage;
    justification: string;
    measuresAdopted: string[];
    resumedByRole: string;
    signatureAttested: boolean;
  },
  _idempotencyKey: string,
): Promise<{ stoppage: Stoppage }> {
  return { stoppage: input.stoppage };
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
