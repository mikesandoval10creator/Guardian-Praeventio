// Praeventio Guard — §195-200 PDCA + Non-Conformities hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

export type PdcaStage = 'plan' | 'do' | 'check' | 'act';
export type PdcaOrigin = 'audit' | 'incident' | 'finding' | 'inspection';

export interface PdcaEntry {
  kind: PdcaStage;
  activityId: string;
  notes: string;
  ownerUid: string;
  startedAt: string;
  completedAt?: string;
  evidence?: string[];
  efficacyScore?: number;
}

export interface PdcaCycleRecord {
  id: string;
  currentStage: PdcaStage;
  stages: PdcaEntry[];
  cycleNumber: number;
  nonConformityId?: string;
  origin?: PdcaOrigin;
  ownerUid?: string;
  createdAt?: string;
  createdByUid?: string;
}

export interface PdcaNonConformityRecord {
  id: string;
  category: string;
  severity: 'minor' | 'major' | 'critical';
  description: string;
  location: string;
  detectedAt: string;
  taskId?: string;
  responsibleUid: string;
  status:
    | 'open'
    | 'in_progress'
    | 'closed'
    | 'verified_effective'
    | 'reoccurred';
  correctiveActionId?: string;
  closedAt?: string;
  verifiedEffectiveAt?: string;
  reoccurredAt?: string;
}

export interface PdcaSummaryResponse {
  summary: {
    total: number;
    byPhase: Record<PdcaStage, number>;
    closedCycles: number;
    closureRate: number;
  };
}

export interface PdcaCyclesResponse {
  cycles: PdcaCycleRecord[];
}

export interface PdcaNonConformitiesResponse {
  nonConformities: PdcaNonConformityRecord[];
}

export function usePdcaCycles(projectId: string | null) {
  return useEndpoint<PdcaCyclesResponse>(
    projectId ? `/api/sprint-k/${projectId}/pdca/cycles` : null,
  );
}

export function usePdcaSummary(projectId: string | null) {
  return useEndpoint<PdcaSummaryResponse>(
    projectId ? `/api/sprint-k/${projectId}/pdca/summary` : null,
  );
}

export function usePdcaNonConformities(projectId: string | null) {
  return useEndpoint<PdcaNonConformitiesResponse>(
    projectId
      ? `/api/sprint-k/${projectId}/pdca/non-conformities`
      : null,
  );
}

export interface PdcaCreatePayload {
  id: string;
  nonConformityId: string;
  origin: PdcaOrigin;
  ownerUid: string;
  notes?: string;
  startedAt?: string;
}

export async function createPdcaCycle(
  projectId: string,
  payload: PdcaCreatePayload,
): Promise<PdcaCycleRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/pdca/cycles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as { ok: true; cycle: PdcaCycleRecord };
  return json.cycle;
}

export interface PdcaAdvancePayload {
  evidence: string[];
  notes?: string;
  efficacyScore?: number;
}

export async function advancePdcaPhase(
  projectId: string,
  cycleId: string,
  payload: PdcaAdvancePayload,
): Promise<PdcaCycleRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/pdca/cycles/${cycleId}/advance`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
    };
    throw new Error(body.reason ?? body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as { ok: true; cycle: PdcaCycleRecord };
  return json.cycle;
}

export interface PdcaNonConformityPayload {
  id: string;
  category: string;
  severity: 'minor' | 'major' | 'critical';
  description: string;
  location: string;
  detectedAt?: string;
  taskId?: string;
  responsibleUid: string;
}

export async function createPdcaNonConformity(
  projectId: string,
  payload: PdcaNonConformityPayload,
): Promise<PdcaNonConformityRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/pdca/non-conformities`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as {
    ok: true;
    nonConformity: PdcaNonConformityRecord;
  };
  return json.nonConformity;
}
