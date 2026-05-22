// Praeventio Guard — Ergonomics REBA/RULA client hook (2 mutators).

import type { RebaInput, RebaResult } from '../services/ergonomics/reba';
import type { RulaInput, RulaResult } from '../services/ergonomics/rula';
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

// ── 1. calculate-reba ──────────────────────────────────────────────────

export interface CalculateRebaResponse { result: RebaResult }

export async function calculateRebaRemote(
  projectId: string,
  input: RebaInput,
): Promise<CalculateRebaResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ergonomics/calculate-reba`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CalculateRebaResponse>(res);
}

// ── 2. calculate-rula ──────────────────────────────────────────────────

export interface CalculateRulaResponse { result: RulaResult }

export async function calculateRulaRemote(
  projectId: string,
  input: RulaInput,
): Promise<CalculateRulaResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/ergonomics/calculate-rula`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CalculateRulaResponse>(res);
}
