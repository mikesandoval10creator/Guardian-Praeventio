// Praeventio Guard — manDownCorrelation pure-engine tests (TODO.md §16.2.1).
//
// TDD RED→GREEN for the multi-sensor anti-false-positive rule:
//   impact alone                                  → 'suspect' (normal countdown)
//   impact + sustained immobility                 → 'suspect' (higher confidence)
//   impact + immobility + (BLE off | batt crit)   → 'critical' (reduced countdown)
//
// The engine is a PURE function (repo rule #9): no side effects, no Firestore,
// deterministic for the same (events, now) input — mutation-testing ready.

import { describe, it, expect } from 'vitest';
import type { SensorReading } from './sensorBus';
import {
  evaluateManDownEvidence,
  LOCAL_DEVICE_UID,
  IMPACT_EVIDENCE_WINDOW_MS,
  IMMOBILITY_EVIDENCE_WINDOW_MS,
  BLE_EVIDENCE_WINDOW_MS,
  BATTERY_EVIDENCE_WINDOW_MS,
  MANDOWN_COUNTDOWN_DEFAULT_S,
  MANDOWN_COUNTDOWN_CRITICAL_S,
  REASON_IMPACT,
  REASON_IMMOBILITY,
  REASON_BLE_DISCONNECTED,
  REASON_BATTERY_CRITICAL,
} from './manDownCorrelation';

const NOW = new Date('2026-06-11T12:00:00Z');

function at(agoMs: number): string {
  return new Date(NOW.getTime() - agoMs).toISOString();
}

let seq = 0;
function reading(overrides: Partial<SensorReading>): SensorReading {
  seq += 1;
  return {
    readingId: `r-${seq}`,
    kind: 'fall',
    workerUid: 'w1',
    projectId: 'p1',
    severity: 'warning',
    at: at(0),
    ...overrides,
  };
}

const impact = (agoMs = 0, extra: Partial<SensorReading> = {}) =>
  reading({ kind: 'fall', severity: 'critical', at: at(agoMs), ...extra });
const immobility = (agoMs = 0, extra: Partial<SensorReading> = {}) =>
  reading({ kind: 'inactivity', severity: 'warning', at: at(agoMs), ...extra });
const bleOff = (agoMs = 0, extra: Partial<SensorReading> = {}) =>
  reading({ kind: 'ble_proximity', severity: 'warning', at: at(agoMs), ...extra });
const bleOk = (agoMs = 0, extra: Partial<SensorReading> = {}) =>
  reading({ kind: 'ble_proximity', severity: 'info', at: at(agoMs), ...extra });
const batteryCritical = (agoMs = 0, extra: Partial<SensorReading> = {}) =>
  reading({ kind: 'battery', severity: 'critical', at: at(agoMs), ...extra });
const batteryOk = (agoMs = 0, extra: Partial<SensorReading> = {}) =>
  reading({ kind: 'battery', severity: 'info', at: at(agoMs), ...extra });

describe('evaluateManDownEvidence — base levels', () => {
  it('no events → none with empty reasons', () => {
    expect(evaluateManDownEvidence([], NOW)).toEqual({ level: 'none', reasons: [] });
  });

  it('immobility + BLE off WITHOUT impact → none (engine is impact-anchored)', () => {
    const out = evaluateManDownEvidence([immobility(), bleOff()], NOW);
    expect(out).toEqual({ level: 'none', reasons: [] });
  });

  it('impact alone → suspect with impact reason only (normal countdown path)', () => {
    const out = evaluateManDownEvidence([impact()], NOW);
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT]);
  });

  it('impact + sustained immobility → still suspect but with the immobility reason (higher confidence)', () => {
    const out = evaluateManDownEvidence([impact(5_000), immobility()], NOW);
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_IMMOBILITY]);
  });

  it('impact + immobility + BLE disconnected → critical', () => {
    const out = evaluateManDownEvidence([impact(10_000), immobility(), bleOff(5_000)], NOW);
    expect(out.level).toBe('critical');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_IMMOBILITY, REASON_BLE_DISCONNECTED]);
  });

  it('impact + immobility + battery critical → critical', () => {
    const out = evaluateManDownEvidence([impact(10_000), immobility(), batteryCritical(60_000)], NOW);
    expect(out.level).toBe('critical');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_IMMOBILITY, REASON_BATTERY_CRITICAL]);
  });

  it('impact + immobility + BLE off + battery critical → critical with all four reasons', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(), bleOff(), batteryCritical()],
      NOW,
    );
    expect(out.level).toBe('critical');
    expect(out.reasons).toEqual([
      REASON_IMPACT,
      REASON_IMMOBILITY,
      REASON_BLE_DISCONNECTED,
      REASON_BATTERY_CRITICAL,
    ]);
  });

  it('impact + BLE off WITHOUT immobility → suspect (immobility is required for critical)', () => {
    const out = evaluateManDownEvidence([impact(), bleOff()], NOW);
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_BLE_DISCONNECTED]);
  });

  it('impact + battery critical WITHOUT immobility → suspect', () => {
    const out = evaluateManDownEvidence([impact(), batteryCritical()], NOW);
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_BATTERY_CRITICAL]);
  });

  it('impact + immobility + BLE connected OK (info) → suspect, BLE does not count as disconnection', () => {
    const out = evaluateManDownEvidence([impact(), immobility(), bleOk()], NOW);
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_IMMOBILITY]);
  });

  it('impact + immobility + battery warning (low, not critical) → suspect', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(), reading({ kind: 'battery', severity: 'warning' })],
      NOW,
    );
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_IMMOBILITY]);
  });
});

