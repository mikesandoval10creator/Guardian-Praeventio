// Praeventio Guard — Protocols (IPER + PREXOR + TMERT) client hook (3 mutators).

import { auth } from '../services/firebase';
import type { IperInput, IperResult } from '../services/protocols/iper';
import type {
  PrexorMeasurement,
  PrexorResult,
} from '../services/protocols/prexor';
import type { TmertInput, TmertResult } from '../services/protocols/tmert';

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. iper ────────────────────────────────────────────────────────────

export interface CalculateIperInput { input: IperInput }
export interface CalculateIperResponse { result: IperResult }

export async function calculateIperRemote(
  projectId: string,
  input: CalculateIperInput,
): Promise<CalculateIperResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/iper`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CalculateIperResponse>(res);
}

// ── 2. prexor ──────────────────────────────────────────────────────────

export interface CalculatePrexorInput { measurements: PrexorMeasurement[] }
export interface CalculatePrexorResponse { result: PrexorResult }

export async function calculatePrexorRemote(
  projectId: string,
  input: CalculatePrexorInput,
): Promise<CalculatePrexorResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/prexor`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CalculatePrexorResponse>(res);
}

// ── 3. tmert ───────────────────────────────────────────────────────────

export interface EvaluateTmertInput { input: TmertInput }
export interface EvaluateTmertResponse { result: TmertResult }

export async function evaluateTmertRemote(
  projectId: string,
  input: EvaluateTmertInput,
): Promise<EvaluateTmertResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/protocols/tmert`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateTmertResponse>(res);
}
