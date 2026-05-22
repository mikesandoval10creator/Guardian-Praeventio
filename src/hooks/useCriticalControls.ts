// Praeventio Guard — Critical Controls client hook (9 mutators).

import type {
  CriticalControl,
  ControlLevel,
  ControlValidation,
  PreTaskValidationResult,
} from '../services/criticalControls/criticalControlsLibrary';
import type {
  EnergyType,
  ControlVerificationFrequency,
  BarrierAnalysis,
  ControlVerificationStatus,
} from '../services/criticalControls/controlRobustness';
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

// ── 1. get-for-risk ────────────────────────────────────────────────────

export interface GetForRiskInput { riskCategory: string }
export interface GetForRiskResponse { controls: CriticalControl[] }

export async function getCriticalControlsForRisk(
  projectId: string,
  input: GetForRiskInput,
): Promise<GetForRiskResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/get-for-risk`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<GetForRiskResponse>(res);
}

// ── 2. validate-pre-task (validatedByUid server-side) ──────────────────

export interface ValidatePreTaskInput {
  riskCategory: string;
  validations: ControlValidation[];
  now?: string;
}
export interface ValidatePreTaskResponse { result: PreTaskValidationResult }

export async function validateCriticalControlsPreTask(
  projectId: string,
  input: ValidatePreTaskInput,
): Promise<ValidatePreTaskResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/validate-pre-task`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidatePreTaskResponse>(res);
}

// ── 3. robustness-score ────────────────────────────────────────────────

export interface RobustnessScoreInput { control: { level: ControlLevel } }
export interface RobustnessScoreResponse { score: number }

export async function controlRobustnessScoreRemote(
  projectId: string,
  input: RobustnessScoreInput,
): Promise<RobustnessScoreResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/robustness-score`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RobustnessScoreResponse>(res);
}

// ── 4. superior-to ─────────────────────────────────────────────────────

export interface SuperiorToInput { level: ControlLevel }
export interface SuperiorToResponse { levels: ControlLevel[] }

export async function findControlSuperiorToRemote(
  projectId: string,
  input: SuperiorToInput,
): Promise<SuperiorToResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/superior-to`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SuperiorToResponse>(res);
}

// ── 5. build-barrier-analysis ──────────────────────────────────────────

export interface BuildBarrierInput {
  riskCategory: string;
  catalog: CriticalControl[];
  validations: ControlValidation[];
}
export interface BuildBarrierResponse { analysis: BarrierAnalysis }

export async function buildBarrierAnalysisRemote(
  projectId: string,
  input: BuildBarrierInput,
): Promise<BuildBarrierResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/build-barrier-analysis`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildBarrierResponse>(res);
}

// ── 6. detect-single-barrier ───────────────────────────────────────────

export interface DetectSingleBarrierInput {
  riskCategories: string[];
  catalog: CriticalControl[];
  validations: ControlValidation[];
}
export interface DetectSingleBarrierResponse { analyses: BarrierAnalysis[] }

export async function detectSingleBarrierRisksRemote(
  projectId: string,
  input: DetectSingleBarrierInput,
): Promise<DetectSingleBarrierResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/detect-single-barrier`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectSingleBarrierResponse>(res);
}

// ── 7. verification-status ─────────────────────────────────────────────

export interface VerifStatusInput {
  controlId: string;
  frequency: ControlVerificationFrequency;
  lastVerifiedAt?: string;
  nowIso?: string;
}
export interface VerifStatusResponse { status: ControlVerificationStatus }

export async function computeControlVerificationStatus(
  projectId: string,
  input: VerifStatusInput,
): Promise<VerifStatusResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/verification-status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<VerifStatusResponse>(res);
}

// ── 8. energy-for-control ──────────────────────────────────────────────

export interface EnergyForInput { controlId: string }
export interface EnergyForResponse { energy: EnergyType | null }

export async function getEnergyForControl(
  projectId: string,
  input: EnergyForInput,
): Promise<EnergyForResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/energy-for-control`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EnergyForResponse>(res);
}

// ── 9. by-energy ───────────────────────────────────────────────────────

export interface ByEnergyInput { catalog: CriticalControl[] }
export interface ByEnergyResponse { grouped: Record<EnergyType, CriticalControl[]> }

export async function controlsByEnergyRemote(
  projectId: string,
  input: ByEnergyInput,
): Promise<ByEnergyResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/critical-controls/by-energy`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ByEnergyResponse>(res);
}
