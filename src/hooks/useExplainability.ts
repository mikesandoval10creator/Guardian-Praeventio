// Praeventio Guard — F.28 Explainability client hook.
//
// Stateless mutators that wrap /api/sprint-k/:projectId/explainability/*.
// React components compose these with their existing recommendation
// state (e.g. SafetyCoach AI suggestions, Inbox AI-flagged items).

import type {
  ExplainedRecommendation,
  ExplainInput,
} from '../services/explainability/recommendationExplainer';
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

export interface ExplainSingleResponse {
  explained: ExplainedRecommendation;
}

export async function explainRecommendation(
  projectId: string,
  input: ExplainInput,
): Promise<ExplainSingleResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/explainability/recommendation`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as ExplainSingleResponse;
}

export interface ExplainBatchResponse {
  actionable: ExplainedRecommendation[];
  needsReview: ExplainedRecommendation[];
}

export async function explainRecommendationBatch(
  projectId: string,
  recommendations: ExplainInput[],
): Promise<ExplainBatchResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/explainability/batch`,
    {
      method: 'POST',
      body: JSON.stringify({ recommendations }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as ExplainBatchResponse;
}
