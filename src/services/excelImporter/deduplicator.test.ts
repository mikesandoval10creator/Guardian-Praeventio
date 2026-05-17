// Praeventio Guard — Sprint K §108 — deduplicator tests.

import { describe, it, expect } from 'vitest';
import { dedupe } from './deduplicator.js';

describe('dedupe — workers (uniqueKey rut)', () => {
  it('separa única vs duplicado dentro del lote', () => {
    const r = dedupe(
      [
        { rowNumber: 2, record: { rut: '111111111', fullName: 'A' } },
        { rowNumber: 3, record: { rut: '111111111', fullName: 'A clon' } },
        { rowNumber: 4, record: { rut: '12345670k', fullName: 'B' } },
      ],
      { kind: 'workers' },
    );
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]?.rowNumber).toBe(3);
    expect(r.duplicates[0]?.conflictsWithRowNumber).toBe(2);
    expect(r.duplicates[0]?.conflictWithExisting).toBe(false);
  });

  it('detecta duplicado contra existingKeys', () => {
    const r = dedupe(
      [
        { rowNumber: 2, record: { rut: '111111111', fullName: 'A' } },
        { rowNumber: 3, record: { rut: '999999999', fullName: 'B' } },
      ],
      { kind: 'workers', existingKeys: ['111111111'] },
    );
    expect(r.unique).toHaveLength(1);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]?.conflictWithExisting).toBe(true);
    expect(r.duplicates[0]?.conflictsWithRowNumber).toBeNull();
  });

  it('clave vacía/null pasa como única (validator captura missing)', () => {
    const r = dedupe(
      [{ rowNumber: 2, record: { rut: null, fullName: 'A' } as unknown as { rut: string; fullName: string } }],
      { kind: 'workers' },
    );
    expect(r.unique).toHaveLength(1);
    expect(r.duplicates).toHaveLength(0);
  });
});

describe('dedupe — kind sin uniqueKey', () => {
  it('trainings → todas las filas pasan como únicas', () => {
    const r = dedupe(
      [
        { rowNumber: 2, record: { code: 'A1', workerRut: '111111111' } },
        { rowNumber: 3, record: { code: 'A1', workerRut: '111111111' } },
      ],
      { kind: 'trainings' },
    );
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toHaveLength(0);
  });
});

describe('dedupe — projects (uniqueKey name normalizado)', () => {
  it('normaliza name por case-insensitive', () => {
    const r = dedupe(
      [
        { rowNumber: 2, record: { name: 'Proyecto Centro', industry: 'mining' } },
        { rowNumber: 3, record: { name: 'PROYECTO CENTRO', industry: 'mining' } },
      ],
      { kind: 'projects' },
    );
    expect(r.unique).toHaveLength(1);
    expect(r.duplicates).toHaveLength(1);
  });
});

describe('dedupe — keyFor custom', () => {
  it('permite clave compuesta', () => {
    const r = dedupe(
      [
        { rowNumber: 2, record: { a: 'x', b: 1 } },
        { rowNumber: 3, record: { a: 'x', b: 2 } },
        { rowNumber: 4, record: { a: 'x', b: 1 } },
      ],
      {
        kind: 'workers',
        keyFor: (rec) => `${(rec as { a: string }).a}|${(rec as { b: number }).b}`,
      },
    );
    expect(r.unique).toHaveLength(2);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]?.rowNumber).toBe(4);
  });
});
