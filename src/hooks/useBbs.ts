// Praeventio Guard — Behavior-Based Safety client hook (2 mutators).

import type {
  BbsObservation,
  BbsProfile,
  ObservationCategory,
  BehaviorOutcome,
} from '../services/behaviorObservation/bbsObservationEngine';
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

// ── 1. record-observation ──────────────────────────────────────────────

/**
 * observerUid and tenantId are forced server-side: observerUid = caller
 * (BBS is anti-blaming, observador is whoever is logged in) and tenantId =
 * projectId from the URL.
 */
export interface RecordBbsObservationInput {
  observationId: string;
  areaId: string;
  category: ObservationCategory;
  outcome: BehaviorOutcome;
  note: string;
}
export interface RecordBbsObservationResponse {
  observation: BbsObservation;
}

export async function recordBbsObservation(
  projectId: string,
  input: RecordBbsObservationInput,
): Promise<RecordBbsObservationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/bbs/record-observation`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecordBbsObservationResponse>(res);
}

// ── 2. build-profile ───────────────────────────────────────────────────

export interface BuildBbsProfileInput {
  observations: BbsObservation[];
  windowStart: string;
  windowEnd: string;
}
export interface BuildBbsProfileResponse {
  profile: BbsProfile;
}

export async function buildBbsProfile(
  projectId: string,
  input: BuildBbsProfileInput,
): Promise<BuildBbsProfileResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/bbs/build-profile`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildBbsProfileResponse>(res);
}
