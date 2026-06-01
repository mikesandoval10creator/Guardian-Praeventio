// Praeventio Guard — Predictive Alerts client hook (2 mutators).
//
// El engine necesita un `ForecastFn` (closure) que sobre la red se
// representa como `forecastValues[i]` con la lectura prevista en `i+1`
// minutos. El server reconstruye la closure.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  PredictiveContext,
  WindowedDecision,
} from '../services/predictiveAlerts/windowedTrigger';
import type { ScheduledAlert } from '../services/predictiveAlerts/alertScheduler';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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

// ── 1. should-fire-windowed ────────────────────────────────────────────

export interface ShouldFireWindowedInput {
  ctx: PredictiveContext;
  forecastValues: number[];
  options?: {
    windowMinutes?: number;
    minLeadTimeMin?: number;
    recommendedAction?: string;
  };
}
export interface ShouldFireWindowedResponse {
  decision: WindowedDecision;
}

export async function shouldFireWindowedApi(
  projectId: string,
  input: ShouldFireWindowedInput,
): Promise<ShouldFireWindowedResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/predictive-alerts/should-fire-windowed`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ShouldFireWindowedResponse>(res);
}

// ── 2. evaluate-probes ─────────────────────────────────────────────────

export interface ProbeWithForecastValues {
  id: string;
  threshold: number;
  currentValue: number;
  forecastValues: number[];
}

export interface EvaluateProbesInput {
  probes: ProbeWithForecastValues[];
  windowMinutes?: number;
  minLeadTimeMin?: number;
}
export interface EvaluateProbesResponse {
  alerts: ScheduledAlert[];
}

export async function evaluatePredictiveProbesApi(
  projectId: string,
  input: EvaluateProbesInput,
): Promise<EvaluateProbesResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/predictive-alerts/evaluate-probes`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EvaluateProbesResponse>(res);
}
