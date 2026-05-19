// Praeventio Guard — Climate-Aware Scheduling client hook (2 mutators).

import { auth } from '../services/firebase';
import type {
  WeatherConditions,
  ScheduledTask,
  TaskWeatherAssessment,
} from '../services/climateAwareScheduling/climateAwareScheduling';

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

// ── 1. assess-task ─────────────────────────────────────────────────────

export interface AssessTaskInput {
  task: ScheduledTask;
  weather: WeatherConditions;
}
export interface AssessTaskResponse {
  assessment: TaskWeatherAssessment;
}

export async function assessTaskWeatherRemote(
  projectId: string,
  input: AssessTaskInput,
): Promise<AssessTaskResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/climate-scheduling/assess-task`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AssessTaskResponse>(res);
}

// ── 2. build-daily-plan ────────────────────────────────────────────────

export interface BuildDailyPlanInput {
  tasks: ScheduledTask[];
  weather: WeatherConditions;
}
export interface BuildDailyPlanResponse {
  plan: {
    proceed: number;
    addControls: number;
    reschedule: number;
    suspend: number;
    assessments: TaskWeatherAssessment[];
  };
}

export async function buildClimateAwareDailyPlan(
  projectId: string,
  input: BuildDailyPlanInput,
): Promise<BuildDailyPlanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/climate-scheduling/build-daily-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildDailyPlanResponse>(res);
}
