// Praeventio Guard — Pricing calculator client hook (4 mutators).

import type {
  TierPlan,
  CurrentUsage,
  TierCostEstimate,
  TierComparison,
  ROIInputs,
  ROIReport,
  ConsumableUsage,
  PurchaseSuggestion,
} from '../services/pricingCalculator/pricingCalculator';
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

// ── 1. estimate-tier-cost ──────────────────────────────────────────────

export interface EstimateTierInput { plan: TierPlan; usage: CurrentUsage }
export interface EstimateTierResponse { estimate: TierCostEstimate }

export async function estimateTierCostRemote(
  projectId: string,
  input: EstimateTierInput,
): Promise<EstimateTierResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pricing-calculator/estimate-tier-cost`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EstimateTierResponse>(res);
}

// ── 2. compare-tiers ───────────────────────────────────────────────────

export interface CompareTiersInput { plans: TierPlan[]; usage: CurrentUsage }
export interface CompareTiersResponse { comparison: TierComparison }

export async function compareTiersRemote(
  projectId: string,
  input: CompareTiersInput,
): Promise<CompareTiersResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pricing-calculator/compare-tiers`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CompareTiersResponse>(res);
}

// ── 3. compute-roi ─────────────────────────────────────────────────────

export interface ComputeROIInput { inputs: ROIInputs }
export interface ComputeROIResponse { report: ROIReport }

export async function computeROIRemote(
  projectId: string,
  input: ComputeROIInput,
): Promise<ComputeROIResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pricing-calculator/compute-roi`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeROIResponse>(res);
}

// ── 4. suggest-purchase-orders ─────────────────────────────────────────

export interface SuggestPOInput { consumables: ConsumableUsage[] }
export interface SuggestPOResponse { suggestions: PurchaseSuggestion[] }

export async function suggestPurchaseOrdersRemote(
  projectId: string,
  input: SuggestPOInput,
): Promise<SuggestPOResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/pricing-calculator/suggest-purchase-orders`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SuggestPOResponse>(res);
}
