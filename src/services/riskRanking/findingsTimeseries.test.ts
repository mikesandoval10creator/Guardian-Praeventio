import { describe, it, expect } from 'vitest';
import {
  buildFindingsTimeseries,
  type TimeseriesFindingInput,
} from './findingsTimeseries';

const DAY = 86_400_000;
// Fixed "now" at a UTC midnight-ish point for deterministic day keys.
const NOW = Date.parse('2026-06-05T12:00:00Z');

function f(daysAgo: number, isCritical = false): TimeseriesFindingInput {
  return { createdAt: new Date(NOW - daysAgo * DAY).toISOString(), isCritical };
}

describe('buildFindingsTimeseries', () => {
  it('returns one continuous bucket per day (gaps filled with 0)', () => {
    const series = buildFindingsTimeseries([], { days: 7, nowMs: NOW });
    expect(series).toHaveLength(7);
    expect(series.every((p) => p.totalFindings === 0 && p.criticalFindings === 0)).toBe(true);
    // Ordered oldest → newest; last bucket is today.
    expect(series[6]!.date).toBe('2026-06-05');
    expect(series[0]!.date).toBe('2026-05-30');
  });

  it('buckets findings by UTC day and counts total + critical', () => {
    const series = buildFindingsTimeseries(
      [f(0, true), f(0, false), f(1, true), f(2, false)],
      { days: 7, nowMs: NOW },
    );
    const today = series.find((p) => p.date === '2026-06-05')!;
    const yesterday = series.find((p) => p.date === '2026-06-04')!;
    expect(today.totalFindings).toBe(2);
    expect(today.criticalFindings).toBe(1);
    expect(yesterday.totalFindings).toBe(1);
    expect(yesterday.criticalFindings).toBe(1);
  });

  it('ignores findings outside the trailing window', () => {
    const series = buildFindingsTimeseries([f(2), f(40)], { days: 7, nowMs: NOW });
    const total = series.reduce((s, p) => s + p.totalFindings, 0);
    expect(total).toBe(1); // the 40-day-old one is dropped
  });

  it('accepts epoch-ms and YYYY-MM-DD dates; skips unparseable', () => {
    const series = buildFindingsTimeseries(
      [
        { createdAt: NOW, isCritical: false }, // epoch ms → today
        { createdAt: '2026-06-04', isCritical: true }, // date-only → yesterday
        { createdAt: 'garbage', isCritical: true }, // skipped
      ],
      { days: 7, nowMs: NOW },
    );
    expect(series.find((p) => p.date === '2026-06-05')!.totalFindings).toBe(1);
    expect(series.find((p) => p.date === '2026-06-04')!.criticalFindings).toBe(1);
  });

  it('defaults to a 30-day window and is defensive against empty/null entries', () => {
    expect(buildFindingsTimeseries([], { nowMs: NOW })).toHaveLength(30);
    expect(() =>
      buildFindingsTimeseries(
        [null as unknown as TimeseriesFindingInput, f(0)],
        { days: 5, nowMs: NOW },
      ),
    ).not.toThrow();
  });
});
