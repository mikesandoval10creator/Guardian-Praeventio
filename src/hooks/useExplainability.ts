// Praeventio Guard — F.28 Explainability client hook.
//
// Stateless mutators that wrap /api/sprint-k/:projectId/explainability/*.
// React components compose these with their existing recommendation
// state (e.g. SafetyCoach AI suggestions, Inbox AI-flagged items).

import { auth } from '../services/firebase';
import type {
  ExplainedRecommendation,
  ExplainInput,
} from '../services/explainability/recommendationExplainer';

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
