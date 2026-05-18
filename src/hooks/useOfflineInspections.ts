// Praeventio Guard — F.6 Offline Inspections hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint, type FetchState } from './_fetchUtils';

export type InspectionStatusAPI = 'in_progress' | 'completed';

export interface InspectionObservationRecord {
  observationId: string;
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  recordedAt: string;
  recordedBy: string;
}

export interface InspectionRecord {
  id: string;
  templateId: string;
  responsibleUid: string;
  status: InspectionStatusAPI;
  startedAt: string;
  startedBy: string;
  completedAt?: string;
  observations: InspectionObservationRecord[];
}

export interface InspectionsResponse {
  inspections: InspectionRecord[];
}

export interface InspectionResponse {
  inspection: InspectionRecord;
}

export function useInspections(
  projectId: string | null,
  opts: { status?: InspectionStatusAPI | 'all' } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/inspections${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<InspectionsResponse>(path);
}

export function useInspection(
  projectId: string | null,
  inspectionId: string | null,
) {
  const all = useInspections(projectId, { status: 'all' });
  const inspection =
    all.data?.inspections.find((i) => i.id === inspectionId) ?? null;
  return {
    data: inspection ? { inspection } : null,
    loading: all.loading,
    error: all.error,
    refetch: all.refetch,
  } as FetchState<InspectionResponse> & { refetch: () => void };
}

export interface InspectionStartPayload {
  id: string;
  templateId: string;
  responsibleUid: string;
  startedAt?: string;
}

export async function startInspection(
  projectId: string,
  payload: InspectionStartPayload,
): Promise<InspectionRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/inspections`, {
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
  const json = (await res.json()) as {
    ok: true;
    inspection: InspectionRecord;
  };
  return json.inspection;
}

export interface InspectionObservationPayload {
  observationId: string;
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  recordedAt?: string;
}

export async function addObservation(
  projectId: string,
  inspectionId: string,
  payload: InspectionObservationPayload,
): Promise<InspectionObservationRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/inspections/${inspectionId}/observations`,
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
    observation: InspectionObservationRecord;
  };
  return json.observation;
}

export async function completeInspection(
  projectId: string,
  inspectionId: string,
  completedAt?: string,
): Promise<InspectionRecord> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/inspections/${inspectionId}/complete`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(completedAt ? { completedAt } : {}),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as {
    ok: true;
    inspection: InspectionRecord;
  };
  return json.inspection;
}
