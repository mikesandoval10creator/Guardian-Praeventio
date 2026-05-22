// Praeventio Guard — Portable worker history client hook (3 mutators).

import type {
  WorkerData,
  PortableWorkerHistory,
  RedactionLevel,
  SerializedExport,
} from '../services/workerHistory/portableHistoryExporter';
import { apiAuthHeaders } from '../lib/apiAuth';

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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. build-portable (uid forced server-side) ─────────────────────────

export interface BuildPortableWireInput {
  worker: WorkerData;
  options: {
    includeMedical?: boolean;
    redactionLevel: RedactionLevel;
    exportedAt: string;
    requestedBy: {
      role: 'self' | 'employer' | 'physician' | 'inspector';
    };
  };
}
export interface BuildPortableResponse { history: PortableWorkerHistory }

export async function buildPortableWorkerHistory(
  projectId: string,
  input: BuildPortableWireInput,
): Promise<BuildPortableResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/worker-history/build-portable`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildPortableResponse>(res);
}

// ── 2. redact-pii ──────────────────────────────────────────────────────

export interface RedactInput {
  history: PortableWorkerHistory;
  level: RedactionLevel;
}
export interface RedactResponse { history: PortableWorkerHistory }

export async function redactWorkerHistoryPII(
  projectId: string,
  input: RedactInput,
): Promise<RedactResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/worker-history/redact-pii`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RedactResponse>(res);
}

// ── 3. serialize ───────────────────────────────────────────────────────

export interface SerializeInput {
  history: PortableWorkerHistory;
  format: 'json' | 'markdown';
}
export interface SerializeResponse { export: SerializedExport }

export async function serializeWorkerHistory(
  projectId: string,
  input: SerializeInput,
): Promise<SerializeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/worker-history/serialize`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<SerializeResponse>(res);
}
