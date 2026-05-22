// Praeventio Guard — Pain-Based Upsell client hook (1 stateless mutator).

import type {
  UpsellSuggestion,
  UsagePainSignals,
} from '../services/upsell/painBasedUpsellSuggester';
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

export interface SuggestUpsellResponse {
  suggestions: UpsellSuggestion[];
}

export async function suggestPainBasedUpsell(
  projectId: string,
  signals: UsagePainSignals,
): Promise<SuggestUpsellResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/upsell/suggest`,
    { method: 'POST', body: JSON.stringify(signals) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as SuggestUpsellResponse;
}
