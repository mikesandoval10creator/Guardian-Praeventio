// Praeventio Guard — Coach IA RAG client hook (3 mutators).

import { auth } from '../services/firebase';
import type { NormativeChunk } from '../services/coach/normativeRag';
import type { CoachDomain, DomainPrompt } from '../services/coach/prompts';

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

// ── 1. search-top-k ────────────────────────────────────────────────────

export interface SearchCoachRagInput {
  query: string;
  domain: CoachDomain;
  k?: number;
}
export interface SearchCoachRagResponse {
  chunks: NormativeChunk[];
}

export async function searchCoachRagTopK(
  projectId: string,
  input: SearchCoachRagInput,
): Promise<SearchCoachRagResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/coach-rag/search-top-k`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SearchCoachRagResponse>(res);
}

// ── 2. list-chunks ─────────────────────────────────────────────────────

export type CoachRagChunkSummary = Omit<NormativeChunk, 'embedding'>;
export interface ListCoachRagChunksResponse {
  chunks: CoachRagChunkSummary[];
}

export async function listCoachRagChunks(
  projectId: string,
): Promise<ListCoachRagChunksResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/coach-rag/list-chunks`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<ListCoachRagChunksResponse>(res);
}

// ── 3. get-domain-prompt ───────────────────────────────────────────────

export interface GetDomainPromptInput {
  domain: CoachDomain;
}
export interface GetDomainPromptResponse {
  prompt: DomainPrompt;
}

export async function getCoachDomainPrompt(
  projectId: string,
  input: GetDomainPromptInput,
): Promise<GetDomainPromptResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/coach-rag/get-domain-prompt`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<GetDomainPromptResponse>(res);
}
