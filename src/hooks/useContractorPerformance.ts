// Praeventio Guard — Contractor man-hours capture + per-contractor TRIR/LTIFR.
//
// Client hook over the STATEFUL contractor endpoints in
// src/server/routes/contractors.ts. Mirrors useSafetyMetrics: capture the real
// man-hours worked per contractor, then read the per-contractor safety report
// (counts derived from REAL incidents carrying a `contractorId` + captured
// exposure). Honest empty-state: no captured hours → empty roster.

import { useCallback, useEffect, useState } from 'react';
import { apiAuthHeaders } from '../lib/apiAuth';
import type { IncidentCounts, SafetyMetricsReport } from '../services/safetyMetrics/osha';

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

// ── capture contractor man-hours ────────────────────────────────────────

export interface CaptureContractorExposureInput {
  contractorId: string;
  contractorName: string;
  /** Reporting period as 'YYYY-MM'. */
  period: string;
  totalHoursWorked: number;
}
export interface CaptureContractorExposureResponse {
  saved: true;
  contractorId: string;
  period: string;
  totalHoursWorked: number;
}

export async function captureContractorExposure(
  projectId: string,
  input: CaptureContractorExposureInput,
): Promise<CaptureContractorExposureResponse> {
  const res = await authedFetch(`/api/sprint-k/${projectId}/contractors/exposure`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return json<CaptureContractorExposureResponse>(res);
}

// ── per-contractor performance report ───────────────────────────────────

/** One row of the contractor-performance dashboard (per-contractor TRIR/LTIFR). */
export interface ContractorPerformanceRow {
  contractorId: string;
  contractorName: string;
  totalHoursWorked: number;
  counts: IncidentCounts;
  report: SafetyMetricsReport;
}

export interface ContractorPerformanceResponse {
  period: string;
  contractors: ContractorPerformanceRow[];
}

export async function fetchContractorPerformance(
  projectId: string,
  period: string,
): Promise<ContractorPerformanceResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/contractors/performance?period=${encodeURIComponent(period)}`,
    { method: 'GET' },
  );
  return json<ContractorPerformanceResponse>(res);
}

export interface UseContractorPerformance {
  data: ContractorPerformanceResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch the per-contractor safety performance (counts from REAL incidents +
 * captured contractor man-hours) for a project + period. Re-fetches when
 * either changes or when `refetch()` is called (e.g. after a new capture).
 */
export function useContractorPerformance(
  projectId: string | null,
  period: string,
): UseContractorPerformance {
  const [data, setData] = useState<ContractorPerformanceResponse | null>(null);
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
    fetchContractorPerformance(projectId, period)
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
