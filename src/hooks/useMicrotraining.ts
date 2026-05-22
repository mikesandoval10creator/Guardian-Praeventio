// Praeventio Guard — F.22 Lightning Training client hook.
//
// Three surfaces:
//   1. `useMicrotrainingCatalog(projectId)` — static catalog read
//   2. `useMicrotrainingRecommendation(projectId, workerUid, risks)` — selector
//   3. `submitMicrotrainingSession(projectId, session)` — persist completed run
//   4. `useMicrotrainingCerts(projectId, workerUid)` — list earned certs

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  MicroTrainingModule,
  MicroTrainingSession,
  RiskCategory,
} from '../services/microtraining/lightningTrainingService';
import type { StoredMicroTrainingCert } from '../services/microtraining/microtrainingFirestoreAdapter';
import { apiAuthHeaders } from '../lib/apiAuth';

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

export interface MicrotrainingCatalogResponse {
  modules: MicroTrainingModule[];
  passThreshold: number;
}

export function useMicrotrainingCatalog(projectId: string | null) {
  return useEndpoint<MicrotrainingCatalogResponse>(
    projectId ? `/api/sprint-k/${projectId}/microtraining/catalog` : null,
  );
}

export interface MicrotrainingRecommendResponse {
  module: MicroTrainingModule | null;
  certifiedModuleIds?: string[];
  reason?: string;
}

export function useMicrotrainingRecommendation(
  projectId: string | null,
  workerUid: string | null,
  detectedRisks: RiskCategory[],
) {
  // Stabilize the risks query string so the effect doesn't loop when the
  // caller passes a new array reference each render.
  const risksKey = detectedRisks.slice().sort().join(',');
  let path: string | null = null;
  if (projectId && workerUid && risksKey.length > 0) {
    const qs = new URLSearchParams({
      workerUid,
      risks: risksKey,
    });
    path = `/api/sprint-k/${projectId}/microtraining/recommend?${qs.toString()}`;
  }
  return useEndpoint<MicrotrainingRecommendResponse>(path);
}

export interface MicrotrainingSessionResponse {
  sessionId: string;
  score: number;
  certified: boolean;
  passThreshold: number;
}

export async function submitMicrotrainingSession(
  projectId: string,
  session: MicroTrainingSession,
): Promise<MicrotrainingSessionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/microtraining/session`,
    { method: 'POST', body: JSON.stringify(session) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as MicrotrainingSessionResponse;
}

export interface MicrotrainingCertsResponse {
  certs: StoredMicroTrainingCert[];
}

export function useMicrotrainingCerts(
  projectId: string | null,
  workerUid: string | null,
) {
  let path: string | null = null;
  if (projectId && workerUid) {
    const qs = new URLSearchParams({ workerUid });
    path = `/api/sprint-k/${projectId}/microtraining/certs?${qs.toString()}`;
  }
  return useEndpoint<MicrotrainingCertsResponse>(path);
}
