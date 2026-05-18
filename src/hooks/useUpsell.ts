// Praeventio Guard — Pain-Based Upsell client hook (1 stateless mutator).

import { auth } from '../services/firebase';
import type {
  UpsellSuggestion,
  UsagePainSignals,
} from '../services/upsell/painBasedUpsellSuggester';

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
