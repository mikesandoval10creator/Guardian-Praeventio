// Praeventio Guard — SPI (Safety Performance Index) plan-vs-executed client hook.
//
// Talks to the REAL endpoints on safetyPerformance.ts:
//   POST /api/sprint-k/:projectId/safety-performance/safety-plan
//   GET  /api/sprint-k/:projectId/safety-performance/spi-report?period=YYYY-MM

import { useCallback, useEffect, useState } from 'react';
import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  SafetyPerformanceReport,
  LeadingIndicators,
  LaggingIndicators,
} from '../services/safetyPerformance/safetyPerformanceIndex';

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
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

export interface CaptureSafetyPlanInput {
  period: string;
  plannedInspections: number;
  plannedDailyTalks: number;
  plannedTrainings: number;
}

export interface CaptureSafetyPlanResponse {
  saved: true;
  period: string;
  plannedInspections: number;
  plannedDailyTalks: number;
  plannedTrainings: number;
}

export async function captureSafetyPlan(
  projectId: string,
  input: CaptureSafetyPlanInput,
): Promise<CaptureSafetyPlanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-performance/safety-plan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CaptureSafetyPlanResponse>(res);
}

export interface PlanRatioPair {
  executed: number;
  planned: number;
}

export interface SpiReportResponse {
  period: string;
  report: SafetyPerformanceReport;
  leading: LeadingIndicators;
  lagging: LaggingIndicators;
  honesty: {
    preTaskChecklistCompletion: boolean;
    dailyTalksDeliveryRate: boolean;
    trainingCurrencyRate: boolean;
    plannedInspectionsRate: boolean;
    nearMissReportingRate: boolean;
    positiveObservationsRate: boolean;
    laggingEmpty: boolean;
  };
  ratios: {
    dailyTalks: PlanRatioPair;
    trainings: PlanRatioPair;
    inspections: PlanRatioPair;
  };
  plan: {
    plannedInspections: number;
    plannedDailyTalks: number;
    plannedTrainings: number;
  } | null;
  exposure: { totalHoursWorked: number };
}

export async function fetchSpiReport(
  projectId: string,
  period: string,
): Promise<SpiReportResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-performance/spi-report?period=${encodeURIComponent(period)}`,
    { method: 'GET' },
  );
  return json<SpiReportResponse>(res);
}

export interface UseSpiReport {
  data: SpiReportResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSpiReport(projectId: string | null, period: string): UseSpiReport {
  const [data, setData] = useState<SpiReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId || !period) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSpiReport(projectId, period)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, period, nonce]);

  return { data, loading, error, refetch };
}
