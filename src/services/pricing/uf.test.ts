import { describe, it, expect } from 'vitest';
import { DIAMANTE_UF, parseMindicadorUf, clpFromUf } from './uf';

describe('UF pricing helpers', () => {
  it('anchors Diamante at 100 UF (business decision)', () => {
    expect(DIAMANTE_UF).toBe(100);
  });

  describe('parseMindicadorUf', () => {
    it('parses a valid mindicador.cl payload', () => {
      const rate = parseMindicadorUf({
        codigo: 'uf',
        serie: [{ fecha: '2026-06-16T04:00:00.000Z', valor: 38123.45 }],
      });
      expect(rate).toEqual({ valueClp: 38123.45, date: '2026-06-16' });
    });

    it('returns null for empty / missing / non-array serie', () => {
      expect(parseMindicadorUf({ serie: [] })).toBeNull();
      expect(parseMindicadorUf({})).toBeNull();
      expect(parseMindicadorUf({ serie: 'nope' })).toBeNull();
    });

    it('returns null for non-object / null payloads (never throws)', () => {
      expect(parseMindicadorUf(null)).toBeNull();
      expect(parseMindicadorUf(undefined)).toBeNull();
      expect(parseMindicadorUf('string')).toBeNull();
      expect(parseMindicadorUf(42)).toBeNull();
    });

    it('rejects a non-positive / non-numeric valor', () => {
      expect(parseMindicadorUf({ serie: [{ fecha: '2026-06-16', valor: 0 }] })).toBeNull();
      expect(parseMindicadorUf({ serie: [{ fecha: '2026-06-16', valor: -1 }] })).toBeNull();
      expect(parseMindicadorUf({ serie: [{ fecha: '2026-06-16', valor: 'x' }] })).toBeNull();
      expect(parseMindicadorUf({ serie: [{ fecha: '2026-06-16', valor: Number.NaN }] })).toBeNull();
    });

    it('rejects an implausibly low value (compromised-upstream poison floor)', () => {
      expect(parseMindicadorUf({ serie: [{ fecha: '2026-06-16', valor: 1 }] })).toBeNull();
      expect(parseMindicadorUf({ serie: [{ fecha: '2026-06-16', valor: 9999 }] })).toBeNull();
      // Boundary: exactly the floor is accepted.
      expect(parseMindicadorUf({ serie: [{ fecha: '2026-06-16', valor: 10000 }] })).toEqual({
        valueClp: 10000,
        date: '2026-06-16',
      });
    });

    it('rejects a missing / malformed fecha', () => {
      expect(parseMindicadorUf({ serie: [{ valor: 38000 }] })).toBeNull();
      expect(parseMindicadorUf({ serie: [{ fecha: 'short', valor: 38000 }] })).toBeNull();
    });
  });

  describe('clpFromUf', () => {
    it('multiplies units by the UF value and rounds to whole pesos', () => {
      expect(clpFromUf(100, 38000)).toBe(3800000);
      expect(clpFromUf(100, 38123.45)).toBe(3812345);
      expect(clpFromUf(1, 38123.9)).toBe(38124);
    });
  });
});
