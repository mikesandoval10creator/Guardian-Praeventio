/**
 * Weak-controls aggregation — rank a project's critical controls by weakness,
 * derived from REAL terreno validations (`projects/{pid}/control_validations`,
 * written by `controlValidationsStore`). Each validation records whether a
 * supervisor found the control `present`.
 *
 * WHY (B2 🔵, Fase 5): the `useWeakControls` dashboard hook was an idle stub,
 * and the legacy pull endpoint read a flat `controls` collection that no writer
 * populates. The real signal is the validation log: group by `controlId`, count
 * verifications and failures (`present === false`), and feed the canonical
 * `rankWeakControls` engine. See ADR 0020 (Zettelkasten/real-source canon).
 */

import {
  rankWeakControls,
  type ControlRecord,
  type ControlWeakness,
} from './riskRankingEngine';

/** A single terreno validation projected from a `control_validations` doc. */
export interface ControlValidationInput {
  controlId: string;
  /** Whether the control was found present/OK. `false` counts as a failure. */
  present: boolean;
  /** ISO-8601 timestamp of the validation. */
  validatedAt: string;
}

export interface AggregateOptions {
  /** Resolve a human label for a controlId (e.g. from the controls library). */
  labelFor?: (controlId: string) => string;
  /** Injectable clock (ms) for tests. Defaults to `Date.now()`. */
  nowMs?: number;
  topN?: number;
}

/** Sentinel for "never verified with a parseable date" → treated as overdue. */
const NEVER_VERIFIED_DAYS = 99_999;
const DAY_MS = 86_400_000;

/**
 * Aggregate raw validations into ranked `ControlWeakness[]`. Pure and
 * deterministic. Validations are grouped by `controlId`; the most weakly
 * verified controls (high failure rate / overdue / never verified) rank first.
 */
export function rankWeakControlsFromValidations(
  validations: ControlValidationInput[],
  opts: AggregateOptions = {},
): ControlWeakness[] {
  const now = opts.nowMs ?? Date.now();
  const byControl = new Map<
    string,
    { total: number; failures: number; lastMs: number }
  >();

  for (const v of validations) {
    if (!v || !v.controlId) continue;
    const agg = byControl.get(v.controlId) ?? { total: 0, failures: 0, lastMs: 0 };
    agg.total += 1;
    if (v.present === false) agg.failures += 1;
    const ts = Date.parse(v.validatedAt);
    if (Number.isFinite(ts) && ts > agg.lastMs) agg.lastMs = ts;
    byControl.set(v.controlId, agg);
  }

  const records: ControlRecord[] = [...byControl.entries()].map(
    ([controlId, agg]) => ({
      id: controlId,
      projectId: '', // not used by the ranking engine
      label: opts.labelFor?.(controlId) ?? controlId,
      verificationCount: agg.total,
      failureCount: agg.failures,
      lastVerifiedAt: agg.lastMs > 0 ? new Date(agg.lastMs).toISOString() : undefined,
      daysSinceLastVerification:
        agg.lastMs > 0
          ? Math.max(0, Math.floor((now - agg.lastMs) / DAY_MS))
          : NEVER_VERIFIED_DAYS,
    }),
  );

  return rankWeakControls(records, opts.topN ?? 10);
}
