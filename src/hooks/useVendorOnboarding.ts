// Praeventio Guard — Vendor/Contractor onboarding client hook
// (5 stateless mutators over the engines under
// `services/vendorOnboarding/`).

import type {
  OnboardingStage,
  VendorOnboardingState,
  VendorRequirement,
  VendorRequirementCompliance,
} from '../services/vendorOnboarding/vendorOnboardingFlow';
import type {
  AccreditationObservation,
  AccreditationStatus,
} from '../services/vendorOnboarding/vendorAccreditationTracker';
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

// ── 1. evaluate-stage ───────────────────────────────────────────────────

export interface EvaluateStageInput {
  state: VendorOnboardingState;
  compliance: VendorRequirementCompliance[];
  requirements: VendorRequirement[];
  now?: string;
}
export interface EvaluateStageResponse {
  stage: OnboardingStage;
}

export async function evaluateVendorOnboardingStage(
  projectId: string,
  input: EvaluateStageInput,
): Promise<EvaluateStageResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/vendors/onboarding/evaluate-stage`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateStageResponse>(res);
}

// ── 2. missing-mandatory ────────────────────────────────────────────────

export interface MissingMandatoryInput {
  compliance: VendorRequirementCompliance[];
  requirements: VendorRequirement[];
}
export interface MissingMandatoryResponse {
  requirements: VendorRequirement[];
}

export async function listVendorMissingMandatory(
  projectId: string,
  vendorId: string,
  input: MissingMandatoryInput,
): Promise<MissingMandatoryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/vendors/${vendorId}/onboarding/missing-mandatory`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<MissingMandatoryResponse>(res);
}

// ── 3. build-client-bundle ──────────────────────────────────────────────

export interface BuildClientBundleInput {
  clientId: string;
  baseRequirements: VendorRequirement[];
  clientSpecificRequirements: VendorRequirement[];
}
export interface BuildClientBundleResponse {
  requirements: VendorRequirement[];
}

export async function buildVendorClientBundle(
  projectId: string,
  input: BuildClientBundleInput,
): Promise<BuildClientBundleResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/vendors/onboarding/build-client-bundle`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildClientBundleResponse>(res);
}

// ── 4. accreditation summarize ──────────────────────────────────────────

export interface SummarizeAccreditationInput {
  observations: AccreditationObservation[];
}
export interface SummarizeAccreditationResponse {
  status: AccreditationStatus;
}

export async function summarizeVendorAccreditation(
  projectId: string,
  vendorId: string,
  input: SummarizeAccreditationInput,
): Promise<SummarizeAccreditationResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/vendors/${vendorId}/accreditation/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeAccreditationResponse>(res);
}

// ── 5. should-escalate ──────────────────────────────────────────────────

export interface ShouldEscalateInput {
  observation: AccreditationObservation;
  history: AccreditationObservation[];
  windowDays?: number;
}
export interface ShouldEscalateResponse {
  shouldEscalate: boolean;
}

export async function shouldEscalateVendorObservation(
  projectId: string,
  vendorId: string,
  input: ShouldEscalateInput,
): Promise<ShouldEscalateResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/vendors/${vendorId}/accreditation/should-escalate`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShouldEscalateResponse>(res);
}
