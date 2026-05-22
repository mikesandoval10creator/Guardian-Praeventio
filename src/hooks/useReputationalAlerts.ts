// Praeventio Guard — Reputational Alerts client hook (2 stateless mutators).

import type {
  ExternalSignal,
  ReputationalAlert,
  ReputationalRiskSummary,
} from '../services/reputationalAlerts/reputationalAlertEngine';
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

export interface AnalyzeReputationalRiskInput {
  signals: ExternalSignal[];
  windowDays?: number;
}
export interface AnalyzeReputationalRiskResponse {
  alerts: ReputationalAlert[];
}

export async function analyzeReputationalRiskRemote(
  projectId: string,
  input: AnalyzeReputationalRiskInput,
): Promise<AnalyzeReputationalRiskResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/reputational-alerts/analyze`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AnalyzeReputationalRiskResponse>(res);
}

// ── 2. summarize ───────────────────────────────────────────────────────

export interface SummarizeReputationalRiskInput {
  signals: ExternalSignal[];
  windowDays?: number;
}
export interface SummarizeReputationalRiskResponse {
  summary: ReputationalRiskSummary;
}

export async function summarizeReputationalRiskRemote(
  projectId: string,
  input: SummarizeReputationalRiskInput,
): Promise<SummarizeReputationalRiskResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/reputational-alerts/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeReputationalRiskResponse>(res);
}
