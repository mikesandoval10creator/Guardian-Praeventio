/**
 * Training validity — ONE source of truth.
 *
 * The calculation was duplicated in three places with two different rules:
 *   • `emergencyBrigadeService.ts`  → `trainedAt + years * 365 * 86_400_000`
 *   • `EmergencyBrigade.tsx`        → the same 365-day rule
 *   • `EmergencySquadManager.tsx`   → calendar years (`setFullYear`)
 *
 * The 365-day rule is the one that decides whether a brigade meets its
 * minimum coverage, so it is the authoritative one. This module is a faithful
 * EXTRACTION of it: the behaviour of the authoritative service is unchanged,
 * only the duplication is removed. Tightening the rule (e.g. treating an
 * unknown validity window as expired) is a separate, explicit decision — not
 * something to smuggle in while fixing a divergence.
 */

/** Milliseconds in the 365-day year the brigade rules use. */
export const TRAINING_YEAR_MS = 365 * 86_400_000;

function parseTrainedAt(trainedAt: string | number | Date | null | undefined): number {
  if (trainedAt instanceof Date) return trainedAt.getTime();
  if (typeof trainedAt === 'number') return trainedAt;
  if (typeof trainedAt === 'string') return Date.parse(trainedAt);
  return Number.NaN;
}

/**
 * Expiry timestamp in ms.
 *
 * Returns `null` when `trainedAt` cannot be parsed (so every caller is forced
 * to decide what to do with garbage data), and `NaN` when the validity window
 * is unknown — which preserves the historical behaviour of the service, where
 * `NaN < now` is false and the member was treated as valid.
 */
export function trainingExpiresAtMs(
  trainedAt: string | number | Date | null | undefined,
  validYears: number,
): number | null {
  const trainedMs = parseTrainedAt(trainedAt);
  if (!Number.isFinite(trainedMs)) return null;
  const years = Number.isFinite(validYears) ? validYears : Number.NaN;
  return trainedMs + years * TRAINING_YEAR_MS;
}

/**
 * Fail-closed validity check — a faithful extraction of the rule the brigade
 * coverage service has always used:
 *
 *   `Number.isNaN(trainedMs) || expiresMs < nowMs` → expired.
 *
 * An unparseable `trainedAt` is NOT valid: a brigade cannot be certified
 * "ready" on garbage data. An unknown validity window keeps the historical
 * behaviour (treated as valid) rather than silently changing brigade
 * coverage — that tightening is a separate decision.
 */
export function isTrainingValid(
  trainedAt: string | number | Date | null | undefined,
  validYears: number,
  nowMs: number = Date.now(),
): boolean {
  const expiresMs = trainingExpiresAtMs(trainedAt, validYears);
  if (expiresMs === null) return false;
  return !(expiresMs < nowMs);
}
