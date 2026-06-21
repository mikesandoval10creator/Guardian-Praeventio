// Praeventio Guard — SPI plan-vs-executed input folding (HONEST).
//
// Bridges the project's REAL operational collections (executed inspections /
// daily talks / trainings / near-miss) and the captured PLANNED counts
// (safety_plan_periods) into the `LeadingIndicators` shape consumed by the
// `computeSafetyPerformance` engine.
//
// HONEST BY CONSTRUCTION:
//   • A leading rate (executed ÷ planned) is computed ONLY when a planned
//     denominator was actually captured for the period AND > 0. When there is
//     no captured plan, the indicator is NOT fabricated — it is flagged in the
//     `honesty` map and contributes a neutral 0 to the raw struct (the route /
//     dashboard then renders an honest empty-state CTA instead of a fake rate).
//   • A ratio is clamped to [0,1] for the score engine, but the RAW executed
//     and planned counts are returned untouched so the UI can show "26/22"
//     (over-delivery) honestly rather than hiding it behind a 100% cap.
//   • Indicators with NO real data source in the platform today
//     (preTaskChecklistCompletion, positiveObservationsRate) are flagged
//     honest-empty and never invented.
//
// Pure function — deterministic, no Firestore reads, no side effects. The route
// performs the reads and passes plain arrays/objects in.

import type { LeadingIndicators } from './safetyPerformanceIndex.js';

/** Captured planned counts for a period (from safety_plan_periods). null = not captured. */
export interface PlannedCounts {
  plannedInspections: number;
  plannedDailyTalks: number;
  plannedTrainings: number;
}

/** Executed (real) counts for a period, folded from the operational collections. */
export interface ExecutedCounts {
  executedInspections: number;
  executedDailyTalks: number;
  executedTrainings: number;
  nearMissReports: number;
}

/** Which leading indicators are honest-empty (no captured plan / no real source). */
export interface LeadingHonesty {
  preTaskChecklistCompletion: boolean;
  dailyTalksDeliveryRate: boolean;
  trainingCurrencyRate: boolean;
  plannedInspectionsRate: boolean;
  nearMissReportingRate: boolean;
  positiveObservationsRate: boolean;
}

export interface LeadingFold {
  /** Indicators ready for `computeSafetyPerformance` (honest-empty → 0). */
  leading: LeadingIndicators;
  /** Per-indicator honest-empty flags for the dashboard. */
  honesty: LeadingHonesty;
  /** Raw numerator/denominator pairs so the UI can show "26/22" truthfully. */
  ratios: {
    dailyTalks: { executed: number; planned: number };
    trainings: { executed: number; planned: number };
    inspections: { executed: number; planned: number };
  };
}

function nonNegInt(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw);
  }
  return 0;
}

/** executed ÷ planned, clamped to [0,1]; planned<=0 → null (honest-empty). */
function safeRate(executed: number, planned: number): number | null {
  if (planned <= 0) return null;
  return Math.max(0, Math.min(1, executed / planned));
}

/**
 * Fold real executed counts + captured planned counts into LeadingIndicators.
 *
 * @param executed real counts read from operational collections (period-scoped)
 * @param planned  captured planned counts from safety_plan_periods, or null when
 *                 no plan was captured for the period (→ all ratio indicators
 *                 honest-empty).
 */
export function foldLeadingIndicators(
  executed: ExecutedCounts,
  planned: PlannedCounts | null,
): LeadingFold {
  const plannedInspections = nonNegInt(planned?.plannedInspections);
  const plannedDailyTalks = nonNegInt(planned?.plannedDailyTalks);
  const plannedTrainings = nonNegInt(planned?.plannedTrainings);

  const executedInspections = nonNegInt(executed.executedInspections);
  const executedDailyTalks = nonNegInt(executed.executedDailyTalks);
  const executedTrainings = nonNegInt(executed.executedTrainings);
  const nearMissReports = nonNegInt(executed.nearMissReports);

  const talksRate = planned ? safeRate(executedDailyTalks, plannedDailyTalks) : null;
  const trainingsRate = planned ? safeRate(executedTrainings, plannedTrainings) : null;
  const inspectionsRate = planned ? safeRate(executedInspections, plannedInspections) : null;

  const honesty: LeadingHonesty = {
    // No platform collection captures pre-task checklist completion today.
    preTaskChecklistCompletion: true,
    dailyTalksDeliveryRate: talksRate === null,
    trainingCurrencyRate: trainingsRate === null,
    plannedInspectionsRate: inspectionsRate === null,
    // near-miss reporting is a raw count rate (no denominator) — it is REAL
    // whenever the project has any incidents collection (always queried), so
    // it is honest-empty only when there is genuinely nothing to report. We
    // treat 0 near-miss as a real, valid value (not honest-empty).
    nearMissReportingRate: false,
    // No platform collection captures positive safety observations today.
    positiveObservationsRate: true,
  };

  const leading: LeadingIndicators = {
    preTaskChecklistCompletion: 0,
    dailyTalksDeliveryRate: talksRate ?? 0,
    trainingCurrencyRate: trainingsRate ?? 0,
    plannedInspectionsRate: inspectionsRate ?? 0,
    nearMissReportingRate: nearMissReports,
    positiveObservationsRate: 0,
  };

  return {
    leading,
    honesty,
    ratios: {
      dailyTalks: { executed: executedDailyTalks, planned: plannedDailyTalks },
      trainings: { executed: executedTrainings, planned: plannedTrainings },
      inspections: { executed: executedInspections, planned: plannedInspections },
    },
  };
}
