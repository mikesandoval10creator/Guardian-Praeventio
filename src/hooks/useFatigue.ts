// Praeventio Guard — Fatigue Monitor client hook (1 mutator).

import type {
  WorkSession,
  FatigueAssessment,
} from '../services/fatigue/fatigueMonitor';
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

export interface AssessFatigueInput {
  workerUid: string;
  sessions: WorkSession[];
  now?: string;
}
export interface AssessFatigueResponse {
  assessment: FatigueAssessment;
}

export async function assessFatigueRemote(
  projectId: string,
  input: AssessFatigueInput,
): Promise<AssessFatigueResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/fatigue/assess`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AssessFatigueResponse>(res);
}
