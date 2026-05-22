// Praeventio Guard — Prevention Cost Calculator client hook (2 mutators).

import type {
  NonComplianceInput,
  NonComplianceEstimate,
  PreventionROIInput,
  PreventionROIEstimate,
} from '../services/costCalculator/preventionCostCalculator';
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
