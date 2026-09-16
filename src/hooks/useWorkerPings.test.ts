// @vitest-environment node
//
// Real worker positions for the evacuation/live map. The pure selection logic
// decides which survival beacons are shown: valid coords + fresh + exact
// tenant/project scope only — a stale, undated or cross-project beacon is NEVER
// plotted as a live position (no ghost workers or cross-faena location leak).

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
const SCOPE = { projectId: 'p1', tenantId: 't1' };

describe('selectFreshWorkerPings — only real, fresh, scoped positions', () => {
  it('keeps a fresh, valid beacon and carries status + age', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { ...SCOPE, lat: -33.45, lng: -70.66, status: 'help_requested', timestamp: NOW - 60_000 } }],
      NOW,
      SCOPE,
    );
    expect(out).toEqual([
      { uid: 'w1', lat: -33.45, lng: -70.66, status: 'help_requested', ageMs: 60_000 },
    ]);
  });

  it('drops a stale beacon (older than the freshness window)', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { ...SCOPE, lat: -33.45, lng: -70.66, timestamp: NOW - PING_FRESHNESS_MS - 1 } }],
      NOW,
      SCOPE,
    );
    expect(out).toEqual([]);
  });

  it('drops a beacon with no/undatable timestamp (never plot an undated position)', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { ...SCOPE, lat: -33.45, lng: -70.66, timestamp: null } }],
      NOW,
      SCOPE,
    );
    expect(out).toEqual([]);
  });

  it('drops invalid or out-of-range coordinates', () => {
    const out = selectFreshWorkerPings(
      [
        { uid: 'a', data: { ...SCOPE, lat: NaN, lng: -70, timestamp: NOW } },
        { uid: 'b', data: { ...SCOPE, lat: 999, lng: -70, timestamp: NOW } },
        { uid: 'c', data: { ...SCOPE, lng: -70, timestamp: NOW } }, // missing lat
      ],
      NOW,
      SCOPE,
    );
    expect(out).toEqual([]);
  });

  it('drops a future-dated beacon (clock skew)', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { ...SCOPE, lat: -33.45, lng: -70.66, timestamp: NOW + 120_000 } }],
      NOW,
      SCOPE,
    );
    expect(out).toEqual([]);
  });

  it('accepts a Firestore Timestamp-like object via toMillis()', () => {
    const out = selectFreshWorkerPings(
      [{ uid: 'w1', data: { ...SCOPE, lat: -33.45, lng: -70.66, timestamp: { toMillis: () => NOW - 30_000 } } }],
      NOW,
      SCOPE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe('w1');
  });

  it('skips rows with no beacon doc', () => {
    expect(selectFreshWorkerPings([{ uid: 'w1', data: undefined }], NOW, SCOPE)).toEqual([]);
  });

  it('drops a fresh beacon from another project even when the UID is the same', () => {
    const out = selectFreshWorkerPings(
      [
        { uid: 'w1', data: { ...SCOPE, lat: -33.45, lng: -70.66, timestamp: NOW - 1_000 } },
        { uid: 'w1', data: { tenantId: 't1', projectId: 'p2', lat: -33.46, lng: -70.67, timestamp: NOW - 1_000 } },
        { uid: 'w1', data: { tenantId: 't2', projectId: 'p1', lat: -33.47, lng: -70.68, timestamp: NOW - 1_000 } },
      ],
      NOW,
      SCOPE,
    );
    expect(out).toEqual([
      { uid: 'w1', lat: -33.45, lng: -70.66, status: undefined, ageMs: 1_000 },
    ]);
  });

  it('drops legacy beacons without a proven scope', () => {
    expect(
      selectFreshWorkerPings(
        [{ uid: 'w1', data: { lat: -33.45, lng: -70.66, timestamp: NOW - 1_000 } }],
        NOW,
        SCOPE,
      ),
    ).toEqual([]);
  });
});
