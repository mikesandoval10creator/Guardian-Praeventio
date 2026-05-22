// Praeventio Guard — Routing engines client hook (2 mutators).

import type { GridCell } from '../services/routing/gridAStar';
import type {
  RouteAssessmentInput,
  RouteAssessmentResult,
} from '../services/routing/routeClimateAssessment';
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

// ── 1. find-path-astar ─────────────────────────────────────────────────

export interface FindPathInput {
  grid: number[][];
  start: GridCell;
  goal: GridCell;
  opts?: { allowDiagonals?: boolean };
}
export interface FindPathResponse {
  path: GridCell[] | null;
}

export async function findPathAStarRemote(
  projectId: string,
  input: FindPathInput,
): Promise<FindPathResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/routing/find-path-astar`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FindPathResponse>(res);
}

// ── 2. assess-climate ──────────────────────────────────────────────────

export interface AssessClimateInput {
  input: RouteAssessmentInput;
}
export interface AssessClimateResponse {
  assessment: RouteAssessmentResult;
}

export async function assessRouteClimateRemote(
  projectId: string,
  input: AssessClimateInput,
): Promise<AssessClimateResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/routing/assess-climate`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AssessClimateResponse>(res);
}
