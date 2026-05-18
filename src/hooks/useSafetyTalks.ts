// Praeventio Guard — Safety talks topic suggester client hook (1 mutator).

import { auth } from '../services/firebase';
import type {
  ContextSignals,
  SafetyTalkSuggestion,
} from '../services/safetyTalks/talkTopicSuggester';

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

export interface SuggestTalksInput { signals: ContextSignals }
export interface SuggestTalksResponse { suggestions: SafetyTalkSuggestion[] }

export async function suggestSafetyTalks(
  projectId: string,
  input: SuggestTalksInput,
): Promise<SuggestTalksResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-talks/suggest`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SuggestTalksResponse>(res);
}
