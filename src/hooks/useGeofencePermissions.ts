// Praeventio Guard — Geofence Permission UX client hook (1 stateless mutator).

import { auth } from '../services/firebase';
import type {
  BackgroundGeoPermState,
  GeoPermState,
  PermissionUXDecision,
  Platform,
} from '../services/geofence/permissionUXDecision';

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
