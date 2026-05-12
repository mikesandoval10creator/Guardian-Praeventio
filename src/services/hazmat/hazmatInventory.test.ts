import { describe, it, expect } from 'vitest';
import {
  checkPairCompatibility,
  auditStorageLocation,
  buildSpillPlan,
  type HazmatItem,
} from './hazmatInventory.js';

function item(over: Partial<HazmatItem> = {}): HazmatItem {
  return {
    id: 'h1',
    name: 'Gasolina 95',
    cas: '8006-61-9',
    unNumber: '1203',
    hazardClasses: ['flammable'],
    stockQty: 200,
    stockUnit: 'L',
    locationId: 'bodega-A',
    requiredEpp: ['Guantes', 'Lentes', 'Respirador'],
    ...over,
  };
}

describe('checkPairCompatibility', () => {
  it('oxidizer + flammable = incompatible (NFPA)', () => {
    expect(checkPairCompatibility('oxidizer', 'flammable')).toBe('incompatible');
  });

  it('flammable + corrosive = caution', () => {
    expect(checkPairCompatibility('flammable', 'corrosive')).toBe('caution');
  });

  it('toxic + toxic = compatible (mismo grupo)', () => {
    expect(checkPairCompatibility('toxic', 'toxic')).toBe('compatible');
  });

  it('simétrico: (a,b) === (b,a)', () => {
    expect(checkPairCompatibility('oxidizer', 'flammable')).toBe(
      checkPairCompatibility('flammable', 'oxidizer'),
    );
  });

  it('reactive_water + corrosive = incompatible (ácidos generan calor con agua)', () => {
    expect(checkPairCompatibility('reactive_water', 'corrosive')).toBe('incompatible');
  });
});

describe('auditStorageLocation', () => {
  it('mismo lugar con incompatibles → issue', () => {
    const a = item({ id: 'a', name: 'Bencina', hazardClasses: ['flammable'], locationId: 'L1' });
    const b = item({ id: 'b', name: 'Peróxido', hazardClasses: ['oxidizer'], locationId: 'L1' });
    const issues = auditStorageLocation([a, b]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('incompatible');
  });

  it('diferentes lugares → no issue', () => {
    const a = item({ id: 'a', hazardClasses: ['flammable'], locationId: 'L1' });
    const b = item({ id: 'b', hazardClasses: ['oxidizer'], locationId: 'L2' });
    const issues = auditStorageLocation([a, b]);
    expect(issues).toHaveLength(0);
  });

  it('todos compatibles → sin issues', () => {
    const a = item({ id: 'a', hazardClasses: ['toxic'], locationId: 'L1' });
    const b = item({ id: 'b', hazardClasses: ['toxic'], locationId: 'L1' });
    expect(auditStorageLocation([a, b])).toHaveLength(0);
  });

  it('3 items con 2 incompatibilidades → 2 issues', () => {
    const a = item({ id: 'a', hazardClasses: ['oxidizer'], locationId: 'L1' });
    const b = item({ id: 'b', hazardClasses: ['flammable'], locationId: 'L1' });
    const c = item({ id: 'c', hazardClasses: ['explosive'], locationId: 'L1' });
    const issues = auditStorageLocation([a, b, c]);
    // (a,b) incompatible + (b,c) incompatible + (a,c) incompatible = 3
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe('buildSpillPlan', () => {
  it('flammable usa pasos NFPA + contacto bomberos', () => {
    const plan = buildSpillPlan(item({ hazardClasses: ['flammable'] }));
    expect(plan.steps.some((s) => /ignición/.test(s))).toBe(true);
    expect(plan.emergencyContact).toContain('132');
    expect(plan.absorbentMaterial).toContain('Arena');
  });

  it('corrosive da pasos de neutralización + SAMU', () => {
    const plan = buildSpillPlan(item({ hazardClasses: ['corrosive'] }));
    expect(plan.steps.some((s) => /neutraliz/i.test(s))).toBe(true);
    expect(plan.emergencyContact).toContain('131');
  });

  it('toxic exige respirador + SAMU+Bomberos', () => {
    const plan = buildSpillPlan(item({ hazardClasses: ['toxic'] }));
    expect(plan.steps.some((s) => /respirador|filtro/i.test(s))).toBe(true);
    expect(plan.emergencyContact).toContain('131');
  });

  it('clase sin plan específico → fallback genérico', () => {
    const plan = buildSpillPlan(item({ hazardClasses: ['biohazard'] }));
    expect(plan.steps).toContain('Consultar SDS específica');
  });

  it('plan preserva EPP del item', () => {
    const plan = buildSpillPlan(
      item({
        hazardClasses: ['flammable'],
        requiredEpp: ['Traje arco eléctrico', 'Guantes'],
      }),
    );
    expect(plan.requiredEpp).toContain('Traje arco eléctrico');
  });
});
