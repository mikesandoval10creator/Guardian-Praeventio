// Praeventio Guard — Contingency Simulation client hook (4 stateless mutators).

import type {
  BuildScenarioOptions,
  ContingencyScenario,
  ScenarioKind,
  ScenarioSeverity,
} from '../services/contingencySimulation/contingencyScenarioBuilder';
import type {
  TabletopAttempt,
  TabletopResult,
} from '../services/contingencySimulation/tabletopExerciseEngine';
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

// ── 1. build-scenario ───────────────────────────────────────────────────

export interface BuildScenarioInput {
  kind: ScenarioKind;
  severity: ScenarioSeverity;
  options?: BuildScenarioOptions;
}
export interface BuildScenarioResponse {
  scenario: ContingencyScenario;
}

export async function buildContingencyScenario(
  projectId: string,
  input: BuildScenarioInput,
): Promise<BuildScenarioResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contingency/build-scenario`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildScenarioResponse>(res);
}

// ── 2. list-available-scenarios ─────────────────────────────────────────

export interface ListAvailableScenariosInput {
  industry?: BuildScenarioOptions['industry'];
}
export interface ListAvailableScenariosResponse {
  scenarios: ContingencyScenario[];
}

export async function listContingencyScenarios(
  projectId: string,
  input: ListAvailableScenariosInput = {},
): Promise<ListAvailableScenariosResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contingency/list-available-scenarios`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ListAvailableScenariosResponse>(res);
}

// ── 3. count-available-templates ────────────────────────────────────────

export interface CountTemplatesResponse {
  count: number;
}

export async function countContingencyTemplates(
  projectId: string,
): Promise<CountTemplatesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contingency/count-available-templates`,
    { method: 'POST', body: '{}' },
  );
  return json<CountTemplatesResponse>(res);
}

// ── 4. evaluate-tabletop ────────────────────────────────────────────────

export interface EvaluateTabletopInput {
  attempt: TabletopAttempt;
  scenario: ContingencyScenario;
}
export interface EvaluateTabletopResponse {
  result: TabletopResult;
}

export async function evaluateTabletopExercise(
  projectId: string,
  input: EvaluateTabletopInput,
): Promise<EvaluateTabletopResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contingency/evaluate-tabletop`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateTabletopResponse>(res);
}
