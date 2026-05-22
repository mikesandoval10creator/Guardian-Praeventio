// Praeventio Guard — Spaced Repetition (SM-2) client hook (4 mutators).

import type {
  LearningCard,
  RetentionReport,
} from '../services/spacedRepetition/spacedRepetitionScheduler';
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

// ── 1. create-card ─────────────────────────────────────────────────────

export interface CreateCardInput {
  cardId: string;
  workerUid: string;
  topic: string;
  initiallyLearnedAt: string;
}
export interface CardResponse {
  card: LearningCard;
}

export async function createLearningCard(
  projectId: string,
  input: CreateCardInput,
): Promise<CardResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/spaced-repetition/create-card`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CardResponse>(res);
}

// ── 2. review-card ─────────────────────────────────────────────────────

export interface ReviewCardInput {
  card: LearningCard;
  quality: 0 | 1 | 2 | 3 | 4 | 5;
  nowIso?: string;
}

export async function reviewLearningCard(
  projectId: string,
  input: ReviewCardInput,
): Promise<CardResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/spaced-repetition/review-card`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CardResponse>(res);
}

// ── 3. select-due-cards ────────────────────────────────────────────────

export interface SelectDueCardsInput {
  cards: LearningCard[];
  nowIso?: string;
}
export interface SelectDueCardsResponse {
  due: LearningCard[];
}

export async function selectDueLearningCards(
  projectId: string,
  input: SelectDueCardsInput,
): Promise<SelectDueCardsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/spaced-repetition/select-due-cards`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SelectDueCardsResponse>(res);
}

// ── 4. build-retention-report ──────────────────────────────────────────

export interface BuildRetentionInput {
  cards: LearningCard[];
  workerUid: string;
}
export interface BuildRetentionResponse {
  report: RetentionReport;
}

export async function buildLearningRetentionReport(
  projectId: string,
  input: BuildRetentionInput,
): Promise<BuildRetentionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/spaced-repetition/build-retention-report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildRetentionResponse>(res);
}
