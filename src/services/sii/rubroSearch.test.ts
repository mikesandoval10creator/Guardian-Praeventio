import { describe, it, expect } from 'vitest';
import {
  formatCodigoSii,
  findByCodigo,
  searchByCodigoPrefix,
  searchByTexto,
  searchRubros,
} from './rubroSearch';

describe('formatCodigoSii', () => {
  it('pads to the 6-digit SII canonical form', () => {
    expect(formatCodigoSii(40000)).toBe('040000');
    expect(formatCodigoSii(410010)).toBe('410010');
    expect(formatCodigoSii(11101)).toBe('011101');
  });
});

describe('findByCodigo (exact match)', () => {
  it('finds an entry by numeric code', () => {
    const entry = findByCodigo(410010);
    expect(entry?.sectorId).toBe('GP-CONS-RES');
  });

  it('accepts the zero-padded string form', () => {
    const entry = findByCodigo('040000');
    expect(entry?.descripcion).toMatch(/COBRE/i);
  });

  it('returns undefined for unknown codes', () => {
    expect(findByCodigo(999999)).toBeUndefined();
    expect(findByCodigo('000001')).toBeUndefined();
  });
});

describe('searchByCodigoPrefix', () => {
  it('matches on the zero-padded representation', () => {
    const results = searchByCodigoPrefix('41');
    const codes = results.map((r) => r.codigo);
    expect(codes).toContain(410010);
    expect(codes).toContain(410020);
    // '41…' must not leak codes that only match unpadded (e.g. 041000 does not exist).
    for (const r of results) {
      expect(formatCodigoSii(r.codigo).startsWith('41')).toBe(true);
    }
  });

  it('supports prefixes with leading zeros (mining/agro sections)', () => {
    const results = searchByCodigoPrefix('0311');
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(formatCodigoSii(r.codigo).startsWith('0311')).toBe(true);
    }
  });

  it('returns an empty array for a prefix with no matches', () => {
    expect(searchByCodigoPrefix('999')).toEqual([]);
  });
});

describe('searchByTexto', () => {
  it('finds by text, case-insensitive', () => {
    const results = searchByTexto('demolición');
    expect(results.map((r) => r.codigo)).toContain(431100);
  });

  it('normalises tildes in the query (busqueda sin tilde encuentra con tilde)', () => {
    const withTilde = searchByTexto('construcción');
    const withoutTilde = searchByTexto('construccion');
    expect(withoutTilde.length).toBeGreaterThan(0);
    expect(withoutTilde.map((r) => r.codigo)).toEqual(withTilde.map((r) => r.codigo));
  });

  it('requires ALL tokens to match (AND semantics)', () => {
    const results = searchByTexto('transporte carga carretera');
    expect(results).toHaveLength(1);
    expect(results[0].codigo).toBe(492300);
  });

  it('every result carries its GP-* sectorId', () => {
    for (const r of searchByTexto('extracción')) {
      expect(r.sectorId).toMatch(/^GP-/);
    }
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchByTexto('zzzz inexistente')).toEqual([]);
  });
});

describe('searchRubros (wizard autocomplete entry point)', () => {
  it('dispatches all-digit queries to prefix search', () => {
    const results = searchRubros('4321');
    expect(results.map((r) => r.codigo)).toContain(432100);
  });

  it('dispatches text queries to text search', () => {
    const results = searchRubros('gasfitería');
    expect(results.map((r) => r.codigo)).toContain(432200);
  });

  it('honours the limit parameter', () => {
    const results = searchRubros('de', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('trims surrounding whitespace from the query', () => {
    expect(searchRubros('  410010  ').map((r) => r.codigo)).toContain(410010);
  });

  it('returns an empty array for blank queries', () => {
    expect(searchRubros('')).toEqual([]);
    expect(searchRubros('   ')).toEqual([]);
  });
});
