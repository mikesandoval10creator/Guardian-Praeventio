// Praeventio Guard — PYME Onboarding client hook (2 mutators).

import { auth } from '../services/firebase';
import type {
  PymeWizardInput,
  MaturityReport,
  PlanAction,
  PymeIndustry,
} from '../services/pymeOnboarding/pymeWizard';

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

// ── 1. maturity ────────────────────────────────────────────────────────

export async function computePymeMaturityApi(
  projectId: string,
  input: PymeWizardInput,
): Promise<{ maturity: MaturityReport }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pyme-onboarding/maturity`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ maturity: MaturityReport }>(res);
}

// ── 2. plan ────────────────────────────────────────────────────────────

export async function buildPymeThirtyDayPlanApi(
  projectId: string,
  input: { maturity: MaturityReport; industry: PymeIndustry },
): Promise<{ plan: PlanAction[] }> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pyme-onboarding/plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<{ plan: PlanAction[] }>(res);
}
