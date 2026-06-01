// Praeventio Guard — Prevention Cost Simulator client hook (Bloque 3.15).
//
// Wraps the HTTP surface at `src/server/routes/preventionCost.ts`. Three
// operations:
//   1. simulatePreventionCost  (POST)  → on-demand math, no persistence.
//   2. savePreventionScenario  (POST)  → persists named scenario to Firestore.
//   3. usePreventionScenarios  (hook)  → React-friendly list + refetch.
//
// Firebase ID-token auth, JSON-only. Mirror of useLoneWorker / useCostCalculator.

import { apiAuthHeaders } from '../lib/apiAuth';
import { useEndpoint } from './_fetchUtils';
import type {
  NonComplianceInput,
  NonComplianceEstimate,
  PreventionROIInput,
  PreventionROIEstimate,
} from '../services/costCalculator/preventionCostCalculator';

// ── Local mirror of the route's SimulateBody (avoid importing server type)
//
// The Express route file lives under `src/server/` which is server-side
// only — importing it from a hook would drag firebase-admin into the
// client bundle. We re-declare the wire shape here so the hook stays
// pure client-safe; CI's contract test on preventionCost.test.ts proves
// the route accepts this exact shape.

export type Industry =
  | 'mining'
  | 'construction'
  | 'agriculture'
  | 'manufacturing'
  | 'energy'
  | 'transport'
  | 'services'
  | 'health'
  | 'education'
  | 'retail'
  | 'other';

export interface SimulateInput {
  workerCount: number;
  industry: Industry;
  /** Percentage of EPP cost covered by the company (0-100). */
  eppCoveragePct: number;
  /** Training hours per worker per year. */
  trainingHoursPerYear: number;
  nonCompliance: NonComplianceInput;
  prevention: PreventionROIInput;
  /** Annual prevention investment in CLP. */
  preventionInvestmentClp: number;
}

export type RoiLevel = 'underwater' | 'breakeven' | 'positive' | 'excellent';

export interface CostSimulation {
  withoutPrevention: NonComplianceEstimate;
  withPrevention: PreventionROIEstimate;
  expectedNonComplianceClp: number;
  expectedSavingsClp: number;
  netBenefitClp: number;
  /** Number, but Infinity when preventionInvestmentClp is 0 and net is positive. */
  roiRatio: number;
  roiLevel: RoiLevel;
  meta: {
    workerCount: number;
    industry: Industry;
    eppCoveragePct: number;
    trainingHoursPerYear: number;
    preventionInvestmentClp: number;
  };
}

export interface StoredCostScenario {
  id: string;
  name: string;
  description: string | null;
  input: SimulateInput;
  simulation: CostSimulation;
  createdAt: string;
  createdBy: string;
}

// ── shared HTTP helpers ────────────────────────────────────────────────

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. simulate (no persistence) ───────────────────────────────────────

export interface SimulateResponse {
  simulation: CostSimulation;
}

export async function simulatePreventionCost(
  projectId: string,
  input: SimulateInput,
): Promise<SimulateResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/cost/simulate`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SimulateResponse>(res);
}

// ── 2. save-scenario ──────────────────────────────────────────────────

export interface SaveScenarioInput {
  id: string;
  name: string;
  description?: string;
  input: SimulateInput;
}

export interface SaveScenarioResponse {
  ok: true;
  scenario: StoredCostScenario;
}

export async function savePreventionScenario(
  projectId: string,
  payload: SaveScenarioInput,
  idempotencyKey?: string,
): Promise<SaveScenarioResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/cost/save-scenario`,
    { method: 'POST', body: JSON.stringify(payload), headers },
  );
  return json<SaveScenarioResponse>(res);
}

// ── 3. scenarios list (React hook) ────────────────────────────────────

export interface ScenariosResponse {
  scenarios: StoredCostScenario[];
}

export function usePreventionScenarios(projectId: string | null) {
  return useEndpoint<ScenariosResponse>(
    projectId ? `/api/sprint-k/${projectId}/cost/scenarios` : null,
  );
}
