// Praeventio Guard — Non-Conformity client hook (3 mutators).

import { auth } from '../services/firebase';
import type {
  NonConformity,
  NonConformityStatus,
  CorrectiveActionRef,
  NcActionLink,
  PatternBucket,
} from '../services/nonConformity/nonConformityEngine';

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

// ── 1. link-to-action ──────────────────────────────────────────────────

export interface LinkNcInput {
  nc: NonConformity;
  action: CorrectiveActionRef;
  now?: string;
}
export interface LinkNcResponse {
  nc: NonConformity;
  link: NcActionLink;
}

export async function linkNcToActionRemote(
  projectId: string,
  input: LinkNcInput,
): Promise<LinkNcResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/non-conformity/link-to-action`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<LinkNcResponse>(res);
}

// ── 2. evaluate-cycle-stage ────────────────────────────────────────────

export interface EvaluateStageInput {
  nc: NonConformity;
}
export interface EvaluateStageResponse {
  status: NonConformityStatus;
}

export async function evaluateNcCycleStageRemote(
  projectId: string,
  input: EvaluateStageInput,
): Promise<EvaluateStageResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/non-conformity/evaluate-cycle-stage`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateStageResponse>(res);
}

// ── 3. bulk-classify-by-pattern ────────────────────────────────────────

export interface BulkClassifyInput {
  ncs: NonConformity[];
  top?: number;
}
export interface BulkClassifyResponse {
  buckets: PatternBucket[];
}

export async function bulkClassifyNcByPattern(
  projectId: string,
  input: BulkClassifyInput,
): Promise<BulkClassifyResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/non-conformity/bulk-classify-by-pattern`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BulkClassifyResponse>(res);
}
