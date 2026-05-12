import { describe, it, expect } from 'vitest';
import {
  checkInstrumentExpiration,
  computeUsageStats,
  validateMeasurementChain,
  buildQualityReport,
  type MeasurementInstrument,
  type MeasurementChainEntry,
} from './measurementChain.js';

function instrument(over: Partial<MeasurementInstrument> = {}): MeasurementInstrument {
  return {
    id: 'i1',
    kind: 'sonometer',
    brand: 'CEM',
    model: 'DT-8852',
    serialNumber: 'SN-0001',
    calibratedAt: '2026-01-01T00:00:00Z',
    calibratedUntil: '2027-01-01T00:00:00Z',
    certificateUrl: 'https://storage/cert.pdf',
    custodianUid: 'tech1',
    status: 'operativo',
    ...over,
  };
}

describe('checkInstrumentExpiration', () => {
  it('calibración vigente lejos → no expiresSoon', () => {
    const r = checkInstrumentExpiration(instrument(), '2026-05-11T00:00:00Z');
    expect(r.isExpired).toBe(false);
    expect(r.expiresSoon).toBe(false);
    expect(r.blockUse).toBe(false);
  });

  it('vence en 20d → expiresSoon', () => {
    const r = checkInstrumentExpiration(
      instrument({ calibratedUntil: '2026-05-31T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.expiresSoon).toBe(true);
    expect(r.blockUse).toBe(false);
  });

  it('vencida → blockUse', () => {
    const r = checkInstrumentExpiration(
      instrument({ calibratedUntil: '2026-04-01T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.isExpired).toBe(true);
    expect(r.blockUse).toBe(true);
    expect(r.daysUntilExpiration).toBeLessThan(0);
  });

  it('status retirado → bloqueado aunque vigente', () => {
    const r = checkInstrumentExpiration(instrument({ status: 'retirado' }), '2026-05-11T00:00:00Z');
    expect(r.blockUse).toBe(true);
    expect(r.message).toMatch(/RETIRADO/);
  });
});

describe('computeUsageStats', () => {
  it('cuenta usos totales + únicos operadores + último', () => {
    const log = [
      { instrumentId: 'i1', operatorUid: 'op1', measurementId: 'm1', usedAt: '2026-05-09T10:00:00Z', purpose: 'ruido A' },
      { instrumentId: 'i1', operatorUid: 'op1', measurementId: 'm2', usedAt: '2026-05-10T10:00:00Z', purpose: 'ruido B' },
      { instrumentId: 'i1', operatorUid: 'op2', measurementId: 'm3', usedAt: '2026-05-11T10:00:00Z', purpose: 'ruido C' },
      { instrumentId: 'i2', operatorUid: 'op1', measurementId: 'm4', usedAt: '2026-05-11T11:00:00Z', purpose: 'lux X' },
    ];
    const stats = computeUsageStats('i1', log);
    expect(stats.totalUses).toBe(3);
    expect(stats.uniqueOperators).toBe(2);
    expect(stats.lastUsedAt).toBe('2026-05-11T10:00:00Z');
    expect(stats.byOperator[0].operatorUid).toBe('op1');
    expect(stats.byOperator[0].count).toBe(2);
  });
});

describe('validateMeasurementChain', () => {
  function entry(over: Partial<MeasurementChainEntry> = {}): MeasurementChainEntry {
    return {
      measurementId: 'm1',
      takenAt: '2026-05-11T10:00:00Z',
      instrument: instrument(),
      operatorUid: 'op1',
      normReference: 'DS 594 art. 75',
      context: { location: 'Sector A' },
      ...over,
    };
  }

  it('cadena completa → válida', () => {
    const r = validateMeasurementChain(entry());
    expect(r.isValid).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('rechaza si instrumento vencido al momento de la toma', () => {
    const r = validateMeasurementChain(
      entry({
        instrument: instrument({ calibratedUntil: '2026-04-01T00:00:00Z' }),
      }),
    );
    expect(r.isValid).toBe(false);
    expect(r.failures.some((f) => /vencida/i.test(f))).toBe(true);
  });

  it('rechaza si falta certificateUrl', () => {
    const r = validateMeasurementChain(
      entry({ instrument: instrument({ certificateUrl: undefined }) }),
    );
    expect(r.isValid).toBe(false);
  });

  it('rechaza si norm reference vacía', () => {
    const r = validateMeasurementChain(entry({ normReference: '' }));
    expect(r.isValid).toBe(false);
  });

  it('warning si instrumento por vencer (no bloquea)', () => {
    const r = validateMeasurementChain(
      entry({
        instrument: instrument({ calibratedUntil: '2026-05-31T00:00:00Z' }),
      }),
    );
    expect(r.isValid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('WBGT sin temperatura → warning', () => {
    const r = validateMeasurementChain(
      entry({
        instrument: instrument({ kind: 'wbgt_meter' }),
        context: { location: 'Sector A' },
      }),
    );
    expect(r.warnings.some((w) => /temperatura/i.test(w))).toBe(true);
  });
});

describe('buildQualityReport', () => {
  it('100% válidas → score 100', () => {
    const r = buildQualityReport([
      { measurementId: 'm1', isValid: true, failures: [], warnings: [] },
      { measurementId: 'm2', isValid: true, failures: [], warnings: [] },
    ]);
    expect(r.qualityScore).toBe(100);
    expect(r.invalid).toBe(0);
  });

  it('mix válidas/inválidas con warnings', () => {
    const r = buildQualityReport([
      { measurementId: 'm1', isValid: true, failures: [], warnings: ['x'] },
      { measurementId: 'm2', isValid: false, failures: ['Instrumento i1 vencido'], warnings: [] },
      { measurementId: 'm3', isValid: false, failures: ['Medición sin norma'], warnings: [] },
    ]);
    expect(r.total).toBe(3);
    expect(r.valid).toBe(1);
    expect(r.invalid).toBe(2);
    expect(r.withWarnings).toBe(1);
    expect(r.qualityScore).toBe(33);
    expect(Object.keys(r.failureBreakdown).length).toBeGreaterThanOrEqual(2);
  });
});
