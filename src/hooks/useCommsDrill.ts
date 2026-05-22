// Praeventio Guard — Emergency Comms Drill client hook (4 stateless mutators).

import type {
  DrillExecutionInput,
  DrillScenario,
  DrillScheduleEntry,
  DrillScoreReport,
  PastDrillExecution,
} from '../services/commsDrill/commsDrillEngine';
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

// ── 1. list-scripts ─────────────────────────────────────────────────────

export interface ListDrillScriptsResponse {
  scripts: DrillScenario[];
}

export async function listCommsDrillScripts(
  projectId: string,
): Promise<ListDrillScriptsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms-drills/list-scripts`,
    { method: 'POST', body: '{}' },
  );
  return json<ListDrillScriptsResponse>(res);
}

// ── 2. get-by-id ────────────────────────────────────────────────────────

export interface GetDrillByIdInput {
  id: string;
}
export interface GetDrillByIdResponse {
  scenario: DrillScenario | null;
}

export async function getCommsDrillById(
  projectId: string,
  input: GetDrillByIdInput,
): Promise<GetDrillByIdResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms-drills/get-by-id`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<GetDrillByIdResponse>(res);
}

// ── 3. score ────────────────────────────────────────────────────────────

export interface ScoreCommsDrillResponse {
  report: DrillScoreReport;
}

export async function scoreCommsDrill(
  projectId: string,
  input: DrillExecutionInput,
): Promise<ScoreCommsDrillResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms-drills/score`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ScoreCommsDrillResponse>(res);
}

// ── 4. plan-schedule ────────────────────────────────────────────────────

export interface PlanDrillScheduleInput {
  pastExecutions: PastDrillExecution[];
  now?: string;
}
export interface PlanDrillScheduleResponse {
  schedule: DrillScheduleEntry[];
}

export async function planCommsDrillSchedule(
  projectId: string,
  input: PlanDrillScheduleInput,
): Promise<PlanDrillScheduleResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/comms-drills/plan-schedule`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<PlanDrillScheduleResponse>(res);
}
