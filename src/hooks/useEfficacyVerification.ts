// Praeventio Guard — Corrective-Action Efficacy Verification client hook
// (2 stateless mutators).

import type {
  EfficacyVerificationResult,
  PostActionWindow,
  VerifyEfficacyInput,
} from '../services/efficacyVerification/efficacyVerifier';
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

// ── 1. verify ──────────────────────────────────────────────────────────

export interface VerifyEfficacyClientInput {
  input: VerifyEfficacyInput;
  now?: string;
}
export interface VerifyEfficacyResponse {
  result: EfficacyVerificationResult;
}

export async function verifyEfficacyOfActions(
  projectId: string,
  input: VerifyEfficacyClientInput,
): Promise<VerifyEfficacyResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/efficacy/verify`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<VerifyEfficacyResponse>(res);
}

// ── 2. default-window ──────────────────────────────────────────────────

export interface DefaultPostActionWindowInput {
  closedAt: string;
  recurrences?: PostActionWindow['recurrenceIncidents'];
  leading?: PostActionWindow['leadingIndicators'];
  windowDays?: number;
}
export interface DefaultPostActionWindowResponse {
  window: PostActionWindow;
}

export async function buildDefaultPostActionWindow(
  projectId: string,
  input: DefaultPostActionWindowInput,
): Promise<DefaultPostActionWindowResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/efficacy/default-window`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DefaultPostActionWindowResponse>(res);
}
