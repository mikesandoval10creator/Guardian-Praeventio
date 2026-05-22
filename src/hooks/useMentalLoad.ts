// Praeventio Guard — Mental Load (NASA-TLX) + Admin Burden client hook (2 mutators).

import type {
  MentalLoadScore,
  AdminTaskTime,
  AdminBurdenReport,
} from '../services/mentalLoad/mentalLoadTracker';
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

// ── 1. score-survey ────────────────────────────────────────────────────

/**
 * workerUid is forced to the authenticated caller server-side, so it is
 * not part of the client input. Surveys are first-person attestations.
 */
export interface ScoreMentalLoadSurveyInput {
  mentalDemand: number;
  physicalDemand: number;
  temporalDemand: number;
  effort: number;
  frustration: number;
  performance: number;
  surveyedAt: string;
}
export interface ScoreMentalLoadResponse {
  score: MentalLoadScore;
}

export async function scoreMentalLoadSurvey(
  projectId: string,
  input: ScoreMentalLoadSurveyInput,
): Promise<ScoreMentalLoadResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/mental-load/score-survey`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ScoreMentalLoadResponse>(res);
}

// ── 2. build-admin-burden ──────────────────────────────────────────────

export interface BuildAdminBurdenInput {
  tasks: AdminTaskTime[];
  workerUid: string;
}
export interface BuildAdminBurdenResponse {
  report: AdminBurdenReport;
}

export async function buildPerWorkerAdminBurden(
  projectId: string,
  input: BuildAdminBurdenInput,
): Promise<BuildAdminBurdenResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/mental-load/build-admin-burden`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildAdminBurdenResponse>(res);
}
