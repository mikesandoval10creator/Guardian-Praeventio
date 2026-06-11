// Praeventio Guard — man-down multi-sensor correlation engine (TODO.md §16.2.1).
//
// The sensorBus's raison d'être is reducing man-down FALSE POSITIVES by
// correlating independent signals instead of letting each sensor escalate in
// isolation. This engine is the decision kernel consumed by
// `useManDownDetection`:
//
//   impact alone                                    → 'suspect'  (normal countdown)
//   impact + sustained immobility                   → 'suspect'  (higher confidence,
//                                                     extra reason recorded)
//   impact + immobility + (BLE off | battery crit)  → 'critical' (escalate faster:
//                                                     reduced countdown)
//
// Anti-false-positive rationale: a lone accelerometer spike (tool drop, phone
// slip) is the dominant false-positive source. Requiring corroboration —
// sustained immobility AND loss of connectivity (worker out of BLE range of
// peers/beacons) or a device about to die — before shortening the worker's
// self-cancel window keeps the default 10s flow intact for ambiguous events
// while reacting faster only when multiple independent signals agree.
//
// PURE FUNCTION (repo rule #9): no side effects, no Firestore, no Date.now()
// — the caller supplies `now`. Deterministic; mutation-testing ready.

import type { SensorKind, SensorReading } from './sensorBus';

// ────────────────────────────────────────────────────────────────────────
// Constants (documented thresholds)
// ────────────────────────────────────────────────────────────────────────

/**
 * Sentinel workerUid for device-scoped publishers that run without an auth
 * context (BLE scan, battery). Readings under this uid are attributed to the
 * local worker by `evaluateManDownEvidence` — BLE/battery state belongs to
 * the device the worker is carrying, not to a Firestore identity.
 */
export const LOCAL_DEVICE_UID = 'local-device';

/**
 * How recent an impact ('fall') reading must be to anchor the evaluation.
 * Aligned with the bus's STALE_THRESHOLD_MS (60s): an impact older than a
 * minute followed by normal activity is not an emergency-in-progress.
 */
export const IMPACT_EVIDENCE_WINDOW_MS = 60_000;

/**
 * How recent the sustained-immobility ('inactivity') reading must be. The
 * publisher (useManDownDetection) only emits it after its own
 * INACTIVITY_THRESHOLD (default 30s with no jerk above threshold), so this
 * window bounds staleness of that already-sustained signal, not the
 * immobility duration itself.
 */
export const IMMOBILITY_EVIDENCE_WINDOW_MS = 60_000;

/**
 * How recent the latest BLE proximity reading must be to count. BLE scans
 * run on a slower cadence than motion (~10s scan bursts triggered by the
 * mesh UI), so the window is wider than the impact window.
 */
export const BLE_EVIDENCE_WINDOW_MS = 120_000;

/**
 * How recent the latest battery reading must be. Battery level moves slowly;
 * a 5-minute-old snapshot is still representative.
 */
export const BATTERY_EVIDENCE_WINDOW_MS = 300_000;

/**
 * Self-cancel countdown (seconds) for the normal/suspect flow. Mirrors the
 * historical hard-coded 10s in useManDownDetection — the default behavior
 * MUST NOT change when the bus has no corroborating evidence.
 */
export const MANDOWN_COUNTDOWN_DEFAULT_S = 10;

/**
 * Reduced self-cancel countdown (seconds) when evidence is 'critical'
 * (impact + immobility + BLE disconnected or battery critical). Halving the
 * window trades 5s of self-cancel time for 5s faster supervisor escalation —
 * justified only when three independent signals already agree.
 */
export const MANDOWN_COUNTDOWN_CRITICAL_S = 5;

// Reason codes (English — code/log convention). Stable strings: they end up
// in black-box dumps and logs, so treat them as a contract.
export const REASON_IMPACT = 'impact_detected';
export const REASON_IMMOBILITY = 'sustained_immobility';
export const REASON_BLE_DISCONNECTED = 'ble_disconnected';
export const REASON_BATTERY_CRITICAL = 'battery_critical';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export type ManDownEvidenceLevel = 'none' | 'suspect' | 'critical';

export interface ManDownEvidence {
  level: ManDownEvidenceLevel;
  /** Ordered, stable reason codes justifying the level (for logs/black box). */
  reasons: string[];
}

export interface EvaluateManDownOptions {
  /**
   * Scope the evaluation to one worker. Readings from other workers are
   * ignored; readings under LOCAL_DEVICE_UID always count (device-scoped
   * sensors have no auth context). Omit to consider every reading.
   */
  workerUid?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Engine
// ────────────────────────────────────────────────────────────────────────

function ageMs(r: SensorReading, now: Date): number {
  return now.getTime() - new Date(r.at).getTime();
}

/** Valid = parseable timestamp, not in the future (clock-skew guard), within window. */
function isWithin(r: SensorReading, now: Date, windowMs: number): boolean {
  const age = ageMs(r, now);
  return Number.isFinite(age) && age >= 0 && age <= windowMs;
}

function latestOf(
  events: readonly SensorReading[],
  kind: SensorKind,
  now: Date,
  windowMs: number,
): SensorReading | undefined {
  let latest: SensorReading | undefined;
  for (const e of events) {
    if (e.kind !== kind) continue;
    if (!isWithin(e, now, windowMs)) continue;
    if (!latest || new Date(e.at).getTime() > new Date(latest.at).getTime()) {
      latest = e;
    }
  }
  return latest;
}

/**
 * Evaluates recent sensor-bus readings into a man-down evidence verdict.
 *
 * Pure and deterministic: same `(events, now, options)` → same output; the
 * input array is never mutated. See module header for the rule table.
 */
export function evaluateManDownEvidence(
  events: readonly SensorReading[],
  now: Date,
  options: EvaluateManDownOptions = {},
): ManDownEvidence {
  const scoped = options.workerUid
    ? events.filter(
        (e) => e.workerUid === options.workerUid || e.workerUid === LOCAL_DEVICE_UID,
      )
    : events;

  const impact = latestOf(scoped, 'fall', now, IMPACT_EVIDENCE_WINDOW_MS);
  if (!impact) {
    // Impact-anchored by design: immobility/BLE alone are handled by the
    // hook's normal inactivity flow — this engine only modulates post-impact.
    return { level: 'none', reasons: [] };
  }

  const immobility = latestOf(scoped, 'inactivity', now, IMMOBILITY_EVIDENCE_WINDOW_MS);
  const ble = latestOf(scoped, 'ble_proximity', now, BLE_EVIDENCE_WINDOW_MS);
  const battery = latestOf(scoped, 'battery', now, BATTERY_EVIDENCE_WINDOW_MS);

  // Latest reading per kind wins: a reconnection ('info') after a dropout
  // clears the disconnection evidence; a fresh healthy battery snapshot
  // clears an older critical one.
  const bleDisconnected = ble !== undefined && ble.severity !== 'info';
  const batteryCritical = battery !== undefined && battery.severity === 'critical';

  const reasons: string[] = [REASON_IMPACT];
  if (immobility) reasons.push(REASON_IMMOBILITY);
  if (bleDisconnected) reasons.push(REASON_BLE_DISCONNECTED);
  if (batteryCritical) reasons.push(REASON_BATTERY_CRITICAL);

  const level: ManDownEvidenceLevel =
    immobility && (bleDisconnected || batteryCritical) ? 'critical' : 'suspect';

  return { level, reasons };
}
