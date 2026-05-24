// Praeventio Guard — F.19 Photo Evidence client hook.
//
// Wraps the /api/sprint-k/:projectId/photo-evidence/* surface so React
// components can list evidence linked to a parent node (incident,
// inspection, audit, etc.) and submit new metadata after uploading bytes
// to Cloud Storage.

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type {
  EvidenceArtifact,
  EvidenceLinkage,
  LinkedNodeKind,
  PhotoEvidencePayload,
} from '../services/photoEvidence/photoEvidenceEngine';
import { apiAuthHeader } from '../lib/apiAuth';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(authHeader ? { 'Authorization': authHeader } : {}),
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

export interface PhotoEvidenceListResponse {
  artifacts: EvidenceArtifact[];
}

export function usePhotoEvidenceByNode(
  projectId: string | null,
  nodeKind: LinkedNodeKind | null,
  nodeId: string | null,
) {
  const path =
    projectId && nodeKind && nodeId
      ? `/api/sprint-k/${projectId}/photo-evidence/by-node/${nodeKind}/${encodeURIComponent(nodeId)}`
      : null;
  return useEndpoint<PhotoEvidenceListResponse>(path);
}

export interface RecordEvidencePayload {
  contentHash: string;
  payload: Omit<PhotoEvidencePayload, 'capturedByUid'>;
  linkages: EvidenceLinkage[];
}

export interface RecordEvidenceResponse {
  artifact: EvidenceArtifact;
}

export async function recordPhotoEvidence(
  projectId: string,
  body: RecordEvidencePayload,
): Promise<RecordEvidenceResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/photo-evidence`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    throw new Error(errBody.detail ?? errBody.error ?? `http_${res.status}`);
  }
  return (await res.json()) as RecordEvidenceResponse;
}

export async function linkPhotoEvidence(
  projectId: string,
  artifactId: string,
  linkage: EvidenceLinkage,
): Promise<void> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/photo-evidence/${artifactId}/linkage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(linkage),
    },
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error ?? `http_${res.status}`);
  }
}
