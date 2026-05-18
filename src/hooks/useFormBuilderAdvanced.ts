// Praeventio Guard — Form Builder Advanced client hook (5 stateless mutators).

import { auth } from '../services/firebase';
import type {
  AdvancedFormResponse,
  ComputedFieldFormula,
  CrossFieldValidationFinding,
  CrossFieldValidationRule,
} from '../services/formBuilderAdvanced/advancedFieldEngine';

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

// ── 1. evaluate-computed-field ──────────────────────────────────────────

export interface EvaluateComputedFieldInput {
  formula: ComputedFieldFormula;
  responses: AdvancedFormResponse[];
  now?: string;
}
export interface EvaluateComputedFieldResponse {
  value: unknown;
}

export async function evaluateComputedFieldRemote(
  projectId: string,
  input: EvaluateComputedFieldInput,
): Promise<EvaluateComputedFieldResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/forms-advanced/evaluate-computed-field`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateComputedFieldResponse>(res);
}

// ── 2. validate-cross-field ─────────────────────────────────────────────

export interface ValidateCrossFieldInput {
  rules: CrossFieldValidationRule[];
  responses: AdvancedFormResponse[];
  now?: string;
}
export interface ValidateCrossFieldResponse {
  findings: CrossFieldValidationFinding[];
}

export async function validateCrossFieldRulesRemote(
  projectId: string,
  input: ValidateCrossFieldInput,
): Promise<ValidateCrossFieldResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/forms-advanced/validate-cross-field`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateCrossFieldResponse>(res);
}

// ── 3. detect-circular-deps ─────────────────────────────────────────────

export interface DetectCircularDepsInput {
  formulas: ComputedFieldFormula[];
}
export interface DetectCircularDepsResponse {
  cyclic: string[];
}

export async function detectFormulaCircularDeps(
  projectId: string,
  input: DetectCircularDepsInput,
): Promise<DetectCircularDepsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/forms-advanced/detect-circular-deps`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectCircularDepsResponse>(res);
}

// ── 4. topo-sort ────────────────────────────────────────────────────────

export interface TopoSortInput {
  formulas: ComputedFieldFormula[];
  otherFieldIds?: string[];
}
export interface TopoSortResponse {
  order: string[];
}

export async function topologicalSortFormulas(
  projectId: string,
  input: TopoSortInput,
): Promise<TopoSortResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/forms-advanced/topo-sort`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<TopoSortResponse>(res);
}

// ── 5. evaluate-all-computed ────────────────────────────────────────────

export interface EvaluateAllComputedInput {
  formulas: ComputedFieldFormula[];
  responses: AdvancedFormResponse[];
  now?: string;
  otherFieldIds?: string[];
}
export interface EvaluateAllComputedResponse {
  values: Record<string, unknown>;
}

export async function evaluateAllComputedFields(
  projectId: string,
  input: EvaluateAllComputedInput,
): Promise<EvaluateAllComputedResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/forms-advanced/evaluate-all-computed`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateAllComputedResponse>(res);
}
