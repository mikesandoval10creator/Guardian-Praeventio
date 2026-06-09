// SPDX-License-Identifier: MIT
// Client wrapper for the structural-load predictive probe source.
//
// GET /api/sprint-k/:projectId/structural-loads/build-probes returns wire
// probes already computed from stored inputs × REAL Open-Meteo HOURLY wind,
// PLUS the scheduler window (windowMinutes / minLeadTimeMin) that matches the
// forecast cadence. The forecast curve is transported as `forecastValues[i]`
// (predicted FORCE at sample i = (i+1)*minutesPerStep minutes ahead); the
// caller reconstructs the per-minute `forecast(m)` STEP closure for
// `GeneratorProbe` so the data cadence and the scheduler window agree.

import { apiAuthHeaders } from './apiAuth';
import type { GeneratorProbe } from '../services/predictiveAlerts/alertScheduler';
import { FORECAST_MINUTES_PER_STEP } from '../services/predictiveAlerts/structuralLoadProbe';

export interface WireProbe {
  id: string;
  threshold: number;
  currentValue: number;
  /** forecastValues[i] = predicted FORCE at (i+1)*minutesPerStep minutes ahead. */
  forecastValues: number[];
}

export interface SchedulerWindow {
  windowMinutes: number;
  minLeadTimeMin: number;
}

export interface BuildProbesResponse {
  probes: WireProbe[];
  wind: {
    currentWindKmh: number;
    forecastWindKmh: number[];
    minutesPerStep: number;
    source: string;
  } | null;
  window: SchedulerWindow | null;
}

/** Probes plus the window the scheduler must evaluate them over. */
export interface StructuralLoadProbeSet {
  probes: GeneratorProbe[];
  window: SchedulerWindow | null;
}

/**
 * Reconstruct the engine `forecast(m)` STEP closure from the wire array. Each
 * sample covers a `minutesPerStep`-minute lead-time bucket: minute m reads
 * sample `ceil(m / minutesPerStep) - 1`. This mirrors the server-side bridge
 * so the per-minute scheduler crosses the threshold at the TRUE minute the
 * wind is predicted to overload the structure. Out-of-range ⇒ NaN.
 */
export function wireProbeToGeneratorProbe(
  w: WireProbe,
  minutesPerStep: number = FORECAST_MINUTES_PER_STEP,
): GeneratorProbe {
  const step = Number.isFinite(minutesPerStep) && minutesPerStep > 0
    ? minutesPerStep
    : FORECAST_MINUTES_PER_STEP;
  return {
    id: w.id,
    threshold: w.threshold,
    currentValue: w.currentValue,
    forecast: (minutesAhead: number): number => {
      if (!Number.isFinite(minutesAhead) || minutesAhead < 1) return Number.NaN;
      const index = Math.ceil(minutesAhead / step) - 1;
      if (index < 0 || index >= w.forecastValues.length) return Number.NaN;
      return w.forecastValues[index] ?? Number.NaN;
    },
  };
}

/**
 * Fetch real structural-load probes for a project. Returns an empty probe set
 * on any error or when there are no stored inputs / no real wind (honest,
 * never fake). The returned `window` matches the forecast cadence and MUST be
 * threaded into the scheduler so its evaluation span equals the data span.
 */
export async function fetchStructuralLoadProbes(
  projectId: string,
): Promise<StructuralLoadProbeSet> {
  try {
    const res = await fetch(
      `/api/sprint-k/${projectId}/structural-loads/build-probes`,
      { headers: { ...(await apiAuthHeaders()) } },
    );
    if (!res.ok) return { probes: [], window: null };
    const body = (await res.json()) as BuildProbesResponse;
    if (!Array.isArray(body.probes)) return { probes: [], window: null };
    const minutesPerStep = body.wind?.minutesPerStep ?? FORECAST_MINUTES_PER_STEP;
    return {
      probes: body.probes.map((p) => wireProbeToGeneratorProbe(p, minutesPerStep)),
      window: body.window ?? null,
    };
  } catch {
    return { probes: [], window: null };
  }
}
