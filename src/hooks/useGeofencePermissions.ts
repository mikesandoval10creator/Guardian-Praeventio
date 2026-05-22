// Praeventio Guard — Geofence Permission UX client hook (1 stateless mutator).

import type {
  BackgroundGeoPermState,
  GeoPermState,
  PermissionUXDecision,
  Platform,
} from '../services/geofence/permissionUXDecision';
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

export interface DecidePermissionUXInput {
  platform: Platform;
  foregroundState: GeoPermState;
  backgroundState: BackgroundGeoPermState;
  inCriticalZone?: boolean;
  userOptedOutForever?: boolean;
}

export interface DecidePermissionUXResponse {
  decision: PermissionUXDecision;
}

export async function decideGeofencePermissionUX(
  projectId: string,
  input: DecidePermissionUXInput,
): Promise<DecidePermissionUXResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/geofence-permissions/decide-ux`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as DecidePermissionUXResponse;
}
