// @vitest-environment node
//
// Real worker positions for the evacuation/live map. The pure selection logic
// decides which survival beacons are shown: valid coords + fresh (within the
// window) only — a stale or undatable beacon is NEVER plotted as a live
// position (no ghost workers).

import { describe, it, expect, vi } from 'vitest';

// Minimal mocks so importing the hook module doesn't initialise Firebase.
vi.mock('../services/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
}));

import { selectFreshWorkerPings, PING_FRESHNESS_MS } from './useWorkerPings';

const NOW = 1_700_000_000_000;

describe('selectFreshWorkerPings — only real, fresh positions (no ghosts)', () => {
  it('keeps a fresh, valid beacon and carries status + age', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { lat: -33.45, lng: -70.66, status: 'help_requested', timestamp: NOW - 60_000 } }],
      NOW,
    );
    expect(out).toEqual([
      { uid: 'w1', lat: -33.45, lng: -70.66, status: 'help_requested', ageMs: 60_000 },
    ]);
  });

  it('drops a stale beacon (older than the freshness window)', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { lat: -33.45, lng: -70.66, timestamp: NOW - PING_FRESHNESS_MS - 1 } }],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('drops a beacon with no/undatable timestamp (never plot an undated position)', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { lat: -33.45, lng: -70.66, timestamp: null } }],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('drops invalid or out-of-range coordinates', () => {
    const out = selectFreshWorkerPings(
      [
        { uid: 'a', data: { lat: NaN, lng: -70, timestamp: NOW } },
        { uid: 'b', data: { lat: 999, lng: -70, timestamp: NOW } },
        { uid: 'c', data: { lng: -70, timestamp: NOW } }, // missing lat
      ],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('drops a future-dated beacon (clock skew)', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { lat: -33.45, lng: -70.66, timestamp: NOW + 120_000 } }],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('accepts a Firestore Timestamp-like object via toMillis()', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { lat: -33.45, lng: -70.66, timestamp: { toMillis: () => NOW - 30_000 } } }],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe('w1');
  });

  it('skips rows with no beacon doc', () => {
    expect(selectFreshWorkerPings([{ uid: 'w1', data: undefined }], NOW)).toEqual([]);
  });
});
