// Praeventio Guard — Evacuation headcount client hook (4 mutators).

import { auth } from '../services/firebase';
import type {
  EvacuationDrill,
  EvacuationStatus,
  EvacuationPostmortem,
} from '../services/evacuation/evacuationHeadcount';

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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as T;
}

// ── 1. compute-status ──────────────────────────────────────────────────

export interface ComputeStatusInput {
  drill: EvacuationDrill;
  now?: string;
}
export interface ComputeStatusResponse {
  status: EvacuationStatus;
}

export async function computeEvacuationStatus(
  projectId: string,
  input: ComputeStatusInput,
): Promise<ComputeStatusResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/evacuation/compute-status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<ComputeStatusResponse>(res);
}

// ── 2. record-scan (scannedByUid forced server-side) ───────────────────

export interface RecordEvacuationScanInput {
  drill: EvacuationDrill;
  scan: {
    workerUid: string;
    meetingPointId: string;
    scannedAt?: string;
  };
}
export interface RecordEvacuationScanResponse {
  drill: EvacuationDrill;
}

export async function recordEvacuationScan(
  projectId: string,
  input: RecordEvacuationScanInput,
): Promise<RecordEvacuationScanResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/evacuation/record-scan`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<RecordEvacuationScanResponse>(res);
}

// ── 3. end-drill ───────────────────────────────────────────────────────

export interface EndEvacuationDrillInput {
  drill: EvacuationDrill;
  endedAt?: string;
}
export interface EndEvacuationDrillResponse {
  drill: EvacuationDrill;
}

export async function endEvacuationDrill(
  projectId: string,
  input: EndEvacuationDrillInput,
): Promise<EndEvacuationDrillResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/evacuation/end-drill`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<EndEvacuationDrillResponse>(res);
}

// ── 4. build-postmortem ────────────────────────────────────────────────

export interface BuildPostmortemInput {
  drill: EvacuationDrill;
}
export interface BuildPostmortemResponse {
  postmortem: EvacuationPostmortem;
}

export async function buildEvacuationPostmortem(
  projectId: string,
  input: BuildPostmortemInput,
): Promise<BuildPostmortemResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/evacuation/build-postmortem`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<BuildPostmortemResponse>(res);
}
