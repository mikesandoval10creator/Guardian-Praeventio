// Praeventio Guard — Control Comparator client hook (4 stateless mutators
// + 1 fetcher).

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ControlComparison,
  ControlHistoricalRecord,
} from '../services/controlComparator/controlComparator';
import type {
  FailureLibraryEntry,
  FailureMode,
} from '../services/controlComparator/controlFailureLibrary';
import { apiAuthHeaders } from '../lib/apiAuth';

type ControlKind = ControlHistoricalRecord['controlKind'];

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(
  path: string,
  init: RequestInit = {},

): Promise<Response> {
  // §2.20 migration (2026-05-21) — usa apiAuthHeaders() unificado:
  // prefiere E2E header en MODE=test, fallback a Bearer productivo.
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
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
        const res = await authedFetch(path, { signal: ctl.signal });
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

export interface CompareControlsResponse {
  comparison: ControlComparison;
}

export async function compareControls(
  projectId: string,
  controlA: ControlHistoricalRecord,
  controlB: ControlHistoricalRecord,
): Promise<CompareControlsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/controls/compare`,
    { method: 'POST', body: JSON.stringify({ controlA, controlB }) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as CompareControlsResponse;
}

export interface LookupFailurePatternsResponse {
  patterns: FailureLibraryEntry[];
}

export async function lookupFailurePatterns(
  projectId: string,
  controlKind: ControlKind,
  options: { industry?: string; symptom?: string } = {},
): Promise<LookupFailurePatternsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/controls/failures/lookup`,
    {
      method: 'POST',
      body: JSON.stringify({ controlKind, ...options }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as LookupFailurePatternsResponse;
}

export interface SuggestCorrectiveActionsResponse {
  actions: string[];
}

export async function suggestCorrectiveActions(
  projectId: string,
  failureMode: FailureMode,
  controlKind: ControlKind,
): Promise<SuggestCorrectiveActionsResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/controls/failures/suggest`,
    {
      method: 'POST',
      body: JSON.stringify({ failureMode, controlKind }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as SuggestCorrectiveActionsResponse;
}

export interface FailureLibrarySummaryResponse {
  summary: {
    totalEntries: number;
    byFailureMode: Record<string, number>;
    byControlKind: Record<string, number>;
    byFrequencyTier: Record<string, number>;
  };
}

export function useFailureLibrarySummary(projectId: string | null) {
  return useEndpoint<FailureLibrarySummaryResponse>(
    projectId ? `/api/sprint-k/${projectId}/controls/failures/summary` : null,
  );
}
