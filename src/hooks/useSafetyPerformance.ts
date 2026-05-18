// Praeventio Guard — Safety Performance Index client hook (2 mutators).

import { auth } from '../services/firebase';
import type {
  LeadingIndicators,
  LaggingIndicators,
  SafetyPerformanceReport,
  SpiPeriodPoint,
  SpiTrendReport,
} from '../services/safetyPerformance/safetyPerformanceIndex';

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

// ── 1. compute ─────────────────────────────────────────────────────────

export interface ComputeSpiInput {
  leading: LeadingIndicators;
  lagging: LaggingIndicators;
}
export interface ComputeSpiResponse {
  report: SafetyPerformanceReport;
}

export async function computeSafetyPerformanceRemote(
  projectId: string,
  input: ComputeSpiInput,
): Promise<ComputeSpiResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-performance/compute`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeSpiResponse>(res);
}

// ── 2. build-trend ─────────────────────────────────────────────────────

export interface BuildSpiTrendInput {
  points: SpiPeriodPoint[];
}
export interface BuildSpiTrendResponse {
  trend: SpiTrendReport;
}

export async function buildSpiTrendRemote(
  projectId: string,
  input: BuildSpiTrendInput,
): Promise<BuildSpiTrendResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-performance/build-trend`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildSpiTrendResponse>(res);
}
