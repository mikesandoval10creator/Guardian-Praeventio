// Praeventio Guard — Route Scoring client hook (2 stateless mutators).

import { auth } from '../services/firebase';
import type {
  RoutePoint,
  RouteRiskProfile,
  RouteSegmentHazard,
} from '../services/routeScoring/criticalRouteScoring';
import type {
  DriverProfile,
  RouteAssignmentDecision,
} from '../services/routeScoring/driverRouteMatcher';

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

export interface BuildRouteProfileInput {
  routeId: string;
  points: RoutePoint[];
  hazards: RouteSegmentHazard[];
}

export interface BuildRouteProfileResponse {
  profile: RouteRiskProfile;
}

export async function buildRouteProfile(
  projectId: string,
  input: BuildRouteProfileInput,
): Promise<BuildRouteProfileResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/routes/build-profile`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as BuildRouteProfileResponse;
}

export interface EvaluateDriverRouteInput {
  driver: DriverProfile;
  profile: RouteRiskProfile;
  requiredVehicleType?: string;
}

export interface EvaluateDriverRouteResponse {
  decision: RouteAssignmentDecision;
}

export async function evaluateDriverRouteAssignment(
  projectId: string,
  input: EvaluateDriverRouteInput,
): Promise<EvaluateDriverRouteResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/routes/evaluate-driver`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return (await res.json()) as EvaluateDriverRouteResponse;
}
