import { describe, it, expect } from 'vitest';
import {
  iotEventToMillis,
  isFeedLive,
  FEED_LIVE_WINDOW_MS,
  type IoTEvent,
} from './IoTEventsFeed';

const NOW = 1_700_000_000_000; // fixed epoch ms for determinism

function ev(ts: IoTEvent['timestamp'], over: Partial<IoTEvent> = {}): IoTEvent {
  return {
    id: 'e1',
    type: 'machinery',
    source: 'S',
    metric: 'm',
    value: 1,
    unit: 'u',
    timestamp: ts,
    status: 'normal',
    ...over,
  };
}

describe('iotEventToMillis', () => {
  it('passes through finite numbers', () => {
    expect(iotEventToMillis(NOW)).toBe(NOW);
  });
  it('parses ISO strings', () => {
    const iso = new Date(NOW).toISOString();
    expect(iotEventToMillis(iso)).toBe(NOW);
  });
  it('reads a Date', () => {
    expect(iotEventToMillis(new Date(NOW))).toBe(NOW);
  });
  it('reads a Firestore Timestamp via toMillis', () => {
    expect(iotEventToMillis({ toMillis: () => NOW })).toBe(NOW);
  });
  it('reads a Firestore Timestamp via toDate', () => {
    expect(iotEventToMillis({ toDate: () => new Date(NOW) })).toBe(NOW);
  });
  it('returns null for unparseable / nullish input', () => {
    expect(iotEventToMillis('not-a-date')).toBeNull();
    expect(iotEventToMillis(NaN)).toBeNull();
    // @ts-expect-error testing nullish
    expect(iotEventToMillis(null)).toBeNull();
    expect(iotEventToMillis({})).toBeNull();
  });
});

describe('isFeedLive', () => {
  it('is false for empty / nullish feeds (no hard-coded En Vivo)', () => {
    expect(isFeedLive([], NOW)).toBe(false);
    expect(isFeedLive(null, NOW)).toBe(false);
    expect(isFeedLive(undefined, NOW)).toBe(false);
  });

  it('is true when the newest event is within the freshness window', () => {
    const events = [
      ev(NOW - 60_000), // 1 min ago
      ev(NOW - 9 * 60_000), // 9 min ago
    ];
    expect(isFeedLive(events, NOW)).toBe(true);
  });

  it('is false when every event is older than the window', () => {
    const events = [ev(NOW - (FEED_LIVE_WINDOW_MS + 60_000))];
    expect(isFeedLive(events, NOW)).toBe(false);
  });

  it('uses the NEWEST event, not the oldest', () => {
    const events = [
      ev(NOW - (FEED_LIVE_WINDOW_MS + 60_000)), // stale
      ev(NOW - 30_000), // fresh
    ];
    expect(isFeedLive(events, NOW)).toBe(true);
  });

  it('rejects absurd future timestamps beyond skew tolerance', () => {
    const events = [ev(NOW + 2 * FEED_LIVE_WINDOW_MS)];
    expect(isFeedLive(events, NOW)).toBe(false);
  });

  it('ignores events with unparseable timestamps', () => {
    expect(isFeedLive([ev('garbage')], NOW)).toBe(false);
  });
});
