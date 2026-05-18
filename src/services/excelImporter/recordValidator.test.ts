// Praeventio Guard — Sprint K §107 — recordValidator tests.

import { describe, it, expect } from 'vitest';
import {
  validateRows,
  isValidRut,
  normalizeRut,
  isValidIso,
} from './recordValidator.js';

describe('isValidRut', () => {
  it('acepta RUTs chilenos válidos', () => {
    expect(isValidRut('11.111.111-1')).toBe(true);
    expect(isValidRut('12345670-K')).toBe(true);
    expect(isValidRut('12345670-k')).toBe(true);
  });
  it('rechaza DV incorrecto', () => {
    expect(isValidRut('11.111.111-9')).toBe(false);
  });
  it('rechaza strings vacíos o triviales', () => {
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('1')).toBe(false);
  });
});

describe('normalizeRut', () => {
  it('quita puntos/guiones/espacios y baja a minúsculas', () => {
    expect(normalizeRut('11.111.111-K')).toBe('11111111k');
    expect(normalizeRut('11 111 111-1')).toBe('111111111');
  });
});

describe('isValidIso', () => {
  it('acepta YYYY-MM-DD y ISO completo', () => {
    expect(isValidIso('2026-05-17')).toBe(true);
    expect(isValidIso('2026-05-17T10:00:00Z')).toBe(true);
  });
  it('rechaza strings no ISO', () => {
    expect(isValidIso('ayer')).toBe(false);
    expect(isValidIso('17/05/2026')).toBe(false);
    expect(isValidIso('')).toBe(false);
    expect(isValidIso(null as unknown as string)).toBe(false);
  });
});

describe('validateRows — workers', () => {
  it('fila válida pasa', () => {
    const r = validateRows('workers', [
      { rowNumber: 2, data: { fullName: 'Juan Pérez', rut: '11.111.111-1' } },
    ]);
    expect(r.valid).toHaveLength(1);
    expect(r.invalid).toHaveLength(0);
    expect(r.valid[0]?.record.rut).toBe('111111111'); // normalizado
  });

  it('falta rut → issue missing', () => {
    const r = validateRows('workers', [
      { rowNumber: 2, data: { fullName: 'Juan' } },
    ]);
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]?.issues.some((i) => i.column === 'rut')).toBe(true);
  });

  it('RUT inválido → issue invalid_format', () => {
    // fullName ≥ 2 chars so only the rut issue fires; otherwise the
    // fullName.length<2 refine emits 'missing' first and the assertion
    // on issues[0] would see that instead of the invalid_rut.
    const r = validateRows('workers', [
      { rowNumber: 2, data: { fullName: 'Juan', rut: '11.111.111-9' } },
    ]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]?.issues[0]?.code).toBe('invalid_format');
  });

  it('email inválido → issue', () => {
    const r = validateRows('workers', [
      { rowNumber: 2, data: { fullName: 'X', rut: '11.111.111-1', email: 'not-an-email' } },
    ]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]?.issues.some((i) => i.column === 'email')).toBe(true);
  });
});

describe('validateRows — incidents', () => {
  it('fecha ISO inválida → issue', () => {
    const r = validateRows('incidents', [
      {
        rowNumber: 2,
        data: { occurredAt: 'ayer', description: 'caída', severity: 'low' },
      },
    ]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]?.issues.some((i) => i.column === 'occurredAt')).toBe(true);
  });

  it('severity desconocida → issue', () => {
    const r = validateRows('incidents', [
      {
        rowNumber: 2,
        data: { occurredAt: '2026-05-17', description: 'x', severity: 'mortal' },
      },
    ]);
    expect(r.invalid[0]?.issues.some((i) => i.column === 'severity')).toBe(true);
  });

  it('fila válida pasa', () => {
    const r = validateRows('incidents', [
      {
        rowNumber: 2,
        data: { occurredAt: '2026-05-17', description: 'caída', severity: 'medium' },
      },
    ]);
    expect(r.valid).toHaveLength(1);
  });
});

describe('validateRows — epp', () => {
  it('lifespanDays no numérico → issue', () => {
    const r = validateRows('epp', [
      {
        rowNumber: 2,
        data: {
          category: 'casco',
          workerRut: '11.111.111-1',
          handedOverAt: '2026-05-17',
          lifespanDays: 'mucho',
        },
      },
    ]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]?.issues.some((i) => i.column === 'lifespanDays')).toBe(true);
  });
});
