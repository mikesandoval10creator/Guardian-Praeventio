// Praeventio Guard — F.23 Document Versioning client hook.
//
// Wraps the /api/sprint-k/:projectId/documents/:documentId/* surface so
// React components can list a chain, read the active version, draft new
// versions, and transition status (in_review → approved → superseded).

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth } from '../services/firebase';
import type {
  BumpKind,
  ChangelogEntry,
  DocumentVersion,
  VersionChain,
  VersionStatus,
} from '../services/documents/documentVersioning';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

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

export interface DocumentChainResponse {
  chain: VersionChain | null;
}

export function useDocumentChain(
  projectId: string | null,
  documentId: string | null,
) {
  return useEndpoint<DocumentChainResponse>(
    projectId && documentId
      ? `/api/sprint-k/${projectId}/documents/${encodeURIComponent(documentId)}/chain`
      : null,
  );
}

export interface DocumentActiveResponse {
  active: DocumentVersion | null;
  latest: DocumentVersion | null;
}

export function useDocumentActiveVersion(
  projectId: string | null,
  documentId: string | null,
) {
  return useEndpoint<DocumentActiveResponse>(
    projectId && documentId
      ? `/api/sprint-k/${projectId}/documents/${encodeURIComponent(documentId)}/active`
      : null,
  );
}

export interface DocumentChangelogResponse {
  changelog: ChangelogEntry[];
}

export function useDocumentChangelog(
  projectId: string | null,
  documentId: string | null,
) {
  return useEndpoint<DocumentChangelogResponse>(
    projectId && documentId
      ? `/api/sprint-k/${projectId}/documents/${encodeURIComponent(documentId)}/changelog`
      : null,
  );
}

export interface CreateVersionPayload {
  newContent: string;
  newContentHash: string;
  bumpKind: BumpKind;
  changeNotes?: string;
}

export interface CreateVersionResponse {
  version: DocumentVersion;
}

export async function createDocumentVersion(
  projectId: string,
  documentId: string,
  payload: CreateVersionPayload,
): Promise<CreateVersionResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/documents/${encodeURIComponent(documentId)}/versions`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as CreateVersionResponse;
}

export interface SetStatusPayload {
  status: VersionStatus;
  approverUid?: string;
  supersededByVersionId?: string;
}

export async function setDocumentVersionStatus(
  projectId: string,
  documentId: string,
  versionId: string,
  payload: SetStatusPayload,
): Promise<void> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/status`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
}
