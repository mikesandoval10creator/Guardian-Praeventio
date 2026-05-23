// Praeventio Guard — F.30 Aggregate Telemetry client hook.

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type {
  AggregatedFeed,
  AggregationWindow,
  KindVelocity,
  TenantRollup,
} from '../services/telemetry/aggregator';
import { apiAuthHeader } from '../lib/apiAuth';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(
  path: string,
  signal: AbortSignal,
): Promise<Response> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  return fetch(path, {
    signal,
    headers: authHeader ? { Authorization: authHeader } : undefined,
  });
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
        const res = await authedFetch(path, ctl.signal);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `http_${res.status}`);
        }
        const json = (await res.json()) as T;
        if (!ctl.signal.aborted) {
          setState({ data: json, loading: false, error: null });
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

export interface AggregateTelemetryResponse {
  feed: AggregatedFeed;
  velocities: KindVelocity[];
}

export function useAggregateTelemetry(
  projectId: string | null,
  window: AggregationWindow = '7d',
) {
  const path = projectId
    ? `/api/sprint-k/${projectId}/telemetry/aggregate?window=${window}`
    : null;
  return useEndpoint<AggregateTelemetryResponse>(path);
}

export interface TenantRollupResponse {
  rollup: TenantRollup;
}

export function useTenantTelemetryRollup(
  tenantId: string | null,
  projectIds: string[],
  window: AggregationWindow = '7d',
) {
  // Stabilize project order for the request URL so the effect doesn't
  // re-fetch when caller passes a new array reference each render.
  const stableProjects = projectIds.slice().sort().join(',');
  let path: string | null = null;
  if (tenantId && stableProjects.length > 0) {
    const qs = new URLSearchParams({
      window,
      projects: stableProjects,
    });
    path = `/api/sprint-k/tenants/${encodeURIComponent(tenantId)}/telemetry/rollup?${qs.toString()}`;
  }
  return useEndpoint<TenantRollupResponse>(path);
}
