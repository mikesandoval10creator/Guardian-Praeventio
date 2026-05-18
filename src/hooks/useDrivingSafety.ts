// Praeventio Guard — §69-71 Driving Safety hooks + mutators.
//
// Migrados del monolito `useSprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation. El bloque original estaba corrupto (interleaved con
// §244-250 + F.29 por bad merges); esta versión reconstruye el contrato.

import { auth } from '../services/firebase';
import { useEndpoint } from './_fetchUtils';

export type DrivingRouteCriticality = 'low' | 'medium' | 'high' | 'extreme';
export type DrivingRouteHazard =
  | 'cliff'
  | 'rockfall'
  | 'flood_zone'
  | 'sharp_curves'
  | 'limited_visibility'
  | 'wildlife'
  | 'mining_traffic'
  | 'icy_surface'
  | 'fog'
  | 'debris'
  | 'accident_reported';
export type DrivingRouteAlertKind =
  | 'icy'
  | 'fog'
  | 'debris'
  | 'accident_reported'
  | 'weather'
  | 'other';
export type DrivingRoutesStatus = 'active' | 'critical' | 'all';

export interface DrivingRouteAlert {
  kind: DrivingRouteAlertKind;
  note: string | null;
  flaggedAt: string;
  flaggedBy: string;
  resolvedAt: string | null;
}

export interface DrivingRoute {
  id: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  criticality: DrivingRouteCriticality;
  hazards: DrivingRouteHazard[];
  weatherSensitive: boolean;
  recommendedMaxSpeedKmh: number;
  activeAlert: DrivingRouteAlert | null;
  alertHistory: DrivingRouteAlert[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface DrivingDriver {
  workerUid: string;
  licenseClass: string;
  licenseExpiresAt: string;
  yearsExperience: number;
  incidents12m: number;
  speedingEvents30d: number;
  fatigueScore: number;
  hoursThisWeek: number;
  lastJourneyAt: string | null;
  updatedAt: string;
}

export interface DrivingRankingEntry {
  workerUid: string;
  safetyScore: number;
  level: 'critical' | 'poor' | 'fair' | 'good' | 'excellent';
  canOperate: boolean;
  blockers: string[];
  fatigueScore: number;
  hoursThisWeek: number;
  licenseExpiresAt: string;
}

export interface DrivingRoutesResponse {
  routes: DrivingRoute[];
}
export interface DrivingDriversResponse {
  drivers: DrivingDriver[];
}
export interface DrivingRankingResponse {
  ranking: DrivingRankingEntry[];
}

export function useDrivingRoutes(
  projectId: string | null,
  opts: { status?: DrivingRoutesStatus } = {},
) {
  let path: string | null = null;
  if (projectId) {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    const query = qs.toString();
    path = `/api/sprint-k/${projectId}/driving/routes${
      query ? `?${query}` : ''
    }`;
  }
  return useEndpoint<DrivingRoutesResponse>(path);
}

export function useDrivingDrivers(projectId: string | null) {
  return useEndpoint<DrivingDriversResponse>(
    projectId ? `/api/sprint-k/${projectId}/driving/drivers` : null,
  );
}

export function useDrivingRanking(projectId: string | null) {
  return useEndpoint<DrivingRankingResponse>(
    projectId ? `/api/sprint-k/${projectId}/driving/ranking` : null,
  );
}

export interface DrivingRoutePayload {
  id?: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  criticality: DrivingRouteCriticality;
  hazards?: DrivingRouteHazard[];
  weatherSensitive?: boolean;
  recommendedMaxSpeedKmh?: number;
}

export async function registerRoute(
  projectId: string,
  payload: DrivingRoutePayload,
): Promise<DrivingRoute> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(`/api/sprint-k/${projectId}/driving/routes`, {
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
  const json = (await res.json()) as { ok: true; route: DrivingRoute };
  return json.route;
}

export interface DrivingRouteAlertPayload {
  kind: DrivingRouteAlertKind;
  note?: string;
  resolve?: boolean;
}

export async function flagRouteAlert(
  projectId: string,
  routeId: string,
  payload: DrivingRouteAlertPayload,
): Promise<DrivingRouteAlert | null> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/driving/routes/${routeId}/alert`,
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
    activeAlert: DrivingRouteAlert | null;
  };
  return json.activeAlert;
}

export interface DrivingJourneyPayload {
  /** 'start' inicia un viaje; 'end' lo cierra (requiere journeyId). */
  action: 'start' | 'end';
  /** ID del viaje a cerrar (sólo `action='end'`). */
  journeyId?: string;
  /** Horas acumuladas del viaje (suma a hoursThisWeek). */
  hours?: number;
  /** Nota opcional sobre el viaje. */
  note?: string;
}

export async function recordJourney(
  projectId: string,
  workerUid: string,
  payload: DrivingJourneyPayload,
): Promise<DrivingDriver> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(
    `/api/sprint-k/${projectId}/driving/drivers/${workerUid}/journey`,
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
  const json = (await res.json()) as { ok: true; driver: DrivingDriver };
  return json.driver;
}
