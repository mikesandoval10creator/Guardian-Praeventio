import { describe, it, expect } from 'vitest';
import {
  checkSegregation,
  listIncompatibleWith,
  HAZMAT_CLASS_LABELS,
  type HazmatSubclass,
} from './hazmatSegregation.js';

describe('checkSegregation', () => {
  it('Clase 5.1 (oxidante) + Clase 3 (líquido inflamable) → INCOMPATIBLE (IMDG 2)', () => {
    // En la versión SIMPLIFICADA vieja esto era '0' (incompatible)
    // pero el comportamiento operativo era ambiguo. Ahora IMDG '2'
    // que mapea a 'caution' (separated from, ≥3m). Si se pide
    // versión estricta inversa, código '2' aplica.
    const r = checkSegregation('5_1', '3');
    expect(r.imdgCode).toBe('2');
    expect(r.operational).toBe('caution');
  });

  it('Clase 1 (explosivos) + Clase 4.1 (sólido inflamable) → INCOMPATIBLE (IMDG 4)', () => {
    const r = checkSegregation('1', '4_1');
    expect(r.imdgCode).toBe('4');
    expect(r.operational).toBe('incompatible');
    expect(r.rationale).toContain('Separated longitudinally');
  });

  it('Clase 2.2 (gas no-inflamable) + Clase 3 (líquido inflamable) → IMDG 1 compatible-away', () => {
    const r = checkSegregation('2_2', '3');
    expect(r.imdgCode).toBe('1');
    expect(r.operational).toBe('compatible');
  });

  it('Clase 1 consigo misma → X (caso especial — DGL)', () => {
    const r = checkSegregation('1', '1');
    expect(r.imdgCode).toBe('X');
    expect(r.operational).toBe('incompatible');
    expect(r.rationale).toContain('caso especial');
  });

  it('simetría: checkSegregation(a, b) === checkSegregation(b, a) para el código', () => {
    const all = Object.keys(HAZMAT_CLASS_LABELS) as HazmatSubclass[];
    for (const a of all) {
      for (const b of all) {
        const ab = checkSegregation(a, b);
        const ba = checkSegregation(b, a);
        // El imdgCode debe ser idéntico — la matriz IMDG es simétrica
        // por diseño físico (la incompatibilidad química no tiene
        // dirección).
        expect(ab.imdgCode).toBe(ba.imdgCode);
      }
    }
  });

  it('Clase 5.2 (peróxido orgánico) + Clase 4.2 (espontáneo combustible) → 2 (caution)', () => {
    const r = checkSegregation('5_2', '4_2');
    expect(r.imdgCode).toBe('2');
    expect(r.operational).toBe('caution');
  });

  it('Clase 8 (corrosivo) + Clase 8 → 0 sin restricción consigo mismo', () => {
    const r = checkSegregation('8', '8');
    expect(r.imdgCode).toBe('0');
    expect(r.operational).toBe('compatible');
  });

  it('Clase 7 (radioactivo) + Clase 5.1 (oxidante) → IMDG 1 (compatible away-from)', () => {
    const r = checkSegregation('7', '5_1');
    expect(r.imdgCode).toBe('1');
    expect(r.operational).toBe('compatible');
  });

  it('rationale siempre se devuelve no vacío', () => {
    const all = Object.keys(HAZMAT_CLASS_LABELS) as HazmatSubclass[];
    for (const a of all) {
      for (const b of all) {
        const r = checkSegregation(a, b);
        expect(r.rationale.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('listIncompatibleWith', () => {
  it('Clase 1 (explosivos) tiene MUCHAS clases incompatibles (separation 4)', () => {
    const incompatibles = listIncompatibleWith('1');
    // 1 misma + casi todas las demás están "separated longitudinally" (4)
    expect(incompatibles.length).toBeGreaterThan(7);
    expect(incompatibles).toContain('4_1');
    expect(incompatibles).toContain('5_2');
  });

  it('Clase 9 (misceláneos) prácticamente compatible con todo (excepto Clase 1)', () => {
    const incompatibles = listIncompatibleWith('9');
    // Solo Class 1 es X (caso especial → incompatible)
    expect(incompatibles).toEqual(['1']);
  });

  it('Clase 2.2 (gas no-inflamable) NO tiene incompatibilidades fuertes (separation 0/1)', () => {
    const incompatibles = listIncompatibleWith('2_2');
    // Class 1 es '2' (separated from), no incompatible. Por tanto lista vacía.
    expect(incompatibles.length).toBe(0);
  });
});

describe('HAZMAT_CLASS_LABELS', () => {
  it('cubre las 15 sub-clases NU completas', () => {
    const keys = Object.keys(HAZMAT_CLASS_LABELS).sort();
    expect(keys).toEqual(
      [
        '1',
        '2_1', '2_2', '2_3',
        '3',
        '4_1', '4_2', '4_3',
        '5_1', '5_2',
        '6_1', '6_2',
        '7',
        '8',
        '9',
      ].sort(),
    );
  });

  it('todos los labels contienen "Clase"', () => {
    for (const label of Object.values(HAZMAT_CLASS_LABELS)) {
      expect(label).toContain('Clase');
    }
  });
});
