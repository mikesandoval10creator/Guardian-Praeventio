// SPDX-License-Identifier: MIT
// Praeventio Guard — Phase 5 remediation (2026-06-08): real hygiene metrics.
//
// Replaces the hardcoded "Tendencias Mensuales" bar array and the fabricated
// 92% / 78% occupational-health gauges in src/pages/Hygiene.tsx with REAL,
// derived numbers:
//   - Monthly trend  ← real `nodes` of type HYGIENE (metadata.value/limit +
//     createdAt), bucketed by calendar month as a % of the legal exposure limit.
//   - Medical-exam compliance ← the real `legal_obligations` calendar entries
//     of kind 'medical_exam' (overdue vs total). Reuses the SAME survey/overdue
//     semantics as VigilanciaScheduler / computeCalendar.
//
// These are PURE functions: no Firestore reads, no Gemini, no side effects.
// The page passes already-fetched arrays in. When a metric has no real source
// the function returns an honest empty marker (hasData:false / null) so the UI
// renders "Sin datos" instead of a synthesized value. There is intentionally
// NO vaccination function: no vaccination collection exists anywhere in the
// repo, so the page shows "Sin datos" for that gauge rather than fabricate it.

import type { RiskNode } from '../types';
import type { CalendarEntry } from '../services/legalCalendar/legalObligationsCalendar';

/** Number of month buckets shown in the trend chart (one calendar year). */
export const TREND_MONTHS = 12;

export interface HygieneTrend {
  /**
   * `TREND_MONTHS` values, oldest→newest, each the mean exposure of that
   * month's measurements as a % of the legal limit (clamped 0..100). Months
   * with no measurement are 0.
   */
  bars: number[];
  /** Short Spanish-CL month labels aligned 1:1 with `bars` (e.g. "ene"). */
  labels: string[];
  /** True when at least one real measurement contributed to a bucket. */
  hasData: boolean;
}

const MONTH_LABELS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/**
 * Parse a node timestamp into epoch ms. Hygiene nodes carry an ISO
 * `createdAt`; fall back to `updatedAt`. Returns NaN when unparseable.
 */
function nodeTimeMs(node: Pick<RiskNode, 'createdAt' | 'updatedAt'>): number {
  const raw = node.createdAt || node.updatedAt;
  return raw ? Date.parse(raw) : Number.NaN;
}

/**
 * Build a rolling 12-month exposure trend from real hygiene measurements.
 *
 * For each node we compute `value / limit * 100` (percent of the legal
 * exposure limit) and place it in the calendar-month bucket of its timestamp,
 * within the 12-month window ending at `now`. Each bucket holds the MEAN of
 * its measurements so a noisy month with many readings is not over-weighted.
 *
 * Invalid rows are skipped (missing/zero limit, non-finite value, unparseable
 * date, or a measurement older than the 12-month window). When nothing valid
 * remains, `hasData` is false and every bar is 0 → the UI shows an empty state.
 */
export function computeMonthlyHygieneTrend(
  hygieneNodes: RiskNode[],
  now: Date = new Date(),
): HygieneTrend {
  // Window: the first day of the month 11 months before `now`, through `now`.
  const endYear = now.getFullYear();
  const endMonth = now.getMonth(); // 0-based
  // Absolute month index (year*12 + month) for arithmetic across year edges.
  const endAbs = endYear * 12 + endMonth;
  const startAbs = endAbs - (TREND_MONTHS - 1);

  const sums = new Array<number>(TREND_MONTHS).fill(0);
  const counts = new Array<number>(TREND_MONTHS).fill(0);
  const labels = new Array<string>(TREND_MONTHS);
  for (let i = 0; i < TREND_MONTHS; i += 1) {
    const abs = startAbs + i;
    labels[i] = MONTH_LABELS_ES[((abs % 12) + 12) % 12];
  }

  let any = false;
  for (const node of hygieneNodes) {
    const meta = node.metadata || {};
    const value = Number(meta.value);
    const limit = Number(meta.limit);
    if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) continue;

    const ms = nodeTimeMs(node);
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    const abs = d.getFullYear() * 12 + d.getMonth();
    if (abs < startAbs || abs > endAbs) continue;

    const idx = abs - startAbs;
    const pct = Math.max(0, Math.min(100, (value / limit) * 100));
    sums[idx] += pct;
    counts[idx] += 1;
    any = true;
  }

  const bars = sums.map((s, i) => (counts[i] > 0 ? Math.round(s / counts[i]) : 0));
  return { bars, labels, hasData: any };
}

/**
 * Real occupational medical-exam compliance from the legal-obligations
 * calendar. Compliance = share of medical-exam obligations that are NOT
 * overdue. Returns `null` when the project has zero medical-exam obligations
 * (honest "Sin datos" — never a fabricated %).
 *
 * Caller is expected to pass entries already filtered to
 * `kind === 'medical_exam'` (mirrors VigilanciaScheduler), but we re-filter
 * defensively so the function is correct in isolation.
 */
export function computeMedicalExamCompliance(
  entries: CalendarEntry[],
): number | null {
  const medical = entries.filter((e) => e.kind === 'medical_exam');
  if (medical.length === 0) return null;
  const compliant = medical.filter((e) => !e.isOverdue).length;
  return Math.round((compliant / medical.length) * 100);
}
