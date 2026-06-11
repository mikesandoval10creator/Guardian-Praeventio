// Praeventio Guard — gasGate engine spec (arista C3: telemetría→bloqueo operacional).
//
// TDD RED (2026-06-11): the HMAC telemetry ingest exists and gas sensors
// report, but a gas reading over threshold in a zone had ZERO operational
// consequence — a confined-space permit for that zone could still be signed.
// This pure engine (CLAUDE.md #9: no side effects, no Firestore) takes the
// recent telemetry readings of the permit's zone and computes a SOFT-block
// verdict: { blocked, reasons[], worstReadings }. The route layer decides what
// to do with it (409 on sign, advisory on validate, supervisor override).
//
// Threshold reuse: the O₂ 19.5–23.5 % and LEL 10 %/5 % tables are the SAME
// constants `criticalPermitValidators.ts` applies to declared pre-entry
// measurements (DS 594 + MINSAL). No duplicated magic numbers.
//
// Fail-open on missing data (mirrors weatherGate): stale or absent telemetry
// must NEVER block work by itself — it yields an es-CL note so the supervisor
// knows the automatic verification did not run.

import { describe, it, expect } from 'vitest';
import {
  classifyGasMetric,
  evaluateGasTelemetry,
  GAS_TELEMETRY_WINDOW_MS,
  GAS_TELEMETRY_FUTURE_SKEW_MS,
  GAS_NO_TELEMETRY_NOTE_ES,
  type GasTelemetryReading,
} from './gasGate.js';
import {
  GAS_OXYGEN_MIN_PCT,
  GAS_OXYGEN_MAX_PCT,
  GAS_LEL_BLOCKING_PCT,
  GAS_LEL_ADVISORY_PCT,
} from './criticalPermitValidators.js';

const NOW = Date.parse('2026-06-11T12:00:00.000Z');

function reading(
  metric: string,
  value: number,
  ageMs = 60_000,
  extra: Partial<GasTelemetryReading> = {},
): GasTelemetryReading {
  return { metric, value, unit: '%', timestampMs: NOW - ageMs, source: 'gs-01', ...extra };
}

describe('classifyGasMetric', () => {
  it('recognises oxygen metric spellings', () => {
    expect(classifyGasMetric('o2_pct')).toBe('oxygen_pct');
    expect(classifyGasMetric('oxygen_pct')).toBe('oxygen_pct');
    expect(classifyGasMetric('gas_o2_pct')).toBe('oxygen_pct');
    expect(classifyGasMetric('O2')).toBe('oxygen_pct');
  });

  it('recognises LEL metric spellings', () => {
    expect(classifyGasMetric('lel_pct')).toBe('lel_pct');
    expect(classifyGasMetric('gas_lel_pct')).toBe('lel_pct');
    expect(classifyGasMetric('LEL')).toBe('lel_pct');
  });

  it('returns null for metrics without a verified threshold table (CO/H₂S pending)', () => {
    expect(classifyGasMetric('gas_co_ppm')).toBeNull();
    expect(classifyGasMetric('h2s_ppm')).toBeNull();
    expect(classifyGasMetric('temperature_c')).toBeNull();
    expect(classifyGasMetric('heart_rate_bpm')).toBeNull();
  });
});

describe('evaluateGasTelemetry — thresholds (same table as criticalPermitValidators)', () => {
  it('O₂ below the minimum → blocked with GAS_OXYGEN_LOW', () => {
    const r = evaluateGasTelemetry([reading('o2_pct', 18.0)], NOW);
    expect(r.blocked).toBe(true);
    expect(r.reasons.map((i) => i.code)).toContain('GAS_OXYGEN_LOW');
    expect(r.reasons.find((i) => i.code === 'GAS_OXYGEN_LOW')?.severity).toBe('blocking');
    expect(r.worstReadings.oxygenLow?.value).toBe(18.0);
    expect(r.note).toBeUndefined();
  });

  it('O₂ above the maximum (over-oxygenated) → blocked with GAS_OXYGEN_HIGH', () => {
    const r = evaluateGasTelemetry([reading('oxygen_pct', 24.1)], NOW);
    expect(r.blocked).toBe(true);
    expect(r.reasons.map((i) => i.code)).toContain('GAS_OXYGEN_HIGH');
    expect(r.worstReadings.oxygenHigh?.value).toBe(24.1);
  });

  it('O₂ in range → not blocked, no reasons', () => {
    const r = evaluateGasTelemetry([reading('o2_pct', 20.9)], NOW);
    expect(r.blocked).toBe(false);
    expect(r.reasons).toEqual([]);
    expect(r.freshReadingCount).toBe(1);
  });

  it(`O₂ exactly at the boundaries (${GAS_OXYGEN_MIN_PCT} / ${GAS_OXYGEN_MAX_PCT}) is still safe`, () => {
    expect(evaluateGasTelemetry([reading('o2_pct', GAS_OXYGEN_MIN_PCT)], NOW).blocked).toBe(false);
    expect(evaluateGasTelemetry([reading('o2_pct', GAS_OXYGEN_MAX_PCT)], NOW).blocked).toBe(false);
  });

  it(`LEL ≥ ${GAS_LEL_BLOCKING_PCT}% → blocked with GAS_LEL_HIGH (boundary inclusive)`, () => {
    const r = evaluateGasTelemetry([reading('lel_pct', GAS_LEL_BLOCKING_PCT)], NOW);
    expect(r.blocked).toBe(true);
    expect(r.reasons.map((i) => i.code)).toContain('GAS_LEL_HIGH');
    expect(r.worstReadings.lel?.value).toBe(GAS_LEL_BLOCKING_PCT);
  });

  it(`LEL in [${GAS_LEL_ADVISORY_PCT}, ${GAS_LEL_BLOCKING_PCT}) → advisory only, NOT blocked`, () => {
    const r = evaluateGasTelemetry([reading('lel_pct', 7)], NOW);
    expect(r.blocked).toBe(false);
    const adv = r.reasons.find((i) => i.code === 'GAS_LEL_ELEVATED');
    expect(adv?.severity).toBe('advisory');
  });

  it('LEL well below the advisory threshold → clean', () => {
    const r = evaluateGasTelemetry([reading('lel_pct', 2)], NOW);
    expect(r.blocked).toBe(false);
    expect(r.reasons).toEqual([]);
  });
});

