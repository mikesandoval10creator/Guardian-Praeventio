// Praeventio Guard — ROI Scenario Comparator client hook (1 mutator).

import { auth } from '../services/firebase';
import type {
  InvestmentScenario,
  BaselineState,
  ScenarioComparison,
} from '../services/roiScenario/roiScenarioSimulator';

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

export interface CompareScenariosInput {
  scenarios: InvestmentScenario[];
  baseline: BaselineState;
}
export interface CompareScenariosResponse {
  comparison: ScenarioComparison;
}

export async function compareRoiScenarios(
  projectId: string,
  input: CompareScenariosInput,
): Promise<CompareScenariosResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/roi-scenario/compare`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CompareScenariosResponse>(res);
}
