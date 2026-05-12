import { describe, it, expect } from 'vitest';
import { processImport, isValidRut, normalizeRut, SCHEMAS } from './excelImporter.js';

describe('isValidRut', () => {
  it('valida RUT chileno con dígito correcto', () => {
    expect(isValidRut('11.111.111-1')).toBe(true);
  });

  it('rechaza RUT con dígito incorrecto', () => {
    expect(isValidRut('11.111.111-2')).toBe(false);
  });

  it('acepta formato sin puntos ni guión', () => {
    expect(isValidRut('111111111')).toBe(true);
  });

  it('acepta K (case-insensitive) como dígito', () => {
    // 12345670-K es válido conocido
    expect(isValidRut('12345670-k')).toBe(true);
    expect(isValidRut('12345670-K')).toBe(true);
  });
});

describe('normalizeRut', () => {
  it('quita puntos, guiones y espacios; minúsculas', () => {
    expect(normalizeRut('11.111.111-K')).toBe('11111111k');
  });
});

describe('processImport — workers', () => {
  it('campos obligatorios faltantes → issue', () => {
    const r = processImport(SCHEMAS.workers, [
      { rowNumber: 2, data: { fullName: 'María' } }, // sin rut
      { rowNumber: 3, data: { fullName: 'Pedro', rut: '11.111.111-1' } },
    ]);
    expect(r.issues.some((i) => i.field === 'rut' && i.issue === 'missing_required')).toBe(true);
    expect(r.cleanRows).toHaveLength(1);
  });

  it('RUT inválido → issue', () => {
    const r = processImport(SCHEMAS.workers, [
      { rowNumber: 2, data: { fullName: 'A', rut: '11.111.111-9' } }, // DV incorrecto
    ]);
    expect(r.issues.some((i) => i.issue === 'invalid_format')).toBe(true);
    expect(r.cleanRows).toHaveLength(0);
  });

  it('duplicate detection por rut (normalizado)', () => {
    const r = processImport(SCHEMAS.workers, [
      { rowNumber: 2, data: { fullName: 'A', rut: '11.111.111-1' } },
      { rowNumber: 3, data: { fullName: 'A2', rut: '11111111-1' } }, // mismo
    ]);
    expect(r.duplicates).toBe(1);
    expect(r.cleanRows).toHaveLength(1);
  });

  it('todas las filas válidas → 0 issues', () => {
    const r = processImport(SCHEMAS.workers, [
      { rowNumber: 2, data: { fullName: 'A', rut: '11.111.111-1' } },
    ]);
    expect(r.validRows).toBe(1);
    expect(r.issues).toEqual([]);
  });
});

describe('processImport — incidents', () => {
  it('fechas ISO inválidas → issue', () => {
    const r = processImport(SCHEMAS.incidents, [
      {
        rowNumber: 2,
        data: {
          occurredAt: 'ayer',
          description: 'x',
          severity: 'low',
        },
      },
    ]);
    expect(r.issues.some((i) => i.field === 'occurredAt')).toBe(true);
  });

  it('fechas ISO válidas pasan', () => {
    const r = processImport(SCHEMAS.incidents, [
      {
        rowNumber: 2,
        data: {
          occurredAt: '2026-05-11T10:00:00Z',
          description: 'x',
          severity: 'low',
        },
      },
    ]);
    expect(r.cleanRows).toHaveLength(1);
  });
});
