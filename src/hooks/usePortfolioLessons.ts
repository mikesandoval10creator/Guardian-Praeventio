// Praeventio Guard — Portfolio Lessons client hook (2 stateless mutators).

import type {
  LessonRecord,
  LessonTransferRecommendation,
  PortfolioSummary,
  TargetProjectContext,
} from '../services/portfolioLessons/portfolioLessonsEngine';
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

// ── 1. recommend ───────────────────────────────────────────────────────

export interface RecommendLessonsInput {
  lessons: LessonRecord[];
  targetContext: TargetProjectContext;
  maxResults?: number;
  minMatchScore?: number;
}
export interface RecommendLessonsResponse {
  recommendations: LessonTransferRecommendation[];
}

export async function recommendPortfolioLessons(
  projectId: string,
  input: RecommendLessonsInput,
): Promise<RecommendLessonsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/portfolio-lessons/recommend`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecommendLessonsResponse>(res);
}

// ── 2. summarize ───────────────────────────────────────────────────────

export interface SummarizePortfolioInput {
  lessons: LessonRecord[];
}
export interface SummarizePortfolioResponse {
  summary: PortfolioSummary;
}

export async function summarizePortfolioLessons(
  projectId: string,
  input: SummarizePortfolioInput,
): Promise<SummarizePortfolioResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/portfolio-lessons/summarize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SummarizePortfolioResponse>(res);
}
