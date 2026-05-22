// Praeventio Guard — Pricing Simulator client hook (3 stateless mutators).

import type {
  BillEstimate,
  EstimateOptions,
  Tier,
  TierComparison,
  UsageProfile,
} from '../services/pricingSimulator/pricingSimulator';
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

// ── 1. estimate-bill ───────────────────────────────────────────────────

export interface EstimateBillInput {
  tier: Tier;
  usage: UsageProfile;
  options?: EstimateOptions;
}
export interface EstimateBillResponse {
  estimate: BillEstimate;
}

export async function estimateBillFor(
  projectId: string,
  input: EstimateBillInput,
): Promise<EstimateBillResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pricing/estimate-bill`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EstimateBillResponse>(res);
}

// ── 2. compare-tiers ───────────────────────────────────────────────────

export interface CompareTiersInput {
  currentTier: Tier;
  usage: UsageProfile;
  options?: EstimateOptions;
}
export interface CompareTiersResponse {
  comparisons: TierComparison[];
}

export async function comparePricingTiers(
  projectId: string,
  input: CompareTiersInput,
): Promise<CompareTiersResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pricing/compare-tiers`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CompareTiersResponse>(res);
}

// ── 3. worker-break-even ───────────────────────────────────────────────

export interface WorkerBreakEvenInput {
  currentTier: Tier;
  nextTier: Tier;
  baseUsage: UsageProfile;
  options?: EstimateOptions;
}
export interface WorkerBreakEvenResponse {
  workers: number;
  found: boolean;
}

export async function findWorkerBreakEven(
  projectId: string,
  input: WorkerBreakEvenInput,
): Promise<WorkerBreakEvenResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pricing/worker-break-even`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<WorkerBreakEvenResponse>(res);
}