describe('evaluateGasTelemetry — multiple readings, worst wins', () => {
  it('one bad O₂ reading among normals still blocks (min wins)', () => {
    const r = evaluateGasTelemetry(
      [reading('o2_pct', 20.9, 30_000), reading('o2_pct', 18.2, 120_000), reading('o2_pct', 21.0, 60_000)],
      NOW,
    );
    expect(r.blocked).toBe(true);
    expect(r.worstReadings.oxygenLow?.value).toBe(18.2);
    expect(r.freshReadingCount).toBe(3);
  });

  it('one bad LEL reading among normals still blocks (max wins)', () => {
    const r = evaluateGasTelemetry(
      [reading('lel_pct', 1, 30_000), reading('lel_pct', 15, 600_000), reading('lel_pct', 3, 60_000)],
      NOW,
    );
    expect(r.blocked).toBe(true);
    expect(r.worstReadings.lel?.value).toBe(15);
  });

  it('O₂ and LEL violations both surface in reasons', () => {
    const r = evaluateGasTelemetry([reading('o2_pct', 17), reading('lel_pct', 12)], NOW);
    const codes = r.reasons.map((i) => i.code);
    expect(codes).toContain('GAS_OXYGEN_LOW');
    expect(codes).toContain('GAS_LEL_HIGH');
  });
});

describe('evaluateGasTelemetry — stale / absent data NEVER blocks (fail-open + note)', () => {
  it('empty reading set → not blocked + es-CL note', () => {
    const r = evaluateGasTelemetry([], NOW);
    expect(r.blocked).toBe(false);
    expect(r.reasons).toEqual([]);
    expect(r.freshReadingCount).toBe(0);
    expect(r.note).toBe(GAS_NO_TELEMETRY_NOTE_ES);
  });

  it('only stale readings (outside the window) → ignored even if catastrophic', () => {
    const stale = reading('lel_pct', 50, GAS_TELEMETRY_WINDOW_MS + 60_000);
    const r = evaluateGasTelemetry([stale], NOW);
    expect(r.blocked).toBe(false);
    expect(r.freshReadingCount).toBe(0);
    expect(r.note).toBe(GAS_NO_TELEMETRY_NOTE_ES);
  });

  it('readings too far in the future (clock skew abuse) are ignored', () => {
    const future = reading('lel_pct', 50, -(GAS_TELEMETRY_FUTURE_SKEW_MS + 60_000));
    const r = evaluateGasTelemetry([future], NOW);
    expect(r.blocked).toBe(false);
    expect(r.note).toBe(GAS_NO_TELEMETRY_NOTE_ES);
  });

  it('fresh-normal + stale-bad → not blocked and NO note (fresh data exists)', () => {
    const r = evaluateGasTelemetry(
      [reading('o2_pct', 20.9, 60_000), reading('o2_pct', 12, GAS_TELEMETRY_WINDOW_MS + 60_000)],
      NOW,
    );
    expect(r.blocked).toBe(false);
    expect(r.note).toBeUndefined();
    expect(r.freshReadingCount).toBe(1);
  });

  it('non-finite values and unrecognised metrics are discarded', () => {
    const r = evaluateGasTelemetry(
      [
        reading('o2_pct', Number.NaN),
        reading('gas_co_ppm', 500), // no verified table yet → ignored
        { metric: 'lel_pct', value: 50, timestampMs: Number.NaN },
      ],
      NOW,
    );
    expect(r.blocked).toBe(false);
    expect(r.freshReadingCount).toBe(0);
    expect(r.note).toBe(GAS_NO_TELEMETRY_NOTE_ES);
  });
});

describe('evaluateGasTelemetry — purity', () => {
  it('is deterministic and does not mutate its input', () => {
    const input = [reading('o2_pct', 18), reading('lel_pct', 7)];
    const snapshot = JSON.parse(JSON.stringify(input));
    const a = evaluateGasTelemetry(input, NOW);
    const b = evaluateGasTelemetry(input, NOW);
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
  });

  it('respects a custom window', () => {
    const r5 = evaluateGasTelemetry([reading('lel_pct', 15, 10 * 60_000)], NOW, 5 * 60_000);
    expect(r5.blocked).toBe(false); // 10 min old > 5 min window
    const r15 = evaluateGasTelemetry([reading('lel_pct', 15, 10 * 60_000)], NOW);
    expect(r15.blocked).toBe(true); // default 15 min window
  });
});
