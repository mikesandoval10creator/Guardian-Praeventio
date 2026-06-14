// Praeventio Guard — OLA 1: ManDown graduated-escalation stage resolver.
//
// Pure helper feeding the man-down escalation cron
// (`server/jobs/runManDownEscalation.ts`). Given the seconds elapsed since a
// man-down event was detected, it returns WHICH escalation levels are now
// warranted.
//
// It deliberately reuses the cumulative thresholds already defined for the
// in-app timer (`manDownTimer.ts` DEFAULT_MAN_DOWN_CONFIG) so the server cron
// and the on-device countdown agree on when each level fires. The level NAMES
// are aligned with `LONE_WORKER_ROLE_BUCKETS` (supervisor / brigade /
// emergency_services) so the cron can resolve recipients with the exact same
// role→token machinery as the lone-worker escalation.
//
// Deterministic, no I/O — mutation-friendly and unit-testable in isolation.

import { DEFAULT_MAN_DOWN_CONFIG, type ManDownConfig } from './manDownTimer.js';

/**
 * The three man-down escalation levels, ascending severity. Aligned with the
 * keys of `LONE_WORKER_ROLE_BUCKETS` so the cron reuses role→token resolution.
 *   level_1 (supervisor)          — first responder, fastest/closest.
 *   level_2 (brigade)             — paritario/brigade activation.
 *   level_3 (emergency_services)  — SAMU / external emergency protocol.
 */
export const MAN_DOWN_ESCALATION_LEVELS = [
  'supervisor',
  'brigade',
  'emergency_services',
] as const;

export type ManDownEscalationLevel = (typeof MAN_DOWN_ESCALATION_LEVELS)[number];

export interface ManDownThresholds {
  /** Seconds since detection at which level_1 (supervisor) is warranted. */
  t1: number;
  /** Seconds since detection at which level_2 (brigade) is warranted. */
  t2: number;
  /** Seconds since detection at which level_3 (emergency_services) is warranted. */
  t3: number;
}

/**
 * Cumulative seconds-since-detection thresholds derived from the config.
 * Mirrors `manDownTimer.tickManDownEvent`'s t1/t2/t3 derivation.
 */
export function manDownThresholds(
  config: ManDownConfig = DEFAULT_MAN_DOWN_CONFIG,
): ManDownThresholds {
  const t1 = config.preAlertToLevel1Sec;
  const t2 = t1 + config.level1ToLevel2Sec;
  const t3 = t2 + config.level2ToLevel3Sec;
  return { t1, t2, t3 };
}

/**
 * Returns every escalation level WARRANTED by the elapsed time since the
 * man-down event was detected — cumulative and in ascending severity:
 *
 *   elapsed < t1        → []                                                  (pre-alert; worker self-cancel window)
 *   t1 ≤ elapsed < t2   → ['supervisor']
 *   t2 ≤ elapsed < t3   → ['supervisor', 'brigade']
 *   elapsed ≥ t3        → ['supervisor', 'brigade', 'emergency_services']
 *
 * The result is the CUMULATIVE set, not just the single current band, because
 * the cron may first observe an event already well past t3 (the worker's phone
 * was offline, or the very first sweep lands late). Returning only the top band
 * would page emergency_services while never paging the supervisor who is closest
 * and fastest. For a possibly-unconscious worker, under-paging is the dangerous
 * failure mode — mirrors the multi-stage rationale in `manDownTimer.ts`. The
 * cron deduplicates already-emitted levels via per-(event, level, UTC-day)
 * idempotency markers, so emitting the full set here does not double-page WITHIN
 * a day. (An event that stays unacknowledged across a UTC-midnight boundary is
 * intentionally re-escalated once the next day — re-asserting an unresolved
 * life-safety event — consistent with the lone-worker cron.)
 *
 * Returns `[]` for non-finite or negative elapsed (clock skew / bad data) —
 * the cron then leaves the event untouched rather than guessing.
 */
export function manDownLevelsForElapsed(
  elapsedSec: number,
  config: ManDownConfig = DEFAULT_MAN_DOWN_CONFIG,
): ManDownEscalationLevel[] {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return [];
  const { t1, t2, t3 } = manDownThresholds(config);
  const levels: ManDownEscalationLevel[] = [];
  if (elapsedSec >= t1) levels.push('supervisor');
  if (elapsedSec >= t2) levels.push('brigade');
  if (elapsedSec >= t3) levels.push('emergency_services');
  return levels;
}
