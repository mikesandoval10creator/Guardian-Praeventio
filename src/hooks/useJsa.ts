// Praeventio Guard — JSA (Job Safety Analysis) client hook
// (3 stateless mutators).

import { auth } from '../services/firebase';
import type {
  FinalizedJsa,
  JsaDraft,
  JsaResidualRisk,
  JsaValidationResult,
  ResidualClass,
} from '../services/jsa/jobSafetyAnalysis';

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

// ── 1. validate ─────────────────────────────────────────────────────────

export interface ValidateJsaInput {
  draft: JsaDraft;
}
export interface ValidateJsaResponse {
  result: JsaValidationResult;
}

export async function validateJsaDraft(
  projectId: string,
  input: ValidateJsaInput,
): Promise<ValidateJsaResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/jsa/validate`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ValidateJsaResponse>(res);
}

// ── 2. compute-residual-risks ───────────────────────────────────────────

export interface ResidualRisksInput {
  draft: JsaDraft;
}
export interface ResidualRisksResponse {
  risks: JsaResidualRisk[];
  overallClass: ResidualClass;
}

export async function computeJsaResidualRisks(
  projectId: string,
  input: ResidualRisksInput,
): Promise<ResidualRisksResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/jsa/compute-residual-risks`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ResidualRisksResponse>(res);
}

// ── 3. finalize ─────────────────────────────────────────────────────────

export interface FinalizeJsaInput {
  draft: JsaDraft;
  signedAtIso?: string;
  signatureHashHex: string;
}
export interface FinalizeJsaResponse {
  jsa: FinalizedJsa;
}

export async function finalizeJsa(
  projectId: string,
  input: FinalizeJsaInput,
): Promise<FinalizeJsaResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/jsa/finalize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FinalizeJsaResponse>(res);
}
