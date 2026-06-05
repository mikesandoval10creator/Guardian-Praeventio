/**
 * Findings timeseries — daily counts of FINDING ('Hallazgo') Zettelkasten nodes
 * over a trailing window, for the risk-trend dashboard chart.
 *
 * WHY (B2 🔵, Fase 5): `useRiskTimeseries` was the last idle stub feeding the
 * orphan `RiskTimeseriesChart`. Consistent with the Zettelkasten-canonical
 * decision (ADR 0020 / #689), findings are counted from `zettelkasten_nodes`
 * (type 'Hallazgo') bucketed by `createdAt`. Pure and deterministic.
 */

export interface TimeseriesFindingInput {
  /** ISO-8601, YYYY-MM-DD or epoch-ms date the finding was created. */
  createdAt: string | number;
  /** Whether this finding is critical (high severity / Crítica·Alta). */
  isCritical: boolean;
}

export interface RiskTimeseriesPoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  totalFindings: number;
  criticalFindings: number;
}

export interface TimeseriesOptions {
  /** Trailing window length in days (inclusive of today). Default 30. */
  days?: number;
  /** Injectable clock (ms). Defaults to `Date.now()`. */
  nowMs?: number;
}

const DAY_MS = 86_400_000;

function toDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse a finding date to epoch-ms; returns NaN when unparseable. */
function parseToMs(value: string | number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  return Date.parse(value);
}

/**
 * Build a continuous daily series over the last `days` days (gaps filled with
 * 0 so the chart renders an unbroken line). Findings outside the window are
 * ignored; unparseable dates are skipped.
 */
export function buildFindingsTimeseries(
  findings: TimeseriesFindingInput[],
  opts: TimeseriesOptions = {},
): RiskTimeseriesPoint[] {
  const days = Math.max(1, Math.floor(opts.days ?? 30));
  const now = opts.nowMs ?? Date.now();

  const buckets = new Map<string, { total: number; critical: number }>();
  for (let i = days - 1; i >= 0; i--) {
    buckets.set(toDayKey(now - i * DAY_MS), { total: 0, critical: 0 });
  }

  for (const f of findings) {
    if (!f) continue;
    const ms = parseToMs(f.createdAt);
    if (!Number.isFinite(ms)) continue;
    const bucket = buckets.get(toDayKey(ms));
    if (!bucket) continue; // outside the window
    bucket.total += 1;
    if (f.isCritical) bucket.critical += 1;
  }

  return [...buckets.entries()].map(([date, b]) => ({
    date,
    totalFindings: b.total,
    criticalFindings: b.critical,
  }));
}
