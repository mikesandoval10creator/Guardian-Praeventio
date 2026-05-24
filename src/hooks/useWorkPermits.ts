// Praeventio Guard — F.15 Work Permits hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type {
  WorkPermit,
  WorkPermitKind,
  WorkPermitStatus,
} from '../services/workPermits/workPermitEngine';
import { apiAuthHeader } from '../lib/apiAuth';

export interface WorkPermitsResponse {
  permits: WorkPermit[];
}

export function useWorkPermits(
  projectId: string | null,
  opts: { status?: WorkPermitStatus; kind?: WorkPermitKind } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.kind) qs.set('kind', opts.kind);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/work-permits${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<WorkPermitsResponse>(path);
}

export interface WorkPermitChecklistItemPayload {
  id: string;
  label: string;
  checked: boolean;
  verifiedAt?: string;
}

export interface WorkPermitCreatePayload {
  id: string;
  kind: WorkPermitKind;
  workerUid?: string;
  zoneId?: string;
  taskDescription: string;
  durationHours: number;
}

export interface WorkPermitSignPayload {
  workerHasTraining?: boolean;
  workerHasEpp?: boolean;
  workerMedicallyFit?: boolean;
  checkedLabels?: string[];
}

export async function createWorkPermit(
  projectId: string,
  payload: WorkPermitCreatePayload,
): Promise<{ permit: WorkPermit }> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(`/api/sprint-k/${projectId}/work-permits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { 'Authorization': authHeader } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { permit: WorkPermit };
}

export async function signWorkPermit(
  projectId: string,
  permitId: string,
  attestation?: WorkPermitSignPayload,
): Promise<{ permit: WorkPermit }> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/work-permits/${permitId}/sign`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify(attestation ?? {}),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { permit: WorkPermit };
}

export async function closeWorkPermit(
  projectId: string,
  permitId: string,
  reason: string,
  outcome: 'fulfill' | 'cancel' = 'fulfill',
): Promise<{ permit: WorkPermit }> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/work-permits/${permitId}/close`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify({ reason, outcome }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as { permit: WorkPermit };
}
