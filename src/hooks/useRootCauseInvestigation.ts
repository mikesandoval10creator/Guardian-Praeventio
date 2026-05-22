// Praeventio Guard — Root Cause Investigation Mode client hook
// (4 stateless mutators).

import type {
  BuildTreeInput,
  InvestigationTree,
  SixMCategory,
} from '../services/rootCauseInvestigation/investigationMode';
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

// ── 1. build-tree ──────────────────────────────────────────────────────

export interface BuildInvestigationTreeResponse {
  tree: InvestigationTree;
}

export async function buildInvestigationTreeRemote(
  projectId: string,
  input: BuildTreeInput,
): Promise<BuildInvestigationTreeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/investigations/build-tree`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildInvestigationTreeResponse>(res);
}

// ── 2. extract-chain ───────────────────────────────────────────────────

export interface ExtractChainInput {
  tree: InvestigationTree;
}
export interface ExtractChainResponse {
  chain: string[];
}

export async function extractInvestigationDeepestChain(
  projectId: string,
  input: ExtractChainInput,
): Promise<ExtractChainResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/investigations/extract-chain`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ExtractChainResponse>(res);
}

// ── 3. classify-category ───────────────────────────────────────────────

export interface ClassifyCategoryInput {
  text: string;
}
export interface ClassifyCategoryResponse {
  category: SixMCategory;
}

export async function classifyInvestigationCategory(
  projectId: string,
  input: ClassifyCategoryInput,
): Promise<ClassifyCategoryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/investigations/classify-category`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ClassifyCategoryResponse>(res);
}

// ── 4. is-shallow-answer ───────────────────────────────────────────────

export interface IsShallowAnswerInput {
  answer: string;
}
export interface IsShallowAnswerResponse {
  shallow: boolean;
}

export async function isInvestigationAnswerShallow(
  projectId: string,
  input: IsShallowAnswerInput,
): Promise<IsShallowAnswerResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/investigations/is-shallow-answer`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<IsShallowAnswerResponse>(res);
}
