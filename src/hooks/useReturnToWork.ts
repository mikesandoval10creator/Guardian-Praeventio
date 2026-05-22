// Praeventio Guard — Return-to-Work client hook (3 stateless mutators).

import type {
  WorkerRestriction,
  TaskRequirements,
  TaskFitAssessment,
  DerivationDecisionInput,
  MutualityDerivation,
  BuildRtwPlanInput,
  ReturnToWorkPlan,
} from '../services/returnToWork/returnToWorkPlanner';
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

// ── 1. assess-task-fit ─────────────────────────────────────────────────

export interface AssessTaskFitInput {
  workerRestrictions: WorkerRestriction[];
  task: TaskRequirements;
  now?: string;
}
export interface AssessTaskFitResponse {
  assessment: TaskFitAssessment;
}

export async function assessReturnToWorkTaskFit(
  projectId: string,
  input: AssessTaskFitInput,
): Promise<AssessTaskFitResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/return-to-work/assess-task-fit`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AssessTaskFitResponse>(res);
}

// ── 2. decide-derivation ───────────────────────────────────────────────

export interface DecideDerivationInput {
  input: DerivationDecisionInput;
  now?: string;
}
export interface DecideDerivationResponse {
  derivation: MutualityDerivation;
}

export async function decideMutualityDerivation(
  projectId: string,
  input: DecideDerivationInput,
): Promise<DecideDerivationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/return-to-work/decide-derivation`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DecideDerivationResponse>(res);
}

// ── 3. build-plan ──────────────────────────────────────────────────────

export interface BuildReturnToWorkPlanResponse {
  plan: ReturnToWorkPlan;
}

export async function buildReturnToWorkPlanRemote(
  projectId: string,
  input: BuildRtwPlanInput,
): Promise<BuildReturnToWorkPlanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/return-to-work/build-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildReturnToWorkPlanResponse>(res);
}
