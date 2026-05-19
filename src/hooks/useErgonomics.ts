// Praeventio Guard — Ergonomics REBA/RULA client hook (2 mutators).

import { auth } from '../services/firebase';
import type { RebaInput, RebaResult } from '../services/ergonomics/reba';
import type { RulaInput, RulaResult } from '../services/ergonomics/rula';

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
