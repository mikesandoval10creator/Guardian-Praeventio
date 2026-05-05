// Praeventio Guard — Bucket CC: churn-cohort heatmap.
//
// Cohorts on rows (signup-month), retention on columns (M+0, M+1, ..., M+11).
// Each cell shows retention pct as a tinted teal square. Pure DOM grid —
// avoids pulling in a heatmap lib for one widget. Caller supplies the
// matrix; defaults to an empty placeholder when no data is available.

import React from 'react';

export interface CohortRow {
  /** Cohort label, e.g. "May 26". */
  cohortLabel: string;
  /** Number of customers in the cohort the month they signed up. */
  size: number;
  /**
   * Retention pct per month-offset (0..11). 0 → first month; values are
   * 0..1. Cells with `null` are rendered as "n/a" (cohort hasn't reached
   * that age yet).
   */
  retention: Array<number | null>;
}

export interface ChurnCohortHeatmapProps {
  cohorts: CohortRow[];
}

/** Linear teal-tint for retention 0..1. 0 → very pale, 1 → strong teal. */
function tintForRetention(p: number): string {
  // 4db6ac = (77, 182, 172). Mix toward white as retention drops.
  const ratio = Math.max(0, Math.min(1, p));
  const r = Math.round(255 + (77 - 255) * ratio);
  const g = Math.round(255 + (182 - 255) * ratio);
  const b = Math.round(255 + (172 - 255) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ChurnCohortHeatmap({ cohorts }: ChurnCohortHeatmapProps) {
  if (!cohorts.length) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-zinc-500">
        Aún no hay cohortes suficientes para calcular retención mensual.
      </div>
    );
  }

  const monthOffsets = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left text-zinc-500 font-semibold pr-3">Cohorte</th>
            <th className="text-left text-zinc-500 font-semibold pr-3">Tamaño</th>
            {monthOffsets.map((m) => (
              <th key={m} className="text-zinc-500 font-semibold w-12 text-center">M+{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((row) => (
            <tr key={row.cohortLabel}>
              <td className="pr-3 font-mono text-zinc-700 dark:text-zinc-300">{row.cohortLabel}</td>
              <td className="pr-3 text-zinc-600 dark:text-zinc-400">{row.size}</td>
              {monthOffsets.map((m) => {
                const v = row.retention[m];
                if (v === null || v === undefined) {
                  return (
                    <td key={m} className="w-12 h-8 text-center text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-700">
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={m}
                    className="w-12 h-8 text-center border border-zinc-200 dark:border-zinc-700"
                    style={{ backgroundColor: tintForRetention(v) }}
                    title={`${(v * 100).toFixed(1)}% retenidos`}
                  >
                    {(v * 100).toFixed(0)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
