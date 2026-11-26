/**
 * Slice 2 — EmergencySquadManager contracts + shared training validity.
 *
 * Each test names the Notion ticket it closes.
 */

import { describe, expect, it } from 'vitest';
import {
  assertBreadcrumbOrder,
  classifyBreadcrumbLoad,
  describeGeneralCallOutcome,
  filterFreshPeers,
  formatElapsed,
  latestBreadcrumb,
  trainingState,
} from './emergencySquadContracts';
import {
  isTrainingValid,
  trainingExpiresAtMs,
  TRAINING_YEAR_MS,
} from '../../services/emergencyBrigade/trainingValidity';

const NOW = Date.parse('2026-11-26T12:00:00.000Z');

describe('emergencySquad — GPS read failure is not "no data"', () => {
  it('reports loading while the read is in flight', () => {
    expect(classifyBreadcrumbLoad({ loading: true, error: null, breadcrumbs: [] }).status)
      .toBe('loading');
  });

  it('reports an explicit failure instead of an empty trail', () => {
    const state = classifyBreadcrumbLoad({
      loading: false,
      error: new Error('Firestore permission denied'),
      breadcrumbs: [],
    });
    expect(state.status).toBe('failed');
    if (state.status === 'failed') {
      expect(state.message).toContain('permission denied');
    }
  });

  it('reports "empty" only when there really is no trail', () => {
    expect(
      classifyBreadcrumbLoad({ loading: false, error: null, breadcrumbs: [] }).status,
    ).toBe('empty');
  });

  it('reports the trail when it loaded', () => {
    const crumbs = [{ lat: 1, lng: 2, timestamp: NOW }];
    const state = classifyBreadcrumbLoad({ loading: false, error: null, breadcrumbs: crumbs });
    expect(state.status).toBe('loaded');
  });
});

describe('emergencySquad — general call reports its outcome', () => {
  it('reports success', () => {
    expect(describeGeneralCallOutcome(null)).toEqual({ kind: 'sent' });
  });

  it('reports a failure with a message the worker can read', () => {
    const outcome = describeGeneralCallOutcome(new Error('Firestore unavailable'));
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.message).toContain('Firestore');
  });

  it('reports a failure even for a non-Error rejection', () => {
    const outcome = describeGeneralCallOutcome('timeout');
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.message.length).toBeGreaterThan(0);
  });
});

describe('emergencySquad — elapsed time with a skewed clock', () => {
  it('never renders a negative age', () => {
    expect(formatElapsed(NOW + 3 * 60_000, NOW)).toBe('Ahora');
  });

  it('renders the sub-minute case', () => {
    expect(formatElapsed(NOW - 30_000, NOW)).toBe('Hace menos de 1 min');
  });

  it('renders exactly one minute', () => {
    expect(formatElapsed(NOW - 60_000, NOW)).toBe('Hace 1 min');
  });

  it('renders older entries', () => {
    expect(formatElapsed(NOW - 5 * 60_000, NOW)).toBe('Hace 5 min');
  });

  it('renders an unknown timestamp honestly', () => {
    expect(formatElapsed(Number.NaN, NOW)).toBe('Hora desconocida');
  });
});

describe('emergencySquad — BLE peers are filtered by freshness', () => {
  const peers = [
    { peerId: 'a', timestamp: NOW - 10_000 },
    { peerId: 'b', timestamp: NOW - 30 * 60_000 },
    { peerId: 'c', timestamp: NOW + 5_000 },
  ];

  it('drops peers older than the freshness window', () => {
    const fresh = filterFreshPeers(peers, 5 * 60_000, NOW);
    expect(fresh.map((p) => p.peerId)).toEqual(['a', 'c']);
  });

  it('keeps a peer seen just now', () => {
    expect(filterFreshPeers(peers, 60_000, NOW).map((p) => p.peerId)).toContain('a');
  });

  it('drops everything when no freshness window is given', () => {
    expect(filterFreshPeers(peers, 0, NOW)).toEqual([]);
  });

  it('drops a peer with a corrupt timestamp', () => {
    expect(
      filterFreshPeers([{ peerId: 'x', timestamp: Number.NaN }], 60_000, NOW),
    ).toEqual([]);
  });
});

