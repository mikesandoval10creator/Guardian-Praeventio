// Praeventio Guard — §74-78 Emergency Brigade hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import type {
  BrigadeMember,
  BrigadeRole,
  EmergencyResource,
  BrigadeCoverageReport,
  ResourceReadinessReport,
} from '../services/emergencyBrigade/emergencyBrigadeService';

export interface EmergencyBrigadeSnapshotResponse {
  members: (BrigadeMember & { id: string })[];
  resources: EmergencyResource[];
  brigade: BrigadeCoverageReport;
  resourceReadiness: ResourceReadinessReport;
  readinessLevel: 'green' | 'amber' | 'rose';
}

export function useEmergencyBrigade(projectId: string | null) {
  return useEndpoint<EmergencyBrigadeSnapshotResponse>(
    projectId ? `/api/sprint-k/${projectId}/emergency-brigade` : null,
  );
}

export interface AddBrigadeMemberPayload {
  workerUid: string;
  role: BrigadeRole;
  trainedAt: string;
  trainingValidYears?: number;
  active?: boolean;
}

export async function addBrigadeMember(
  projectId: string,
  payload: AddBrigadeMemberPayload,
): Promise<{ ok: true; id: string }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/emergency-brigade/members`,
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
  return (await res.json()) as { ok: true; id: string };
}

export interface AddBrigadeResourcePayload {
  kind: EmergencyResource['kind'];
  location: string;
  lastInspectedAt: string;
  nextExpirationAt: string;
  operational?: boolean;
}

export async function addBrigadeResource(
  projectId: string,
  payload: AddBrigadeResourcePayload,
): Promise<{ ok: true; id: string }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/emergency-brigade/resources`,
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
  return (await res.json()) as { ok: true; id: string };
}

export interface InspectResourcePayload {
  inspectedAt: string;
  operational: boolean;
  nextExpirationAt?: string;
  notes?: string;
}

export async function inspectResource(
  projectId: string,
  resourceId: string,
  payload: InspectResourcePayload,
): Promise<{ ok: true; inspectionId: string }> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/emergency-brigade/resources/${resourceId}/inspect`,
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
  return (await res.json()) as { ok: true; inspectionId: string };
}
