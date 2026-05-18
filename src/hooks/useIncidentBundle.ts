// Praeventio Guard — F.3 Incident Evidence Bundle hook.
//
// Hook fetch-based para `/api/sprint-k/:projectId/incidents/:incidentId/bundle`.
// Migrado del monolito `useSprintK.ts` (2026-05-18).

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type { IncidentBundleManifest } from '../services/incidentBundle/incidentEvidenceBundle';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(
  path: string,
  signal: AbortSignal,
): Promise<Response> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(path, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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

export interface IncidentBundleResponse {
  manifest: IncidentBundleManifest;
}

export function useIncidentBundle(
  projectId: string | null,
  incidentId: string | null,
) {
  return useEndpoint<IncidentBundleResponse>(
    projectId && incidentId
      ? `/api/sprint-k/${projectId}/incidents/${incidentId}/bundle`
      : null,
  );
}
