// Praeventio Guard — Behavior-Based Safety client hook (2 mutators).

import { auth } from '../services/firebase';
import type {
  BbsObservation,
  BbsProfile,
  ObservationCategory,
  BehaviorOutcome,
} from '../services/behaviorObservation/bbsObservationEngine';

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