describe('emergencySquad — breadcrumb order contract', () => {
  it('accepts a most-recent-first list', () => {
    const crumbs = [
      { lat: 1, lng: 1, timestamp: NOW },
      { lat: 2, lng: 2, timestamp: NOW - 60_000 },
    ];
    expect(() => assertBreadcrumbOrder(crumbs)).not.toThrow();
    expect(latestBreadcrumb(crumbs)?.lat).toBe(1);
  });

  it('rejects an ascending list', () => {
    const crumbs = [
      { lat: 1, lng: 1, timestamp: NOW - 60_000 },
      { lat: 2, lng: 2, timestamp: NOW },
    ];
    expect(() => assertBreadcrumbOrder(crumbs)).toThrow(/most-recent-first/);
  });

  it('returns null for an empty trail', () => {
    expect(latestBreadcrumb([])).toBeNull();
  });
});

describe('emergencySquad — training validity is shared with the service', () => {
  it('uses the same 365-day year as the brigade coverage rule', () => {
    const trained = Date.parse('2024-01-01T00:00:00.000Z');
    expect(trainingExpiresAtMs('2024-01-01T00:00:00.000Z', 1)).toBe(trained + TRAINING_YEAR_MS);
  });

  it('fails closed on an unparseable date', () => {
    expect(trainingExpiresAtMs('not-a-date', 2)).toBeNull();
    expect(isTrainingValid('not-a-date', 2, NOW)).toBe(false);
  });

  it('treats a capability inside the window as valid', () => {
    expect(isTrainingValid('2026-01-01T00:00:00.000Z', 2, NOW)).toBe(true);
  });

  it('treats an expired capability as invalid', () => {
    expect(isTrainingValid('2020-01-01T00:00:00.000Z', 2, NOW)).toBe(false);
  });

  it('is EXACTLY the service rule, not an approximation', () => {
    // The service has always used `Number.isNaN(trainedMs) || expiresMs < nowMs`.
    // The helper must reproduce that expression bit for bit, including the
    // NaN-window case — a "tightened" rule would silently change brigade
    // coverage, which is a separate decision.
    const original = (trainedAt: string, validYears: number, nowMs: number): boolean => {
      const trainedMs = Date.parse(trainedAt);
      const expiresMs = trainedMs + validYears * 365 * 86_400_000;
      return !(Number.isNaN(trainedMs) || expiresMs < nowMs);
    };
    const cases: Array<[string, number]> = [
      ['2026-01-01T00:00:00.000Z', 2],
      ['2020-01-01T00:00:00.000Z', 2],
      ['not-a-date', 2],
      ['2026-01-01T00:00:00.000Z', 0],
      ['2023-02-28T00:00:00.000Z', 4],
    ];
    for (const [trainedAt, years] of cases) {
      expect(isTrainingValid(trainedAt, years, NOW)).toBe(original(trainedAt, years, NOW));
    }
  });

  it('agrees with the UI label about the same date', () => {
    // The divergence: the UI used calendar years, the service 365-day years.
    const trainedAt = '2023-02-28T00:00:00.000Z';
    const validYears = 4;
    const serviceSaysValid = isTrainingValid(trainedAt, validYears, NOW);
    const ui = trainingState(trainedAt, validYears, NOW);
    const uiSaysValid = ui.tone === 'emerald';
    expect(uiSaysValid).toBe(serviceSaysValid);
  });

  it('labels an unparseable date as "sin fecha registrada"', () => {
    expect(trainingState('nope', 2, NOW)).toEqual({
      label: 'Capacitación sin fecha registrada',
      tone: 'amber',
    });
  });
});
