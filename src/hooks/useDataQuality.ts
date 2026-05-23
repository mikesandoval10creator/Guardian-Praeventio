// Praeventio Guard — F.9 Data Quality (pre-IA gap detector) hook.
//
// Hook fetch-based para `/api/sprint-k/:projectId/data-quality`.
// Migrado del monolito `useSprintK.ts` (2026-05-18).

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type {
  DataQualityReport,
  Gap as DataQualityGap,
} from '../services/dataQuality/incompletenessScanner';
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

export interface DataQualityResponse {
  report: DataQualityReport;
  topGaps: DataQualityGap[];
}

export function useDataQuality(projectId: string | null) {
  return useEndpoint<DataQualityResponse>(
    projectId ? `/api/sprint-k/${projectId}/data-quality` : null,
  );
}
