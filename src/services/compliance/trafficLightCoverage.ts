// Praeventio Guard — coverage-aware view over the compliance traffic light.
//
// The pure engine (`computeTrafficLight`) always returns all 8 categories with
// a green/yellow/red light. But a category whose backing data is NOT yet wired
// must NOT be shown as green — that would be a fabricated "all clear" signal on
// a safety surface. This module rewrites un-sourced categories to an explicit
// `'unknown'` ("sin datos") state and recomputes `overall`/`score` over ONLY
// the sourced categories, so the badge never claims compliance it can't back.
//
// It deliberately lives OUTSIDE the engine (which is mutation-tested and whose
// `TrafficLight` union stays green/yellow/red) — this is a presentation-layer
// honesty wrapper, not new compliance logic.

import type {
  ComplianceCategory,
  ComplianceTrafficLightResult,
  CategoryStatus,
  TrafficLight,
} from './trafficLightEngine.js';

/** Engine lights plus the honest "no data source wired" state. */
export type TrafficLightView = TrafficLight | 'unknown';

export interface CategoryStatusView extends Omit<CategoryStatus, 'light'> {
  light: TrafficLightView;
}

export interface ComplianceTrafficLightView {
  /** Worst light across the SOURCED categories ('unknown' if none sourced). */
  overall: TrafficLightView;
  byCategory: CategoryStatusView[];
  /** 0-100 over sourced categories, or null when nothing is sourced. */
  score: number | null;
  computedAt: string;
  /** How many of the 8 categories have a real data source wired. */
  sourcedCount: number;
  totalCount: number;
}

/**
 * Rewrite the engine result so categories without a real data source render as
 * `'unknown'` and do not inflate the overall/score.
 *
 * @param base    result from `computeTrafficLight`
 * @param sourced categories that were computed from REAL project data
 */
export function applyCoverage(
  base: ComplianceTrafficLightResult,
  sourced: ReadonlySet<ComplianceCategory>,
): ComplianceTrafficLightView {
  const byCategory: CategoryStatusView[] = base.byCategory.map((c) =>
    sourced.has(c.category)
      ? { ...c }
      : {
          category: c.category,
          light: 'unknown',
          summary: '',
          criticalItemIds: [],
          warningCount: 0,
        },
  );

  const sourcedCats = byCategory.filter((c) => c.light !== 'unknown');
  const lights = sourcedCats.map((c) => c.light);

  const overall: TrafficLightView =
    sourcedCats.length === 0
      ? 'unknown'
      : lights.includes('red')
        ? 'red'
        : lights.includes('yellow')
          ? 'yellow'
          : 'green';

  const score =
    sourcedCats.length === 0
      ? null
      : Math.round(
          ((lights.filter((l) => l === 'green').length +
            lights.filter((l) => l === 'yellow').length * 0.5) /
            sourcedCats.length) *
            100,
        );

  return {
    overall,
    byCategory,
    score,
    computedAt: base.computedAt,
    sourcedCount: sourcedCats.length,
    totalCount: byCategory.length,
  };
}
