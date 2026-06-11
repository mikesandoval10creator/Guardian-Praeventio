// Praeventio Guard — Driving telemetry client hook (3 mutators +
// `useBrakeTelemetry`, the consumer that wires them into Driving.tsx).

import { useEffect, useRef } from 'react';
import {
  detectAggressiveBrake,
  type GeoPoint,
  type ImuSample,
  type SpeedSample,
} from '../services/driving/speedTrigger';
import { apiAuthHeaders } from '../lib/apiAuth';
import { logger } from '../utils/logger';

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

// ── 4. useBrakeTelemetry — Fase 5 D2 slice 1 (2026-06-11) ─────────────
//
// Real consumer for the telemetry mutators above (the module previously
// had ZERO importers). `Driving.tsx` already runs `useSpeedMonitor`
// (GPS `watchPosition`), so this hook derives the longitudinal
// acceleration between consecutive GPS speed fixes (a = Δv/Δt — a
// genuine physical estimate, not fabricated IMU data), evaluates the
// LOCAL pure detector `detectAggressiveBrake` (same engine the server
// runs), and only when a sustained ≥0.5g deceleration is detected fires
// `detectAggressiveBrakeRemote` fire-and-forget. Failures are swallowed
// (warn-level log only): the driving UX must never break and offline is
// tolerated — telemetry is best-effort by design.

/** Sliding window of derived samples kept for the brake detector. */
const BRAKE_WINDOW_MS = 5_000;

/**
 * Watches GPS `SpeedSample` updates and reports sustained aggressive
 * braking to the project's driving telemetry endpoint.
 *
 * - De-dupes on the detector's `triggerAt` (one report per brake event;
 *   re-arms once the deceleration window clears).
 * - No-op when `enabled` is false, `projectId` is null, or the GPS fix
 *   is stale (no fabricated samples from stale fixes).
 */
export function useBrakeTelemetry(
  projectId: string | null,
  sample: SpeedSample,
  enabled: boolean = true,
): void {
  const prevRef = useRef<{ speedMs: number; timestampMs: number } | null>(null);
  const bufferRef = useRef<ImuSample[]>([]);
  const lastReportedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !projectId) {
      // Reset so a later re-enable doesn't splice unrelated fixes into
      // one derived-acceleration segment.
      prevRef.current = null;
      bufferRef.current = [];
      return;
    }
    if (sample.isStale || sample.timestampMs === 0) return;

    const prev = prevRef.current;
    if (prev && sample.timestampMs > prev.timestampMs) {
      const dtS = (sample.timestampMs - prev.timestampMs) / 1000;
      const derived: ImuSample = {
        longitudinalMs2: (sample.speedMs - prev.speedMs) / dtS,
        timestampMs: sample.timestampMs,
      };
      const buffer = bufferRef.current
        .filter((s) => sample.timestampMs - s.timestampMs <= BRAKE_WINDOW_MS)
        .concat(derived);
      bufferRef.current = buffer;

      const triggerAt = detectAggressiveBrake(buffer);
      if (triggerAt !== null && triggerAt !== lastReportedRef.current) {
        lastReportedRef.current = triggerAt;
        try {
          detectAggressiveBrakeRemote(projectId, { samples: buffer }).catch(
            (err: unknown) => {
              // Best-effort telemetry — offline / network failure must
              // never surface while the user is driving.
              logger.warn('driving.brakeTelemetry.remote_failed', {
                message: (err as Error).message,
              });
            },
          );
        } catch (err) {
          logger.warn('driving.brakeTelemetry.remote_failed', {
            message: (err as Error).message,
          });
        }
      }
    }
    if (!prev || sample.timestampMs !== prev.timestampMs) {
      prevRef.current = {
        speedMs: sample.speedMs,
        timestampMs: sample.timestampMs,
      };
    }
  }, [enabled, projectId, sample]);
}