describe('evaluateManDownEvidence — time windows', () => {
  it('impact exactly at the window boundary still counts', () => {
    const out = evaluateManDownEvidence([impact(IMPACT_EVIDENCE_WINDOW_MS)], NOW);
    expect(out.level).toBe('suspect');
  });

  it('impact older than IMPACT_EVIDENCE_WINDOW_MS is stale → none', () => {
    const out = evaluateManDownEvidence([impact(IMPACT_EVIDENCE_WINDOW_MS + 1)], NOW);
    expect(out).toEqual({ level: 'none', reasons: [] });
  });

  it('immobility older than IMMOBILITY_EVIDENCE_WINDOW_MS does not raise confidence', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(IMMOBILITY_EVIDENCE_WINDOW_MS + 1)],
      NOW,
    );
    expect(out.reasons).toEqual([REASON_IMPACT]);
  });

  it('BLE disconnection older than BLE_EVIDENCE_WINDOW_MS is stale → no escalation', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(), bleOff(BLE_EVIDENCE_WINDOW_MS + 1)],
      NOW,
    );
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_IMMOBILITY]);
  });

  it('battery reading older than BATTERY_EVIDENCE_WINDOW_MS is stale → no escalation', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(), batteryCritical(BATTERY_EVIDENCE_WINDOW_MS + 1)],
      NOW,
    );
    expect(out.level).toBe('suspect');
  });

  it('future-dated events (clock skew) are ignored', () => {
    const future = impact(0, { at: new Date(NOW.getTime() + 5_000).toISOString() });
    expect(evaluateManDownEvidence([future], NOW)).toEqual({ level: 'none', reasons: [] });
  });

  it('events with an unparseable timestamp are ignored', () => {
    const broken = impact(0, { at: 'not-a-date' });
    expect(evaluateManDownEvidence([broken], NOW)).toEqual({ level: 'none', reasons: [] });
  });
});

describe('evaluateManDownEvidence — latest reading wins per kind', () => {
  it('BLE: old disconnection superseded by a newer connected-OK reading → no escalation', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(), bleOff(30_000), bleOk(1_000)],
      NOW,
    );
    expect(out.level).toBe('suspect');
    expect(out.reasons).toEqual([REASON_IMPACT, REASON_IMMOBILITY]);
  });

  it('BLE: old connected-OK superseded by a newer disconnection → critical', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(), bleOk(30_000), bleOff(1_000)],
      NOW,
    );
    expect(out.level).toBe('critical');
  });

  it('battery: old critical superseded by a newer healthy reading (charging) → no escalation', () => {
    const out = evaluateManDownEvidence(
      [impact(), immobility(), batteryCritical(120_000), batteryOk(1_000)],
      NOW,
    );
    expect(out.level).toBe('suspect');
  });
});

describe('evaluateManDownEvidence — worker scoping', () => {
  it("another worker's impact never escalates the local worker", () => {
    const out = evaluateManDownEvidence(
      [impact(0, { workerUid: 'w2' }), immobility(0, { workerUid: 'w1' })],
      NOW,
      { workerUid: 'w1' },
    );
    expect(out).toEqual({ level: 'none', reasons: [] });
  });

  it('device-scoped readings (LOCAL_DEVICE_UID) count for the local worker', () => {
    // BLE/battery publishers have no auth context — they publish under the
    // LOCAL_DEVICE_UID sentinel and must still correlate with the worker.
    const out = evaluateManDownEvidence(
      [
        impact(0, { workerUid: 'w1' }),
        immobility(0, { workerUid: 'w1' }),
        bleOff(0, { workerUid: LOCAL_DEVICE_UID }),
      ],
      NOW,
      { workerUid: 'w1' },
    );
    expect(out.level).toBe('critical');
  });

  it('without a workerUid filter, all readings are considered', () => {
    const out = evaluateManDownEvidence(
      [impact(0, { workerUid: 'w2' })],
      NOW,
    );
    expect(out.level).toBe('suspect');
  });
});

describe('evaluateManDownEvidence — purity & constants', () => {
  it('is deterministic and does not mutate its input', () => {
    const events = [impact(), immobility(), bleOff()];
    const snapshot = JSON.parse(JSON.stringify(events));
    const a = evaluateManDownEvidence(events, NOW);
    const b = evaluateManDownEvidence(events, NOW);
    expect(a).toEqual(b);
    expect(events).toEqual(snapshot);
  });

  it('order of input events does not change the verdict', () => {
    const events = [bleOff(), impact(), immobility()];
    const reversed = [...events].reverse();
    expect(evaluateManDownEvidence(events, NOW)).toEqual(
      evaluateManDownEvidence(reversed, NOW),
    );
  });

  it('critical countdown is strictly shorter than the default countdown', () => {
    expect(MANDOWN_COUNTDOWN_CRITICAL_S).toBeLessThan(MANDOWN_COUNTDOWN_DEFAULT_S);
    expect(MANDOWN_COUNTDOWN_CRITICAL_S).toBeGreaterThan(0);
  });
});
