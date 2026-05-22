// Praeventio Guard — Circadian Rhythm + Alertness client hook (3 mutators).

import type {
  CircadianWindow,
  CircadianInput,
  AlertnessReport,
  ShiftWorker,
  ShiftRotationRecommendation,
} from '../services/circadian/circadianRhythmService';
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

// ── 1. classify-window ─────────────────────────────────────────────────

export interface ClassifyWindowInput {
  localHour: number;
}
export interface ClassifyWindowResponse {
  window: CircadianWindow;
}

export async function classifyCircadianWindowRemote(
  projectId: string,
  input: ClassifyWindowInput,
): Promise<ClassifyWindowResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/circadian/classify-window`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ClassifyWindowResponse>(res);
}

// ── 2. assess-alertness ────────────────────────────────────────────────

export interface AssessAlertnessResponse {
  report: AlertnessReport;
}

export async function assessCircadianAlertness(
  projectId: string,
  input: CircadianInput,
): Promise<AssessAlertnessResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/circadian/assess-alertness`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AssessAlertnessResponse>(res);
}

// ── 3. recommend-shift-rotation ────────────────────────────────────────

export interface RecommendShiftResponse {
  recommendation: ShiftRotationRecommendation;
}

export async function recommendCircadianShiftRotation(
  projectId: string,
  input: ShiftWorker,
): Promise<RecommendShiftResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/circadian/recommend-shift-rotation`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecommendShiftResponse>(res);
}
