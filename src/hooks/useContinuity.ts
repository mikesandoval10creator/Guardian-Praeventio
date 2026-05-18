// Praeventio Guard — Business Continuity client hook (3 mutators).

import { auth } from '../services/firebase';
import type {
  ContinuityInput,
  SinglePointOfFailure,
  ScenarioInput,
  ScenarioOutcome,
  PolyvalencePlan,
} from '../services/continuity/continuityPlanning';

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

// ── 1. detect-spofs ────────────────────────────────────────────────────

export interface DetectSPOFsInput {
  input: ContinuityInput;
}
export interface DetectSPOFsResponse {
  spofs: SinglePointOfFailure[];
}

export async function detectContinuitySPOFs(
  projectId: string,
  input: DetectSPOFsInput,
): Promise<DetectSPOFsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/continuity/detect-spofs`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectSPOFsResponse>(res);
}

// ── 2. simulate-outage ─────────────────────────────────────────────────

export interface SimulateOutageInput {
  input: ScenarioInput;
}
export interface SimulateOutageResponse {
  outcome: ScenarioOutcome;
}

export async function simulateContinuityOutage(
  projectId: string,
  input: SimulateOutageInput,
): Promise<SimulateOutageResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/continuity/simulate-outage`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SimulateOutageResponse>(res);
}

// ── 3. build-polyvalence-plan ──────────────────────────────────────────

/**
 * Engine SkillMatrix uses Set<string>; this client wire passes plain
 * string arrays, which the server converts before invoking the engine.
 */
export interface BuildPolyvalenceInput {
  matrix: Array<{ workerUid: string; skills: string[] }>;
  requiredSkills: string[];
  minCoveragePercent?: number;
}
export interface BuildPolyvalenceResponse {
  plan: PolyvalencePlan;
}

export async function buildContinuityPolyvalencePlan(
  projectId: string,
  input: BuildPolyvalenceInput,
): Promise<BuildPolyvalenceResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/continuity/build-polyvalence-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildPolyvalenceResponse>(res);
}
