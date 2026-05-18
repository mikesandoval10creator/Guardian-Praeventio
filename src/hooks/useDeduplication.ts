// Praeventio Guard — Record Deduplication client hook (2 stateless mutators).

import { auth } from '../services/firebase';
import type {
  DedupRecord,
  DuplicateCandidate,
  MergePlan,
} from '../services/deduplication/recordDeduplicator';

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

// ── 1. detect ──────────────────────────────────────────────────────────

export interface DetectDuplicatesInput {
  records: DedupRecord[];
  reviewThreshold?: number;
  suggestThreshold?: number;
  autoMergeThreshold?: number;
}
export interface DetectDuplicatesResponse {
  candidates: DuplicateCandidate[];
}

export async function detectRecordDuplicates(
  projectId: string,
  input: DetectDuplicatesInput,
): Promise<DetectDuplicatesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/deduplication/detect`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectDuplicatesResponse>(res);
}

// ── 2. build-merge-plan ────────────────────────────────────────────────

export interface BuildMergePlanInput {
  candidate: DuplicateCandidate;
  records: DedupRecord[];
  edgesOnDuplicates?: Record<string, number>;
}
export interface BuildMergePlanResponse {
  plan: MergePlan;
}

export async function buildRecordMergePlan(
  projectId: string,
  input: BuildMergePlanInput,
): Promise<BuildMergePlanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/deduplication/build-merge-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildMergePlanResponse>(res);
}
