import { describe, expect, it } from 'vitest';
import {
  formatWearableChartTimestamp,
  parseWearableChartDate,
} from './WearablesIntegration';

describe('wearables chart timestamp formatting', () => {
  it('formats numeric and ISO timestamps', () => {
    const numeric = Date.UTC(2026, 6, 29, 12, 30);
    const iso = '2026-07-29T12:30:00.000Z';

    expect(formatWearableChartTimestamp(numeric)).toBe(
      new Date(numeric).toLocaleString(),
    );
    expect(formatWearableChartTimestamp(iso)).toBe(
      new Date(iso).toLocaleString(),
    );
  });

  it('rejects non-date React nodes and invalid date strings', () => {
    expect(parseWearableChartDate(undefined)).toBeNull();
    expect(parseWearableChartDate(null)).toBeNull();
    expect(parseWearableChartDate(<span>not a timestamp</span>)).toBeNull();
    expect(parseWearableChartDate('not-a-date')).toBeNull();
    expect(formatWearableChartTimestamp(undefined)).toBe('');
  });
});