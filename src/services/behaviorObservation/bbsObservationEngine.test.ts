import { describe, it, expect } from 'vitest';
import {
  BbsValidationError,
  buildProfile,
  recordObservation,
  type BbsObservation,
  type RecordObservationInput,
} from './bbsObservationEngine.js';

const NOW = new Date('2026-05-12T08:00:00Z');

function obs(over: Partial<BbsObservation> = {}): BbsObservation {
  return {
    observationId: `o-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: 'tenant-a',
    areaId: 'area-1',
    category: 'epp',
    outcome: 'safe',
    note: 'Usaba arnés correctamente al trabajar en altura',
    observerUid: 'obs-1',
    observedAt: NOW.toISOString(),
    ...over,
  };
}

function recordInput(over: Partial<RecordObservationInput> = {}): RecordObservationInput {
  return {
    observationId: 'o-1',
    tenantId: 'tenant-a',
    areaId: 'area-1',
    category: 'epp',
    outcome: 'safe',
    note: 'Usaba arnés correctamente',
    observerUid: 'obs-1',
    now: NOW,
    ...over,
  };
}

describe('recordObservation', () => {
  it('crea observación válida con timestamp ISO', () => {
    const o = recordObservation(recordInput());
    expect(o.observationId).toBe('o-1');
    expect(o.observedAt).toBe(NOW.toISOString());
  });

  it('rechaza notas con RUT chileno', () => {
    expect(() =>
      recordObservation(recordInput({ note: 'El trabajador 12.345.678-9 no usó arnés' })),
    ).toThrow(BbsValidationError);
  });

  it('rechaza notas con honoríficos', () => {
    expect(() =>
      recordObservation(recordInput({ note: 'El Sr. Pérez no usó arnés en la faena' })),
    ).toThrow(BbsValidationError);
  });

  it('rechaza nota demasiado corta', () => {
    expect(() => recordObservation(recordInput({ note: 'ok' }))).toThrow(BbsValidationError);
  });

  it('exige tenantId y areaId', () => {
    expect(() => recordObservation(recordInput({ tenantId: '' }))).toThrow(BbsValidationError);
    expect(() => recordObservation(recordInput({ areaId: '   ' }))).toThrow(BbsValidationError);
  });
});

describe('buildProfile', () => {
  const start = new Date('2026-05-01T00:00:00Z');
  const end = new Date('2026-05-31T23:59:59Z');

  it('agrega stats globales y por categoría', () => {
    const observations = [
      obs({ outcome: 'safe', category: 'epp' }),
      obs({ outcome: 'safe', category: 'epp' }),
      obs({ outcome: 'at_risk', category: 'epp' }),
      obs({ outcome: 'at_risk', category: 'positioning' }),
      obs({ outcome: 'at_risk', category: 'positioning' }),
    ];
    const p = buildProfile({ tenantId: 'tenant-a', observations, windowStart: start, windowEnd: end });
    expect(p.totalObservations).toBe(5);
    expect(p.safePercentage).toBe(40);
    expect(p.byCategory.epp.total).toBe(3);
    expect(p.byCategory.epp.safePercentage).toBeCloseTo(66.7, 1);
    expect(p.byCategory.positioning.safePercentage).toBe(0);
  });

  it('marca focus en categorías con safePct < 70', () => {
    const observations = [
      obs({ category: 'epp', outcome: 'safe' }),
      obs({ category: 'epp', outcome: 'safe' }),
      obs({ category: 'positioning', outcome: 'at_risk' }),
      obs({ category: 'positioning', outcome: 'at_risk' }),
      obs({ category: 'positioning', outcome: 'safe' }),
    ];
    const p = buildProfile({ tenantId: 'tenant-a', observations, windowStart: start, windowEnd: end });
    expect(p.focusCategories).toContain('positioning');
    expect(p.focusCategories).not.toContain('epp');
  });

  it('aísla por tenant (multi-tenant isolation)', () => {
    const observations = [
      obs({ tenantId: 'tenant-a', outcome: 'safe' }),
      obs({ tenantId: 'tenant-b', outcome: 'at_risk' }),
      obs({ tenantId: 'tenant-b', outcome: 'at_risk' }),
    ];
    const p = buildProfile({ tenantId: 'tenant-a', observations, windowStart: start, windowEnd: end });
    expect(p.totalObservations).toBe(1);
    expect(p.safePercentage).toBe(100);
  });

  it('filtra observaciones fuera de la ventana', () => {
    const observations = [
      obs({ observedAt: '2026-04-15T00:00:00Z', outcome: 'at_risk' }),
      obs({ observedAt: NOW.toISOString(), outcome: 'safe' }),
    ];
    const p = buildProfile({ tenantId: 'tenant-a', observations, windowStart: start, windowEnd: end });
    expect(p.totalObservations).toBe(1);
  });

  it('topRiskAreas ordena por % at_risk', () => {
    const observations = [
      obs({ areaId: 'area-x', outcome: 'at_risk' }),
      obs({ areaId: 'area-x', outcome: 'at_risk' }),
      obs({ areaId: 'area-y', outcome: 'at_risk' }),
      obs({ areaId: 'area-y', outcome: 'safe' }),
      obs({ areaId: 'area-z', outcome: 'safe' }),
    ];
    const p = buildProfile({ tenantId: 'tenant-a', observations, windowStart: start, windowEnd: end });
    expect(p.topRiskAreas[0].areaId).toBe('area-x');
    expect(p.topRiskAreas[0].atRiskPct).toBe(100);
  });

  it('es determinista', () => {
    const observations = [obs(), obs({ outcome: 'at_risk' })];
    const a = buildProfile({ tenantId: 'tenant-a', observations, windowStart: start, windowEnd: end });
    const b = buildProfile({ tenantId: 'tenant-a', observations, windowStart: start, windowEnd: end });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('rechaza ventana invertida', () => {
    expect(() =>
      buildProfile({ tenantId: 'tenant-a', observations: [], windowStart: end, windowEnd: start }),
    ).toThrow(BbsValidationError);
  });
});
