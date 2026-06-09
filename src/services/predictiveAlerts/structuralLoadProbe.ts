// SPDX-License-Identifier: MIT
// Structural wind-load -> predictive probe bridge.
//
// Converts a persisted `structural_loads` record (operator-entered
// area/Cp/NCh-432 force limit) plus a REAL wind forecast (km/h per
// look-ahead step, from Open-Meteo `wind_speed_10m` via
// externalClimate.fetchOpenMeteoHourlyWind) into a `GeneratorProbe`
// consumed by `evaluateProbes` (alertScheduler.ts).
//
// The physics is the existing Bernoulli engine: F = Cp·½ρv²·A
// (`windLoadOnSurface`). The probe's scalar is the wind FORCE in N; the
// threshold is the declared NCh-432 max admissible force. The windowed
// trigger fires when the FORECAST force crosses that limit with enough
// lead time — i.e. before the structure is overloaded.
//
// ── TIME-SCALE CONTRACT (the bug the prior blueprint shipped) ──────────
// `shouldFireWindowed` (windowedTrigger.ts) walks the forecast in 1-MINUTE
// steps: `for (m = 1..windowMinutes) forecast(m)`, and `decision.leadTimeMin`
// (rendered to the supervisor as "Alerta predictiva (N min)") IS that `m`.
// Open-Meteo, however, only gives discrete samples — hourly here. A daily or
// hourly sample index is NOT a minute. Mapping "sample i -> minute i" would
// (a) make a 3-sample forecast top out at lead-time 3 < the mount's
// minLeadTimeMin 5, so it could NEVER fire, and (b) tell the supervisor a
// ~Nhour-ahead prediction is "N min" ahead — a material misrepresentation of
// the horizon on a safety decision.
//
// FIX: each real forecast sample sits at a REAL minute offset
// `(i + 1) * minutesPerStep` (hourly ⇒ 60, 120, 180 …). `forecast(m)` is a
// step function over those real minute offsets, so when the scheduler walks
// per-minute it crosses the threshold at the TRUE minute the wind is
// predicted to overload the structure, and `leadTimeMin` is that true horizon.
// `deriveSchedulerWindow` returns the matching `windowMinutes` /
// `minLeadTimeMin` so the consumer's window equals the data's real span — the
// data cadence and the scheduler window AGREE. No fabricated per-minute
// samples are ever invented between Open-Meteo points; the value held between
// sample i and i+1 is sample i+1's value (next predicted reading), never an
// interpolation pretending to be a measurement.
//
// HONEST DEGRADATION (directive: never fabricate): a record missing any
// required input, or a forecast with no usable wind samples, yields
// `null` (NO probe). A node without inputs simply produces no Bernoulli
// signal — never a fake one.

import type { GeneratorProbe } from './alertScheduler';
import { windLoadOnSurface, windSpeedKmhToMs } from '../physics/bernoulliEngine';

/** Sea-level air density (NIST, 15°C) — same constant the generators use. */
const AIR_DENSITY_KG_M3 = 1.225;

/**
 * Open-Meteo hourly wind gives one sample per hour. Each forecast step is
 * therefore 60 minutes of real lead time. Exported so the route and the
 * scheduler-window derivation stay in lockstep with the bridge.
 */
export const FORECAST_MINUTES_PER_STEP = 60;

/**
 * The persisted, operator-captured structural-load inputs. These are the
 * REAL numbers a prior attempt fabricated on RiskNode.metadata; here they
 * come from the `structural_loads` collection (see structuralLoads.ts route).
 */
export interface StructuralLoadInputs {
  /** Stable id of the structural element (probe id). */
  id: string;
  /** Wind-exposed area (m²) — operator-entered, > 0. */
  areaM2: number;
  /** Pressure coefficient Cp (NCh 432). Magnitude used; sign irrelevant for force. */
  pressureCoefficient: number;
  /** Declared max admissible force (N) per NCh 432 / engineering sign-off, > 0. */
  maxForceN: number;
}

/**
 * Derive the scheduler window that MATCHES a forecast of `sampleCount`
 * real samples spaced `minutesPerStep` apart. The scheduler walks
 * `m = 1..windowMinutes`; we set `windowMinutes` to the full real span so
 * every sample is reachable, and `minLeadTimeMin` to one step so the FIRST
 * predicted sample (already `minutesPerStep` minutes ahead) can fire while
 * staying genuinely predictive (currentValue is excluded by the engine's
 * "hazard already present" guard). Returns `null` when there are no samples.
 */
