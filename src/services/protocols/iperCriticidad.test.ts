import { describe, it, expect } from 'vitest';
import {
  criticidadFromIper,
  CRITICIDAD_BY_IPER_LEVEL,
  type IperCriticidad,
} from './iperCriticidad';
import { calculateIper, IPER_MATRIX } from './iper';

describe('CRITICIDAD_BY_IPER_LEVEL — DS44 5-level → 4-band map', () => {
  it('collapses the two acceptable DS44 levels to Baja', () => {
    expect(CRITICIDAD_BY_IPER_LEVEL.trivial).toBe('Baja');
    expect(CRITICIDAD_BY_IPER_LEVEL.tolerable).toBe('Baja');
  });
  it('maps action-required levels to escalating bands', () => {
    expect(CRITICIDAD_BY_IPER_LEVEL.moderado).toBe('Media');
    expect(CRITICIDAD_BY_IPER_LEVEL.importante).toBe('Alta');
    expect(CRITICIDAD_BY_IPER_LEVEL.intolerable).toBe('Crítica');
  });
});

describe('criticidadFromIper — derived from the DS44 engine, NOT ad-hoc thresholds', () => {
  it('agrees with calculateIper().level for every P×S cell', () => {
    for (let p = 1; p <= 5; p++) {
      for (let s = 1; s <= 5; s++) {
        const level = calculateIper({
          probability: p as 1 | 2 | 3 | 4 | 5,
          severity: s as 1 | 2 | 3 | 4 | 5,
        }).level;
        expect(criticidadFromIper(p, s)).toBe(CRITICIDAD_BY_IPER_LEVEL[level]);
      }
    }
  });

  it('uses the DS44 MATRIX, not a raw-score ladder (regression vs the old bug)', () => {
    // P=3,S=3 (score 9): old Matrix.tsx ladder said "Alta" (>=9). DS44 matrix
    // classifies it 'moderado' → Media. This is the drift the fix removes.
    expect(IPER_MATRIX[2][2]).toBe('moderado');
    expect(criticidadFromIper(3, 3)).toBe('Media');
    // P=4,S=4 (score 16): old ladder "Crítica" (>=16); DS44 'importante' → Alta.
    expect(criticidadFromIper(4, 4)).toBe('Alta');
    // P=5,S=5 → intolerable → Crítica (both agree at the extreme).
    expect(criticidadFromIper(5, 5)).toBe('Crítica');
    // P=1,S=1 → trivial → Baja.
    expect(criticidadFromIper(1, 1)).toBe('Baja');
  });

  it('returns one of the four legacy bands for all valid inputs', () => {
    const valid: IperCriticidad[] = ['Crítica', 'Alta', 'Media', 'Baja'];
    for (let p = 1; p <= 5; p++) {
      for (let s = 1; s <= 5; s++) {
        expect(valid).toContain(criticidadFromIper(p, s));
      }
    }
  });

  describe('defensive clamping (UI never throws on out-of-range data)', () => {
    it('clamps below-range inputs up to 1', () => {
      expect(criticidadFromIper(0, 0)).toBe(criticidadFromIper(1, 1));
      expect(criticidadFromIper(-3, 2)).toBe(criticidadFromIper(1, 2));
    });
    it('clamps above-range inputs down to 5', () => {
      expect(criticidadFromIper(9, 9)).toBe(criticidadFromIper(5, 5));
      expect(criticidadFromIper(5, 7)).toBe(criticidadFromIper(5, 5));
    });
    it('rounds non-integer inputs to the nearest scale point', () => {
      expect(criticidadFromIper(2.6, 3.4)).toBe(criticidadFromIper(3, 3));
    });
    it('treats non-finite inputs as the minimum (no throw)', () => {
      expect(() => criticidadFromIper(NaN, Infinity)).not.toThrow();
      expect(criticidadFromIper(NaN, NaN)).toBe('Baja');
    });
  });
});
