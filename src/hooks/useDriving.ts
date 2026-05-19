// Praeventio Guard — Driving telemetry client hook (3 mutators).

import { auth } from '../services/firebase';
import type {
  GeoPoint,
  ImuSample,
} from '../services/driving/speedTrigger';

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

// ── 1. haversine-meters ────────────────────────────────────────────────

export interface HaversineInput { a: GeoPoint; b: GeoPoint }
export interface HaversineResponse { meters: number }

export async function haversineMetersRemote(
  projectId: string,
  input: HaversineInput,
): Promise<HaversineResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/driving/haversine-meters`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<HaversineResponse>(res);
}

// ── 2. accumulate-trip-mileage ─────────────────────────────────────────

export interface AccumulateMileageInput {
  prevTotalM: number;
  prev: GeoPoint | null;
  next: GeoPoint;
  prevTimestampMs: number;
  nextTimestampMs: number;
}
export interface AccumulateMileageResponse {
  result: { totalM: number; counted: boolean; segmentM: number };
}

export async function accumulateTripMileageRemote(
  projectId: string,
  input: AccumulateMileageInput,
): Promise<AccumulateMileageResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/driving/accumulate-trip-mileage`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<AccumulateMileageResponse>(res);
}

// ── 3. detect-aggressive-brake ─────────────────────────────────────────

export interface DetectBrakeInput { samples: ImuSample[] }
export interface DetectBrakeResponse { triggerAt: number | null }

export async function detectAggressiveBrakeRemote(
  projectId: string,
  input: DetectBrakeInput,
): Promise<DetectBrakeResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${projectId}/driving/detect-aggressive-brake`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return json<DetectBrakeResponse>(res);
}
