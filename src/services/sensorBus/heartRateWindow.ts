// Praeventio Guard — heart-rate clinical window (P0 VIDA, telemetry→safety rail).
//
// The BLE heart-rate path used to react to a SINGLE sample (>120 bpm → local
// text alert). A single-sample escalation is clinically wrong: motion
// artifacts, sensor glitches and brief spikes produce false positives that
// burn supervisor attention and — worse — can pre-empt real escalations.
//
// This module is the PURE decision kernel for the sustained window: given a
// stream of heart-rate samples, it decides whether the elevation is CONFIRMED
// (enough readings above threshold within a time window) before anything may
// escalate. It is deliberately free of React/Firestore/sensorBus side effects
// (repo rule #9 — pure decision kernels live apart from side-effect bridges).

import type { SensorSeverity } from './sensorBus';

/** One heart-rate observation (device-side epoch ms). */
export interface HeartRateSample {
  bpm: number;
  atMs: number;
}

export interface HeartRateWindowOptions {
  /** Window in ms within which readings count as one sustained episode. */
  windowMs: number;
  /** Minimum readings above threshold required to CONFIRM elevation. */
  minConfirmations: number;
  /** bpm above which a reading counts as elevated (tachycardia range). */
  elevatedAboveBpm: number;
  /**
   * Single-reading hard ceiling: at/above this bpm the reading escalates
   * immediately, without waiting for window confirmation — a real cardiac
   * crisis must never be delayed by a confirmation window.
   */
  criticalAboveBpm: number;
}

export const DEFAULT_HR_WINDOW_MS = 60_000;
export const DEFAULT_HR_MIN_CONFIRMATIONS = 3;
/** Default clinical elevation threshold (tachycardia-range, resting). */
export const DEFAULT_HR_ELEVATED_BPM = 120;
export const DEFAULT_HR_CRITICAL_BPM = 180;

export const DEFAULT_HR_WINDOW_OPTIONS: HeartRateWindowOptions = {
  windowMs: DEFAULT_HR_WINDOW_MS,
  minConfirmations: DEFAULT_HR_MIN_CONFIRMATIONS,
  elevatedAboveBpm: DEFAULT_HR_ELEVATED_BPM,
  criticalAboveBpm: DEFAULT_HR_CRITICAL_BPM,
};

/**
 * Decide the severity for a new heart-rate reading given the recent window.
 *
 * - Any single reading at/above `criticalAboveBpm` escalates immediately
 *   (a real cardiac crisis must not wait for a second confirmation).
 * - Otherwise the elevation must be CONFIRMED by `minConfirmations` readings
 *   above threshold inside `windowMs`; until then the reading is `info`
 *   (still published so the correlation engine sees the trend).
 * - Readings below threshold never escalate and reset the window.
 *
 * Returns the severity to publish plus the updated window (caller keeps it).
 */
export function evaluateHeartRateWindow(
  window: HeartRateSample[],
  sample: HeartRateSample,
  opts: HeartRateWindowOptions = DEFAULT_HR_WINDOW_OPTIONS,
): { severity: SensorSeverity; window: HeartRateSample[] } {
  const cutoff = sample.atMs - opts.windowMs;

  // Prune stale readings outside the window.
  const fresh = window.filter((r) => r.atMs > cutoff);

  if (sample.bpm < opts.elevatedAboveBpm) {
    // Normal reading — no escalation; window starts fresh.
    return { severity: 'info', window: [] };
  }

  const next = [...fresh, sample];
  const elevatedCount = next.filter((r) => r.bpm >= opts.elevatedAboveBpm).length;

  // Hard ceiling: single reading at or above the critical ceiling escalates
  // immediately — confirmation windows must never delay a real crisis.
  if (sample.bpm >= opts.criticalAboveBpm) {
    return { severity: 'critical', window: next };
  }

  if (elevatedCount >= opts.minConfirmations) {
    return { severity: 'warning', window: next };
  }

  // Elevated but not yet confirmed — publish as info so the correlation
  // engine still sees the trend without tripping escalation.
  return { severity: 'info', window: next };
}
