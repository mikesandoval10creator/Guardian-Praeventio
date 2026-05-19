// Praeventio Guard — Prevention Cost Calculator client hook (2 mutators).

import { auth } from '../services/firebase';
import type {
  NonComplianceInput,
  NonComplianceEstimate,
  PreventionROIInput,
  PreventionROIEstimate,
} from '../services/costCalculator/preventionCostCalculator';

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

// ── 1. non-compliance ──────────────────────────────────────────────────

export interface NonComplianceResponse {
  estimate: NonComplianceEstimate;
}

export async function estimateNonComplianceCostRemote(
  projectId: string,
  input: NonComplianceInput,
): Promise<NonComplianceResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/cost-calculator/non-compliance`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<NonComplianceResponse>(res);
}

// ── 2. prevention-roi ──────────────────────────────────────────────────

export interface PreventionROIResponse {
  estimate: PreventionROIEstimate;
}

export async function estimatePreventionROIRemote(
  projectId: string,
  input: PreventionROIInput,
): Promise<PreventionROIResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/cost-calculator/prevention-roi`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<PreventionROIResponse>(res);
}
