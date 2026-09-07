import { describe, it, expect } from 'vitest';
import {
  computeCenterOfGravity,
  validateCogAgainstLimits,
  computeUtilization,
  packCargoFFD,
  type CargoItem,
  type Container,
} from './stowageOptimizer.js';

describe('computeCenterOfGravity', () => {
  it('item único: COG = centroide del item', () => {
    const cog = computeCenterOfGravity([
      {
        item: { id: 'a', dimensions: { x: 2, y: 2, z: 2 }, mass: 100 },
        position: { x: 0, y: 0, z: 0 },
      },
    ]);
    expect(cog).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('dos items simétricos: COG entre ellos', () => {
    const cog = computeCenterOfGravity([
      {
        item: { id: 'a', dimensions: { x: 1, y: 1, z: 1 }, mass: 100 },
        position: { x: 0, y: 0, z: 0 },
      },
      {
        item: { id: 'b', dimensions: { x: 1, y: 1, z: 1 }, mass: 100 },
        position: { x: 4, y: 0, z: 0 },
      },
    ]);
    // centroides 0.5 y 4.5, masas iguales → 2.5
    expect(cog.x).toBeCloseTo(2.5, 5);
  });

  it('peso asimétrico desplaza COG hacia el item más pesado', () => {
    const cog = computeCenterOfGravity([
      {
        item: { id: 'a', dimensions: { x: 1, y: 1, z: 1 }, mass: 100 },
        position: { x: 0, y: 0, z: 0 },
      },
      {
        item: { id: 'b', dimensions: { x: 1, y: 1, z: 1 }, mass: 900 },
        position: { x: 4, y: 0, z: 0 },
      },
    ]);
    // centroides 0.5 y 4.5, masas 100+900=1000 → (50+4050)/1000 = 4.1
    expect(cog.x).toBeCloseTo(4.1, 5);
  });

  it('masa total 0 → COG (0,0,0)', () => {
    expect(computeCenterOfGravity([])).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('validateCogAgainstLimits', () => {
  const limits = {
    ideal: { x: 5, y: 2, z: 0 },
    toleranceX: 1,
    toleranceY: 0.5,
    maxHeightZ: 2,
  };

  it('COG dentro de tolerancia → isSafe true', () => {
    const r = validateCogAgainstLimits(
      [
        {
          item: { id: 'a', dimensions: { x: 2, y: 2, z: 2 }, mass: 1000 },
          position: { x: 4, y: 1, z: 0 },
        },
      ],
      limits,
    );
    expect(r.isSafe).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it('warning si X fuera de tolerancia', () => {
    const r = validateCogAgainstLimits(
      [
        {
          item: { id: 'a', dimensions: { x: 1, y: 1, z: 1 }, mass: 1000 },
          position: { x: 0, y: 1.5, z: 0 },
        },
      ],
      limits,
    );
    expect(r.isSafe).toBe(false);
    expect(r.warnings.some((w) => /eje X/.test(w))).toBe(true);
  });

  it('warning si COG demasiado alto', () => {
    const r = validateCogAgainstLimits(
      [
        {
          item: { id: 'a', dimensions: { x: 1, y: 1, z: 1 }, mass: 1000 },
          position: { x: 4.5, y: 1.5, z: 3 },
        },
      ],
      limits,
    );
    expect(r.warnings.some((w) => /alto/.test(w))).toBe(true);
  });
});

describe('computeUtilization', () => {
  const container: Container = {
    dimensions: { x: 10, y: 4, z: 3 },
    maxPayloadKg: 5000,
  };

  it('contenedor vacío → 0%', () => {
    const u = computeUtilization([], container);
    expect(u.volumePercent).toBe(0);
    expect(u.massPercent).toBe(0);
    expect(u.overweight).toBe(false);
  });

  it('items dentro de capacidad', () => {
    const u = computeUtilization(
      [
        {
          item: { id: 'a', dimensions: { x: 2, y: 2, z: 2 }, mass: 2000 },
          position: { x: 0, y: 0, z: 0 },
        },
      ],
      container,
    );
    expect(u.volumePercent).toBeGreaterThan(0);
    expect(u.massPercent).toBe(40);
    expect(u.overweight).toBe(false);
  });

  it('flag overweight si masa > maxPayload', () => {
    const u = computeUtilization(
      [
        {
          item: { id: 'a', dimensions: { x: 1, y: 1, z: 1 }, mass: 6000 },
          position: { x: 0, y: 0, z: 0 },
        },
      ],
      container,
    );
    expect(u.overweight).toBe(true);
  });
});

describe('packCargoFFD', () => {
  const container: Container = {
    dimensions: { x: 10, y: 4, z: 3 },
    maxPayloadKg: 50000,
  };

  it('coloca todos los items pequeños sin solapar', () => {
    const items: CargoItem[] = Array.from({ length: 6 }, (_, i) => ({
      id: `box-${i}`,
      dimensions: { x: 1, y: 1, z: 1 },
      mass: 100,
    }));
    const r = packCargoFFD(items, container);
    expect(r.placed).toHaveLength(6);
    expect(r.unplaced).toHaveLength(0);
  });

  it('ítem demasiado grande queda en unplaced', () => {
    const items: CargoItem[] = [
      {
        id: 'too-big',
        dimensions: { x: 12, y: 1, z: 1 },
        mass: 100,
      },
    ];
    const r = packCargoFFD(items, container);
    expect(r.unplaced).toHaveLength(1);
  });

  it('respeta cannotBeStacked: no usa z>0', () => {
    const items: CargoItem[] = [
      {
        id: 'pallet',
        dimensions: { x: 1, y: 1, z: 1 },
        mass: 50,
        cannotBeStacked: true,
      },
    ];
    const r = packCargoFFD(items, container);
    expect(r.placed[0].position.z).toBe(0);
  });

  it('items colocados no se intersectan', () => {
    const items: CargoItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `b-${i}`,
      dimensions: { x: 1.5, y: 1.5, z: 1 },
      mass: 50,
    }));
    const r = packCargoFFD(items, container);
    // Validar no-overlap pairwise
    for (let i = 0; i < r.placed.length; i++) {
      for (let j = i + 1; j < r.placed.length; j++) {
        const a = r.placed[i];
        const b = r.placed[j];
        const overlap =
          a.position.x < b.position.x + b.item.dimensions.x &&
          a.position.x + a.item.dimensions.x > b.position.x &&
          a.position.y < b.position.y + b.item.dimensions.y &&
          a.position.y + a.item.dimensions.y > b.position.y &&
          a.position.z < b.position.z + b.item.dimensions.z &&
          a.position.z + a.item.dimensions.z > b.position.z;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('runtime cargo validation', () => {
  const container: Container = {
    dimensions: { x: 10, y: 4, z: 3 },
    maxPayloadKg: 5000,
  };
  const limits = {
    ideal: { x: 5, y: 2, z: 0 },
    toleranceX: 1,
    toleranceY: 0.5,
    maxHeightZ: 2,
  };
  const position = { x: 0, y: 0, z: 0 };

  it.each([
    ['NaN mass', { id: 'bad-mass', dimensions: { x: 1, y: 1, z: 1 }, mass: Number.NaN }],
    ['infinite mass', { id: 'infinite-mass', dimensions: { x: 1, y: 1, z: 1 }, mass: Number.POSITIVE_INFINITY }],
    ['negative dimension', { id: 'negative-dim', dimensions: { x: -1, y: 1, z: 1 }, mass: 10 }],
    ['infinite position', { id: 'infinite-position', dimensions: { x: 1, y: 1, z: 1 }, mass: 10, position: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } }],
  ])('rejects %s at the runtime boundary', (_label, rawItem) => {
    const item = rawItem as CargoItem & { position?: typeof position };
    const placed = [{ item, position: item.position ?? position }];
    expect(() => computeCenterOfGravity(placed)).toThrow(RangeError);
    expect(() => computeUtilization(placed, container)).toThrow(RangeError);
    if (!item.position) expect(() => packCargoFFD([item], container)).toThrow(RangeError);
  });

  it('returns a finite unsafe sentinel when the validator receives invalid data', () => {
    const result = validateCogAgainstLimits(
      [{ item: { id: 'bad', dimensions: { x: 1, y: 1, z: 1 }, mass: Number.NaN }, position }],
      limits,
    );
    expect(result.invalid).toBe(true);
    expect(result.isSafe).toBe(false);
    expect(result.cog).toEqual({ x: 0, y: 0, z: 0 });
    expect(Number.isFinite(result.cog.x)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects arithmetic overflow even when scalar inputs are individually finite', () => {
    const item: CargoItem = {
      id: 'overflow',
      dimensions: { x: Number.MAX_VALUE, y: 2, z: 1 },
      mass: Number.MAX_VALUE,
    };
    const placed = [{ item, position }];
    expect(() => computeCenterOfGravity(placed)).toThrow(RangeError);
    expect(() => computeUtilization(placed, container)).toThrow(RangeError);
  });

  it('rejects malformed placed entries without leaking a TypeError', () => {
    const malformed = [null as never];
    expect(() => computeCenterOfGravity(malformed)).toThrow(RangeError);
    expect(() => computeUtilization(malformed, container)).toThrow(RangeError);
    expect(validateCogAgainstLimits(malformed, limits).invalid).toBe(true);
  });
});
