// Praeventio Guard — Post-Training Assessment client hook (4 stateless mutators).

import type {
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentResult,
  CaseStudyMatch,
  CaseStudyNode,
  Difficulty,
  ReviewScheduleItem,
  ScoreOptions,
} from '../services/postTraining/postTrainingAssessmentEngine';
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

// ── 1. score-assessment ────────────────────────────────────────────────

export interface ScoreAssessmentInput {
  trainingId: string;
  questions: AssessmentQuestion[];
  attempts: AssessmentAttempt[];
  options?: ScoreOptions;
}
export interface ScoreAssessmentResponse {
  result: AssessmentResult;
}

export async function scoreTrainingAssessment(
  projectId: string,
  input: ScoreAssessmentInput,
): Promise<ScoreAssessmentResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/post-training/score-assessment`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ScoreAssessmentResponse>(res);
}

// ── 2. next-review-delay ───────────────────────────────────────────────

export interface NextReviewDelayInput {
  difficulty: Difficulty;
  consecutiveCorrect: number;
}
export interface NextReviewDelayResponse {
  days: number;
}

export async function nextReviewDelayRemote(
  projectId: string,
  input: NextReviewDelayInput,
): Promise<NextReviewDelayResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/post-training/next-review-delay`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<NextReviewDelayResponse>(res);
}

// ── 3. schedule-next-reviews ───────────────────────────────────────────

export interface ScheduleNextReviewsInput {
  topicHistory: Array<{
    topic: string;
    difficulty: Difficulty;
    consecutiveCorrect: number;
  }>;
  now?: string;
}
export interface ScheduleNextReviewsResponse {
  schedule: ReviewScheduleItem[];
}

export async function scheduleNextReviewsRemote(
  projectId: string,
  input: ScheduleNextReviewsInput,
): Promise<ScheduleNextReviewsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/post-training/schedule-next-reviews`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ScheduleNextReviewsResponse>(res);
}

// ── 4. find-case-studies ───────────────────────────────────────────────

export interface FindCaseStudiesInput {
  topicsOfInterest: string[];
  nodes: CaseStudyNode[];
  industry?: string;
  maxResults?: number;
  preferSevere?: boolean;
}
export interface FindCaseStudiesResponse {
  matches: CaseStudyMatch[];
}

export async function findRelevantCaseStudiesRemote(
  projectId: string,
  input: FindCaseStudiesInput,
): Promise<FindCaseStudiesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/post-training/find-case-studies`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<FindCaseStudiesResponse>(res);
}
