// Praeventio Guard — Retaliation Protection client hook (2 stateless mutators).

import type {
  ProtectiveAction,
  RetaliationRiskAssessment,
  RetaliationSignal,
} from '../services/retaliationProtection/retaliationDetector';
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

// ── 1. analyze ─────────────────────────────────────────────────────────

export interface AnalyzeRetaliationRiskInput {
  reportFiledAt: string;
  signals: RetaliationSignal[];
  evaluationWindowDays?: number;
}
export interface AnalyzeRetaliationRiskResponse {
  assessment: RetaliationRiskAssessment;
}

export async function analyzeRetaliationRiskRemote(
  projectId: string,
  input: AnalyzeRetaliationRiskInput,
): Promise<AnalyzeRetaliationRiskResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/retaliation/analyze`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AnalyzeRetaliationRiskResponse>(res);
}

// ── 2. recommend-actions ───────────────────────────────────────────────

export interface RecommendProtectiveActionsInput {
  assessment: RetaliationRiskAssessment;
}
export interface RecommendProtectiveActionsResponse {
  actions: ProtectiveAction[];
}

export async function recommendProtectiveActionsRemote(
  projectId: string,
  input: RecommendProtectiveActionsInput,
): Promise<RecommendProtectiveActionsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/retaliation/recommend-actions`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecommendProtectiveActionsResponse>(res);
}
