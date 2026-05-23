// Praeventio Guard — F.20 Drills Manager hooks.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';
import { apiAuthHeader } from '../lib/apiAuth';

export type DrillKindAPI =
  | 'evacuation'
  | 'fire'
  | 'spill_chemical'
  | 'first_aid'
  | 'rescue_confined'
  | 'rescue_height'
  | 'gas_leak'
  | 'earthquake';

export type DrillStatusAPI =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type DrillLevelAPI =
  | 'excellent'
  | 'good'
  | 'needs_improvement'
  | 'critical'
  | 'insufficient_baseline';

export interface DrillRecord {
  id: string;
  kind: DrillKindAPI;
  scheduledAt: string;
  responsibleUid: string;
  status: DrillStatusAPI;
  title?: string;
  location?: string;
  expectedCount?: number;
  benchmarkSeconds?: number;
  createdAt: string;
  createdBy: string;
  executedAt?: string;
  participantCount?: number;
  responseTimeSeconds?: number;
  observedGaps?: string[];
  requiredExternal?: boolean;
  notes?: string;
  report?: {
    participationRate: number | null;
    speedDeficitPercent: number | null;
    level: DrillLevelAPI;
    recommendations: string[];
  };
}

export interface DrillsResponse {
  drills: DrillRecord[];
}

export interface DrillResponse {
  drill: DrillRecord;
}

export function useDrills(
  projectId: string | null,
  opts: { status?: DrillStatusAPI; kind?: DrillKindAPI } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.kind) qs.set('kind', opts.kind);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/drills${query ? `?${query}` : ''}`;
  }
  return useEndpoint<DrillsResponse>(path);
}

export function useDrill(
  projectId: string | null,
  drillId: string | null,
) {
  return useEndpoint<DrillResponse>(
    projectId && drillId
      ? `/api/sprint-k/${projectId}/drills/${drillId}`
      : null,
  );
}

export interface DrillPlanPayload {
  id: string;
  kind: DrillKindAPI;
  scheduledAt: string;
  responsibleUid: string;
  title?: string;
  location?: string;
  expectedCount?: number;
  benchmarkSeconds?: number;
}

export async function planDrill(
  projectId: string,
  payload: DrillPlanPayload,
): Promise<DrillRecord> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(`/api/sprint-k/${projectId}/drills/plan`, {
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
  const json = (await res.json()) as { ok: true; drill: DrillRecord };
  return json.drill;
}

export interface DrillExecutePayload {
  executedAt: string;
  participantCount: number;
  expectedCount?: number;
  responseTimeSeconds: number;
  benchmarkSeconds?: number;
  observedGaps?: string[];
  requiredExternal?: boolean;
  notes?: string;
}

export async function executeDrill(
  projectId: string,
  drillId: string,
  payload: DrillExecutePayload,
): Promise<DrillRecord> {
  // §2.20 (2026-05-23) — apiAuthHeader unified.
  const authHeader = await apiAuthHeader();
  const res = await fetch(
    `/api/sprint-k/${projectId}/drills/${drillId}/execute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  const json = (await res.json()) as { ok: true; drill: DrillRecord };
  return json.drill;
}