export function deriveSchedulerWindow(
  sampleCount: number,
  minutesPerStep: number = FORECAST_MINUTES_PER_STEP,
): { windowMinutes: number; minLeadTimeMin: number } | null {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return null;
  if (!Number.isFinite(minutesPerStep) || minutesPerStep <= 0) return null;
  return {
    windowMinutes: Math.floor(sampleCount * minutesPerStep),
    minLeadTimeMin: Math.floor(minutesPerStep),
  };
}

/**
 * Map a real forecast sample array (each `forceForecast[i]` is the predicted
 * value at `(i + 1) * minutesPerStep` minutes ahead) into the per-minute
 * `forecast(m)` closure the scheduler expects. It is a STEP function: for a
 * minute `m`, the value is the sample covering that minute's lead-time bucket,
 * i.e. sample index `ceil(m / minutesPerStep) - 1`. Out-of-range ⇒ NaN.
 *
 * This never invents a per-minute reading between Open-Meteo points — minute
 * 1..60 all read sample 0 (the +1h prediction), minute 61..120 read sample 1,
 * etc. The crossing the scheduler reports therefore lands on a REAL predicted
 * sample at its REAL minute offset.
 */
function stepForecast(
  forceForecast: number[],
  minutesPerStep: number,
): (minutesAhead: number) => number {
  return (minutesAhead: number): number => {
    if (!Number.isFinite(minutesAhead) || minutesAhead < 1) return Number.NaN;
    const index = Math.ceil(minutesAhead / minutesPerStep) - 1;
    if (index < 0 || index >= forceForecast.length) return Number.NaN;
    return forceForecast[index] ?? Number.NaN;
  };
}

/**
 * Build a single predictive probe from one structural-load record and a
 * sequence of forecast wind speeds (km/h), where `forecastWindKmh[i]` is
 * the predicted wind at `(i + 1) * minutesPerStep` minutes ahead.
 *
 * Returns `null` when:
 *   • any required input is non-finite or ≤ 0, or
 *   • the forecast has no finite, non-negative wind samples.
 * In both cases the honest answer is "no Bernoulli probe", never a fake.
 */
export function buildStructuralLoadProbe(
  inputs: StructuralLoadInputs,
  currentWindKmh: number,
  forecastWindKmh: number[],
  minutesPerStep: number = FORECAST_MINUTES_PER_STEP,
): GeneratorProbe | null {
  const { id, areaM2, pressureCoefficient, maxForceN } = inputs;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null;
  if (!Number.isFinite(maxForceN) || maxForceN <= 0) return null;
  if (!Number.isFinite(pressureCoefficient)) return null;
  if (!Number.isFinite(minutesPerStep) || minutesPerStep <= 0) return null;

  const cpMagnitude = Math.abs(pressureCoefficient);
  if (cpMagnitude <= 0) return null;

  const usableForecast = forecastWindKmh.filter(
    (w) => Number.isFinite(w) && w >= 0,
  );
  if (usableForecast.length === 0) return null;

  // Wind FORCE (N) for a given wind speed (km/h), via the Bernoulli engine.
  const forceForWindKmh = (windKmh: number): number => {
    const vMs = windSpeedKmhToMs(windKmh);
    return windLoadOnSurface(areaM2, vMs, cpMagnitude, AIR_DENSITY_KG_M3);
  };

  const currentValue =
    Number.isFinite(currentWindKmh) && currentWindKmh >= 0
      ? forceForWindKmh(currentWindKmh)
      : 0;

  const forceForecast = usableForecast.map(forceForWindKmh);

  return {
    // Reuse the canonical generator id so analytics + RECOMMENDED_ACTIONS_ES
    // (AlertSchedulerMount GENERATOR_TO_RISK_CLASS / windowedTrigger) map it
    // to 'structural-wind' -> 'mechanical' with the right Spanish action.
    id: 'structural-wind',
    threshold: maxForceN,
    currentValue,
    forecast: stepForecast(forceForecast, minutesPerStep),
  };
}

/**
 * Build probes for many structural-load records against ONE shared wind
 * forecast (all elements at a site share the weather). Records that cannot
 * produce a real probe are dropped (honest), not defaulted.
 */
export function buildStructuralLoadProbes(
  records: StructuralLoadInputs[],
  currentWindKmh: number,
  forecastWindKmh: number[],
  minutesPerStep: number = FORECAST_MINUTES_PER_STEP,
): GeneratorProbe[] {
  const out: GeneratorProbe[] = [];
  for (const r of records) {
    const probe = buildStructuralLoadProbe(
      r,
      currentWindKmh,
      forecastWindKmh,
      minutesPerStep,
    );
    if (probe) out.push(probe);
  }
  return out;
}
