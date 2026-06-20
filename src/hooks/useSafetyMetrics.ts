// Praeventio Guard — Safety Metrics OSHA + ICMM client hook.

import { useCallback, useEffect, useState } from 'react';
import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  IncidentCounts,
  ExposureInput,
  SafetyMetricsReport,
  BenchmarkComparison,
  IndustryBenchmark,
  TrendAnalysis,
} from '../services/safetyMetrics/osha';
import type {
  PressureSignals,
  PressureReport,
} from '../services/orgMetrics/organizationalMetrics';

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

// ── 1. build-report ────────────────────────────────────────────────────

export interface BuildSafetyMetricsReportInput {
  counts: IncidentCounts;
  exposure: ExposureInput;
  periodLabel?: string;
}
export interface BuildSafetyMetricsReportResponse {
  report: SafetyMetricsReport;
}

export async function buildSafetyMetricsReportApi(
  projectId: string,
  input: BuildSafetyMetricsReportInput,
): Promise<BuildSafetyMetricsReportResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-metrics/build-report`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildSafetyMetricsReportResponse>(res);
}

// ── 2. compare-vs-industry ─────────────────────────────────────────────

export interface CompareVsIndustryInput {
  metric: 'trir' | 'ltifr';
  value: number;
  industry: IndustryBenchmark;
}
export interface CompareVsIndustryResponse {
  comparison: BenchmarkComparison;
}

export async function compareSafetyMetricsVsIndustry(
  projectId: string,
  input: CompareVsIndustryInput,
): Promise<CompareVsIndustryResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-metrics/compare-vs-industry`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CompareVsIndustryResponse>(res);
}

// ── 3. analyze-trend ───────────────────────────────────────────────────

export interface AnalyzeSafetyMetricsTrendInput {
  current: SafetyMetricsReport;
  previous: SafetyMetricsReport;
  metricKey: TrendAnalysis['metricKey'];
}
export interface AnalyzeSafetyMetricsTrendResponse {
  trend: TrendAnalysis;
}

export async function analyzeSafetyMetricsTrend(
  projectId: string,
  input: AnalyzeSafetyMetricsTrendInput,
): Promise<AnalyzeSafetyMetricsTrendResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-metrics/analyze-trend`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AnalyzeSafetyMetricsTrendResponse>(res);
}

// ── 4. capture exposure (man-hours worked) ─────────────────────────────

export interface CaptureExposureInput {
  /** Reporting period as 'YYYY-MM'. */
  period: string;
  totalHoursWorked: number;
}
export interface CaptureExposureResponse {
  saved: true;
  period: string;
  totalHoursWorked: number;
}

export async function captureSafetyExposure(
  projectId: string,
  input: CaptureExposureInput,
): Promise<CaptureExposureResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-metrics/exposure`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CaptureExposureResponse>(res);
}

// ── 5. report (real incidents + captured exposure) ─────────────────────

export interface SafetyMetricsReportResponse {
  counts: IncidentCounts;
  exposure: ExposureInput;
  report: SafetyMetricsReport;
}

export async function fetchSafetyMetricsReport(
  projectId: string,
  period: string,
): Promise<SafetyMetricsReportResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/safety-metrics/report?period=${encodeURIComponent(period)}`,
    { method: 'GET' },
  );
  return json<SafetyMetricsReportResponse>(res);
}

export interface UseSafetyMetricsReport {
  data: SafetyMetricsReportResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── 6. operational pressure (workforce capture + engine aggregation) ────────

export interface CaptureWorkforcePeriodInput {
  /** Reporting period as 'YYYY-MM'. */
  period: string;
  /** Total person-days of absence across the workforce in the period. */
  absenteeismDays: number;
  /** Total overtime hours across the whole workforce in the period. */
  overtimeHours: number;
  /** Active workers (headcount) in the period. */
  headcount: number;
}
export interface CaptureWorkforcePeriodResponse {
  saved: true;
  period: string;
  absenteeismDays: number;
  overtimeHours: number;
  headcount: number;
}

export async function captureWorkforcePeriod(
  projectId: string,
  input: CaptureWorkforcePeriodInput,
): Promise<CaptureWorkforcePeriodResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/workforce-period`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<CaptureWorkforcePeriodResponse>(res);
}

export interface OperationalPressureResponse {
  captured: boolean;
  period: string;
  workforce?: { absenteeismDays: number; overtimeHours: number; headcount: number };
  signals: PressureSignals | null;
  report: PressureReport | null;
}

export async function fetchOperationalPressure(
  projectId: string,
  period: string,
): Promise<OperationalPressureResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/operational-pressure?period=${encodeURIComponent(period)}`,
    { method: 'GET' },
  );
  return json<OperationalPressureResponse>(res);
}

export interface UseOperationalPressure {
  data: OperationalPressureResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch the operational-pressure report (computed by the REAL
 * computeOperationalPressure engine from the captured workforce period) for a
 * project + period. Re-fetches on change or `refetch()` (e.g. after capturing).
 */
export function useOperationalPressure(
  projectId: string | null,
  period: string,
): UseOperationalPressure {
  const [data, setData] = useState<OperationalPressureResponse | null>(null);
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
    fetchOperationalPressure(projectId, period)
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

/**
 * Fetch the safety-metrics report (counts derived from REAL incidents +
 * captured man-hours) for a project + period. Re-fetches when either changes
 * or when `refetch()` is called (e.g. after capturing new exposure hours).
 */
export function useSafetyMetricsReport(
  projectId: string | null,
  period: string,
): UseSafetyMetricsReport {
  const [data, setData] = useState<SafetyMetricsReportResponse | null>(null);
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
    fetchSafetyMetricsReport(projectId, period)
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
