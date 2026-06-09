// Praeventio Guard — First Responder Map client hook (2 mutators).

import type {
  Responder,
  IncidentKind,
  IncidentLocation,
  DispatchPlan,
  CoverageGap,
} from '../services/firstResponderMap/firstResponderMap';
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
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. build-dispatch-plan ─────────────────────────────────────────────

export interface BuildDispatchPlanInput {
  responders: Responder[];
  incident: { kind: IncidentKind; location: IncidentLocation };
  options?: {
    walkSpeedMps?: number;
    maxLastSeenStaleSeconds?: number;
  };
  now?: string;
}
export interface BuildDispatchPlanResponse {
  plan: DispatchPlan;
}

export async function buildFirstResponderDispatchPlan(
  projectId: string,
  input: BuildDispatchPlanInput,
): Promise<BuildDispatchPlanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/first-responder-map/build-dispatch-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildDispatchPlanResponse>(res);
}

// ── 2. analyze-coverage ────────────────────────────────────────────────

export interface AnalyzeCoverageInput {
  responders: Responder[];
}
export interface AnalyzeCoverageResponse {
  gaps: CoverageGap[];
}

export async function analyzeFirstResponderCoverage(
  projectId: string,
  input: AnalyzeCoverageInput,
): Promise<AnalyzeCoverageResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/first-responder-map/analyze-coverage`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AnalyzeCoverageResponse>(res);
}

// ── 3. responder-feed (REAL data source for the panel) ─────────────────

export interface ResponderFeedResponse {
  responders: Responder[];
  coverageGaps: CoverageGap[];
}

/**
 * Fetch the REAL responder feed (brigade roster + last-known positions +
 * honest availability) the engine consumes. A member with no recent position
 * ping comes back position-less → honestly unavailable for dispatch. Wire its
 * `responders` into buildFirstResponderDispatchPlan + the panel.
 */
export async function fetchFirstResponderFeed(
  projectId: string,
): Promise<ResponderFeedResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/first-responder-map/responder-feed`,
    { method: 'GET' },
  );
  return json<ResponderFeedResponse>(res);
}
