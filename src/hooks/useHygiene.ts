// Praeventio Guard — Industrial Hygiene client hook (2 mutators).

import type { MifflinInput, Sex } from '../services/hygiene/metabolicRate';
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

// ── 1. bmr ─────────────────────────────────────────────────────────────

export interface ComputeBmrInput {
  weightKg?: number;
  heightCm?: number;
  ageYears?: number;
  sex?: Sex;
}
export interface ComputeBmrResponse {
  bmr: number | null;
}

export async function computeMifflinStJeorBmr(
  projectId: string,
  input: ComputeBmrInput,
): Promise<ComputeBmrResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/hygiene/bmr`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeBmrResponse>(res);
}

// ── 2. current-burn ────────────────────────────────────────────────────

export interface EstimateCurrentBurnInput {
  bmr: number | null;
  hourOfDay: number;
}
export interface EstimateCurrentBurnResponse {
  burn: number | null;
}

export async function estimateHygieneCurrentBurn(
  projectId: string,
  input: EstimateCurrentBurnInput,
): Promise<EstimateCurrentBurnResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/hygiene/current-burn`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EstimateCurrentBurnResponse>(res);
}

export type { MifflinInput };
