// Praeventio Guard — Safety Metrics OSHA + ICMM client hook (3 mutators).

import { auth } from '../services/firebase';
import type {
  IncidentCounts,
  ExposureInput,
  SafetyMetricsReport,
  BenchmarkComparison,
  IndustryBenchmark,
  TrendAnalysis,
} from '../services/safetyMetrics/osha';

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
