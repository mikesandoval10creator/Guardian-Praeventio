// Praeventio Guard — Research Mode client hook (4 mutators).

import type {
  RootCauseTree,
  BranchPath,
  TreeSummary,
  SimilarityScore,
  FailedControlSignal,
} from '../services/researchMode/researchMode';
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

// ── 1. find-root-branches ──────────────────────────────────────────────

export interface TreeInput {
  tree: RootCauseTree;
}
export interface FindRootBranchesResponse {
  branches: BranchPath[];
}

export async function findResearchRootBranches(
  projectId: string,
  input: TreeInput,
): Promise<FindRootBranchesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/research-mode/find-root-branches`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FindRootBranchesResponse>(res);
}

// ── 2. summarize-tree ──────────────────────────────────────────────────

export interface SummarizeTreeResponse {
  summary: TreeSummary;
}

export async function summarizeResearchTree(
  projectId: string,
  input: TreeInput,
): Promise<SummarizeTreeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/research-mode/summarize-tree`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizeTreeResponse>(res);
}

// ── 3. compare-trees ───────────────────────────────────────────────────

export interface CompareTreesInput {
  primary: RootCauseTree;
  others: RootCauseTree[];
}
export interface CompareTreesResponse {
  scores: SimilarityScore[];
}

export async function compareResearchTrees(
  projectId: string,
  input: CompareTreesInput,
): Promise<CompareTreesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/research-mode/compare-trees`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CompareTreesResponse>(res);
}

// ── 4. detect-failed-control-patterns ──────────────────────────────────

export interface DetectFailedControlsInput {
  trees: RootCauseTree[];
}
export interface DetectFailedControlsResponse {
  signals: FailedControlSignal[];
}

export async function detectResearchFailedControlPatterns(
  projectId: string,
  input: DetectFailedControlsInput,
): Promise<DetectFailedControlsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/research-mode/detect-failed-control-patterns`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectFailedControlsResponse>(res);
}
