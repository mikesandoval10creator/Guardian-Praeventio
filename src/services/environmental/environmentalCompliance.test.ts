import { describe, it, expect } from 'vitest';
import {
  buildWasteInventoryReport,
  validateManifest,
  computeFootprint,
  detectPermitExpirations,
  decideAlertAction,
  type WasteRecord,
  type WasteManifest,
} from './environmentalCompliance.js';

function waste(over: Partial<WasteRecord> & { id: string }): WasteRecord {
  return {
    id: over.id,
    kind: over.kind ?? 'hazardous',
    description: 'd',
    quantityKg: over.quantityKg ?? 10,
    generatedAt: '2026-05-11T10:00:00Z',
    storageLocation: 'bodega1',
    manifestId: over.manifestId,
  };
}

describe('buildWasteInventoryReport', () => {
  it('agrupa por kind + cuenta inStock/dispatched', () => {
    const r = buildWasteInventoryReport([
      waste({ id: 'w1', kind: 'hazardous', quantityKg: 50 }),
      waste({ id: 'w2', kind: 'hazardous', quantityKg: 30, manifestId: 'm1' }),
      waste({ id: 'w3', kind: 'recyclable', quantityKg: 100 }),
    ]);
    expect(r.totalQuantityKg).toBe(180);
    expect(r.byKind.hazardous.count).toBe(2);
    expect(r.byKind.hazardous.totalKg).toBe(80);
    expect(r.inStock).toBe(2);
    expect(r.dispatched).toBe(1);
  });
});

describe('validateManifest', () => {
  const authorizedTrans = new Set(['T-AUTH']);
  const authorizedRecv = new Set(['R-AUTH']);

  it('manifest válido pasa', () => {
    const m: WasteManifest = {
      id: 'm1',
      wasteIds: ['w1'],
      transporterId: 'T-AUTH',
      receiverId: 'R-AUTH',
      dispatchedAt: '2026-05-11T10:00:00Z',
      hasDiscrepancy: false,
    };
    const r = validateManifest(m, [waste({ id: 'w1' })], authorizedTrans, authorizedRecv);
    expect(r.isValid).toBe(true);
  });

  it('transportista no autorizado → issue', () => {
    const m: WasteManifest = {
      id: 'm1',
      wasteIds: ['w1'],
      transporterId: 'T-NOAUTH',
      receiverId: 'R-AUTH',
      dispatchedAt: 't',
      hasDiscrepancy: false,
    };
    const r = validateManifest(m, [waste({ id: 'w1' })], authorizedTrans, authorizedRecv);
    expect(r.issues.some((i) => /Transportista/.test(i))).toBe(true);
  });

  it('waste id inexistente → issue', () => {
    const m: WasteManifest = {
      id: 'm1',
      wasteIds: ['w1', 'w-ghost'],
      transporterId: 'T-AUTH',
      receiverId: 'R-AUTH',
      dispatchedAt: 't',
      hasDiscrepancy: false,
    };
    const r = validateManifest(m, [waste({ id: 'w1' })], authorizedTrans, authorizedRecv);
    expect(r.issues.some((i) => /residuos/.test(i))).toBe(true);
  });
});

describe('computeFootprint', () => {
  it('co2 = electricidad×0.42 + diesel×2.68', () => {
    const r = computeFootprint({
      electricityKwh: 1000,
      fuelLiters: 100,
      waterM3: 50,
      totalWasteKg: 200,
      hazardousWasteKg: 50,
    });
    expect(r.co2EquivKg).toBeCloseTo(1000 * 0.42 + 100 * 2.68, 1);
    expect(r.hazardousPercent).toBe(25);
  });

  it('cero electricidad → wasteIntensity=0', () => {
    const r = computeFootprint({
      electricityKwh: 0,
      fuelLiters: 0,
      waterM3: 0,
      totalWasteKg: 100,
      hazardousWasteKg: 0,
    });
    expect(r.wasteIntensityKgPerKwh).toBe(0);
  });
});

describe('detectPermitExpirations', () => {
  it('filtra solo permisos vencen en daysAhead', () => {
    const r = detectPermitExpirations(
      [
        {
          id: 'p1',
          kind: 'RCA',
          issuedAt: '2024-01-01',
          expiresAt: '2026-06-01T00:00:00Z',
          reference: 'r1',
        },
        {
          id: 'p2',
          kind: 'DIA',
          issuedAt: '2025-01-01',
          expiresAt: '2027-01-01T00:00:00Z',
          reference: 'r2',
        },
      ],
      60,
      '2026-05-11T00:00:00Z',
    );
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('p1');
  });
});

describe('decideAlertAction', () => {
  it('emergency → evacuate', () => {
    const r = decideAlertAction({ kind: 'fire_proximity', severity: 'emergency' });
    expect(r.recommended).toBe('evacuate');
  });

  it('warning + fuego < 5km → evacuate', () => {
    const r = decideAlertAction({
      kind: 'fire_proximity',
      severity: 'warning',
      distanceKm: 3,
    });
    expect(r.recommended).toBe('evacuate');
  });

  it('watch → increase_protection', () => {
    const r = decideAlertAction({ kind: 'air_quality_low', severity: 'watch' });
    expect(r.recommended).toBe('increase_protection');
  });
});
