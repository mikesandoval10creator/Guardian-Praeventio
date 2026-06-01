// Praeventio Guard — PYME Wizard client hook (1 mutator).

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  PymeOnboardingInput,
  OnboardingPlan,
} from '../services/pymeWizard/pymeOnboardingWizard';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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

export interface BuildPymeOnboardingPlanResponse {
  plan: OnboardingPlan;
}

export async function buildPymeOnboardingPlanApi(
  projectId: string,
  input: PymeOnboardingInput,
): Promise<BuildPymeOnboardingPlanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pyme-wizard/build-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildPymeOnboardingPlanResponse>(res);
}
