// Praeventio Guard — Wire UI #78 client hook for the evidence chain-of-custody.
//
// Wraps `GET /api/sprint-k/:projectId/evidence-by-node/:nodeId` so React
// components can render the REAL custody chains (artifact + append-only event
// trail + summary) linked to a graph node — typically an incident under
// investigation. The server resolves the tenant + project membership from the
// verified token; this hook only carries the node id (the incident id).
//
// No fabrication: the endpoint returns the persisted artifacts (an empty
// `chains` array when the incident has no evidence registered yet), so the
// consumer can show an honest empty-state instead of inventing data.

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  EvidenceArtifact,
  CustodyEvent,
  ChainSummary,
} from '../services/evidenceChain/custodyChainService';
import { apiAuthHeader } from '../lib/apiAuth';

/** One artifact and its full custody chain, as returned by the server. */
export interface CustodyChainEntry {
  artifact: EvidenceArtifact;
  events: CustodyEvent[];
  summary: ChainSummary;
}

export interface CustodyChainByNodeResponse {
  chains: CustodyChainEntry[];
}

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const authHeader = await apiAuthHeader();
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
}

/**
 * Fetch every custody chain linked to `nodeId` within `projectId`. Returns a
 * stable `{ data, loading, error, refetch }` tuple. When `projectId` or
 * `nodeId` is null the hook stays idle (no request, no error).
 */
export function useCustodyChainByNode(
  projectId: string | null,
  nodeId: string | null,
): FetchState<CustodyChainByNodeResponse> & { refetch: () => void } {
  const path =
    projectId && nodeId
      ? `/api/sprint-k/${projectId}/evidence-by-node/${encodeURIComponent(nodeId)}`
      : null;

  const [state, setState] = useState<FetchState<CustodyChainByNodeResponse>>({
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
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `http_${res.status}`);
        }
        const json = (await res.json()) as CustodyChainByNodeResponse;
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
