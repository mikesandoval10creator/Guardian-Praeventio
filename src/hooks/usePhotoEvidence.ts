// Praeventio Guard — F.19 Photo Evidence client hook.
//
// Wraps the /api/sprint-k/:projectId/photo-evidence/* surface so React
// components can list evidence linked to a parent node (incident,
// inspection, audit, etc.) and submit new metadata after uploading bytes
// to Cloud Storage.

import { useState, useEffect, useCallback, useRef } from 'react';
import { storage, ref, uploadBytes, getDownloadURL } from '../services/firebase';
import type {
  EvidenceArtifact,
  EvidenceLinkage,
  LinkedNodeKind,
  PhotoEvidencePayload,
} from '../services/photoEvidence/photoEvidenceEngine';
import {
  buildArtifact,
  buildStoragePath,
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

export interface UploadPhotoEvidenceOptions {
  /** UID del capturador (del usuario autenticado). El server lo revalida. */
  capturedByUid: string;
  /** El server exige 1..10 vínculos: la evidencia debe pertenecer a un nodo. */
  linkages: EvidenceLinkage[];
  /** ISO-8601; por defecto ahora. */
  capturedAt?: string;
  capturedLocation?: { lat: number; lng: number };
  notes?: string;
}

export interface UploadedPhotoEvidence {
  artifact: EvidenceArtifact;
  storagePath: string;
  downloadUrl: string;
}

/** SHA-256 hex del contenido (content-addressing de la evidencia). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('sha256_unavailable_insecure_context');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Real PhotoEvidence uploader: hashes the file bytes, uploads them to the
 * project-scoped Storage path covered by `storage.rules`, and records the
 * metadata keyed by that hash. Before this, only metadata was persisted and
 * `buildStoragePath` had no caller — no bytes ever reached Storage.
 */
export async function uploadPhotoEvidenceBytes(
  projectId: string,
  file: File,
  options: UploadPhotoEvidenceOptions,
): Promise<UploadedPhotoEvidence> {
  if (!projectId) throw new Error('missing_project_id');
  const bytes = await file.arrayBuffer();
  const contentHash = await sha256Hex(bytes);
  // Reuse the engine's validation + canonical id so the client rejects
  // exactly what the server would reject BEFORE burning an upload.
  const artifact = buildArtifact({
    payload: {
      originalFilename: file.name,
      mimeType: file.type,
      byteSize: file.size,
      capturedAt: options.capturedAt ?? new Date().toISOString(),
      capturedLocation: options.capturedLocation,
      capturedByUid: options.capturedByUid,
      notes: options.notes,
    },
    contentHash,
    linkages: options.linkages,
  });
  // Match the server schema (1..10) before spending an upload on a request
  // that would be rejected with 400.
  if (!options.linkages || options.linkages.length < 1) {
    throw new Error('linkage_required');
  }
  const storagePath = buildStoragePath(artifact, projectId);
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: { contentHash },
  });
  const downloadUrl = await getDownloadURL(storageRef);
  const recorded = await recordPhotoEvidence(projectId, {
    contentHash,
    payload: {
      originalFilename: file.name,
      mimeType: file.type,
      byteSize: file.size,
      capturedAt: artifact.capturedAt,
      capturedLocation: options.capturedLocation,
      notes: options.notes,
    },
    linkages: options.linkages,
  });
  return { artifact: recorded.artifact, storagePath, downloadUrl };
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
