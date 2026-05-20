// Praeventio Guard — Plan 3.12: client hook for the risk-ranking surface.
//
// Mirrors `useReadReceipts.ts` (auth + JSON envelope), with the read-heavy
// cache pattern from `useControlComparator.ts` (AbortController per fetch +
// refetchKey for manual refresh).
//
// Endpoint base: /api/risk-ranking/:projectId/*
// Wired in server.ts (caller integrates the mount).

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type {
  RiskRecord,
  ControlWeakness,
} from '../services/riskRanking/riskRankingEngine';

// ────────────────────────────────────────────────────────────────────────
// Authed fetch
// ────────────────────────────────────────────────────────────────────────

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
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(body.message ?? body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ────────────────────────────────────────────────────────────────────────
// Shared fetch-state hook
// ────────────────────────────────────────────────────────────────────────

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function useEndpoint<T>(
  path: string | null,
): FetchState<T> & { refetch: () => void } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: Boolean(path),
    error: null,
  });
  const [refetchKey, setRefetchKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const ctl = new AbortController();
    controllerRef.current = ctl;

    (async () => {
      try {
        const res = await authedFetch(path, { signal: ctl.signal });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `http_${res.status}`);
        }
        const j = (await res.json()) as T;
        if (!ctl.signal.aborted) {
          setState({ data: j, loading: false, error: null });
        }
      } catch (err) {
        if (ctl.signal.aborted) return;
        setState({ data: null, loading: false, error: err as Error });
      }
    })();

    return () => ctl.abort();
  }, [path, refetchKey]);

  const refetch = useCallback(() => setRefetchKey((k) => k + 1), []);
  return { ...state, refetch };
}

// ────────────────────────────────────────────────────────────────────────
// 1. Top risks
// ────────────────────────────────────────────────────────────────────────

export interface RankedRisk extends RiskRecord {
  score: number;
}

export interface TopRisksResponse {
  topRisks: RankedRisk[];
  computedAt: string;
  cached?: boolean;
}

export function useTopRisks(projectId: string | null, n: number = 10) {
  return useEndpoint<TopRisksResponse>(
    projectId ? `/api/risk-ranking/${projectId}/top?n=${n}` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// 2. Weak controls
// ────────────────────────────────────────────────────────────────────────

export interface WeakControlsResponse {
  weakControls: ControlWeakness[];
  computedAt: string;
  cached?: boolean;
}

export function useWeakControls(projectId: string | null, n: number = 10) {
  return useEndpoint<WeakControlsResponse>(
    projectId ? `/api/risk-ranking/${projectId}/weak-controls?n=${n}` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// 3. Timeseries
// ────────────────────────────────────────────────────────────────────────

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  count: number;
  critical: number;
}

export interface TimeseriesResponse {
  series: TimeseriesPoint[];
  computedAt: string;
  cached?: boolean;
}

export function useRiskTimeseries(
  projectId: string | null,
  days: number = 30,
) {
  return useEndpoint<TimeseriesResponse>(
    projectId ? `/api/risk-ranking/${projectId}/timeseries?days=${days}` : null,
  );
}

// ────────────────────────────────────────────────────────────────────────
// 4. Recompute (admin)
// ────────────────────────────────────────────────────────────────────────

export interface RecomputeResponse {
  ok: true;
  dropped: number;
  recomputedAt: string;
}

export async function recomputeRiskRanking(
  projectId: string,
): Promise<RecomputeResponse> {
  const res = await authedFetch(
    `/api/risk-ranking/${projectId}/recompute`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return json<RecomputeResponse>(res);
}
