// Sprint 24 — Bucket JJ — CsvAdapter tests.
//
// These tests exercise the parser, validator, transformer, and CSV
// serializer in isolation (no firestore round-trip; firestore is mocked
// at the module-collection layer in `csvAdapter.firestore.test.ts` if/
// when we add it). Each test seeds a tiny ad-hoc schema rather than
// reaching into `schemas.ts` so they remain meaningful even if the
// concrete schemas evolve.

import { describe, it, expect } from 'vitest';
import { CsvAdapter, parseCsvLine, type CsvSchema } from './csvAdapter';

interface Pet {
  name: string;
  age: number;
  vaccinated: boolean;
  bornAt?: string;
}

const petSchema: CsvSchema<Pet> = {
  entityType: 'workers',
  columns: [
    { name: 'name', type: 'string', required: true, mapTo: 'name', aliases: ['nombre'] },
    { name: 'age', type: 'number', required: true, mapTo: 'age', aliases: ['edad'] },
    { name: 'vaccinated', type: 'boolean', required: false, mapTo: 'vaccinated' },
    { name: 'bornAt', type: 'date', required: false, mapTo: 'bornAt' },
  ],
  validate: (row) => {
    const errs: string[] = [];
    if (row.age < 0) errs.push('age must be >= 0');
    return errs;
  },
  transform: (raw): Pet => ({
    name: String(raw.name ?? ''),
    age: Number(raw.age ?? 0),
    vaccinated: raw.vaccinated === true,
    bornAt: raw.bornAt ? String(raw.bornAt) : undefined,
  }),
};

describe('parseCsvLine', () => {
  it('handles plain comma-separated cells', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('respects quoted fields with embedded commas', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('respects escaped quotes', () => {
    expect(parseCsvLine('"he said ""hi""",end')).toEqual(['he said "hi"', 'end']);
  });
});

describe('CsvAdapter.parse', () => {
  it('parses a clean CSV with all required columns', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = ['name,age,vaccinated', 'Rex,5,true', 'Mia,2,false'].join('\n');
    const result = adapter.parse(csv);
    expect(result.errors).toEqual([]);
    expect(result.success).toHaveLength(2);
    expect(result.success[0]).toMatchObject({ name: 'Rex', age: 5, vaccinated: true });
    expect(result.success[1]).toMatchObject({ name: 'Mia', age: 2, vaccinated: false });
    expect(result.total).toBe(2);
  });

  it('accepts header aliases (Spanish names)', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = ['nombre,edad', 'Luna,3'].join('\n');
    const result = adapter.parse(csv);
    expect(result.errors).toEqual([]);
    expect(result.success[0]).toMatchObject({ name: 'Luna', age: 3 });
  });

  it('reports missing required columns at the header row', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = ['name', 'Rex'].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toEqual([]);
    expect(result.errors[0]).toMatchObject({ row: 1, reason: expect.stringContaining('age') });
  });

  it('flags rows with empty required cells (1-based row numbers)', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = ['name,age', 'Rex,5', ',7', 'Mia,3'].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].reason).toContain('name');
  });

  it('runs custom validator and reports errors per-row', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = ['name,age', 'Rex,-2', 'Mia,3'].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2, reason: expect.stringContaining('>= 0') });
  });

  it('coerces es-CL dates (DD/MM/YYYY) to ISO', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = ['name,age,bornAt', 'Rex,5,12/03/2020'].join('\n');
    const result = adapter.parse(csv);
    expect(result.success[0].bornAt).toBe('2020-03-12');
  });

  it('coerces booleans from sí / yes / 1', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = ['name,age,vaccinated', 'Rex,5,sí', 'Mia,3,no'].join('\n');
    const result = adapter.parse(csv);
    expect(result.success[0].vaccinated).toBe(true);
    expect(result.success[1].vaccinated).toBe(false);
  });

  it('returns an explicit error for empty CSV input', () => {
    const adapter = new CsvAdapter(petSchema);
    const result = adapter.parse('');
    expect(result.success).toEqual([]);
    expect(result.errors[0].reason).toBe('CSV vacío');
  });

  it('handles CRLF line endings (Excel exports)', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = 'name,age\r\nRex,5\r\nMia,3\r\n';
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(2);
  });

  it('round-trips: parse → serialize → parse yields the same data', () => {
    const adapter = new CsvAdapter(petSchema);
    const original = ['name,age,vaccinated', 'Rex,5,true', '"O\'Malley",4,false'].join('\n');
    const parsed = adapter.parse(original);
    expect(parsed.errors).toEqual([]);
    const serialized = adapter.serialize(parsed.success);
    const reparsed = adapter.parse(serialized);
    expect(reparsed.success).toEqual(parsed.success);
  });
});

describe('CsvAdapter.serialize', () => {
  it('escapes commas and quotes inside fields', () => {
    const adapter = new CsvAdapter(petSchema);
    const csv = adapter.serialize([
      { name: 'Rex, the dog', age: 5, vaccinated: true },
      { name: 'Mia "tiny"', age: 2, vaccinated: false },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('name,age,vaccinated,bornAt');
    expect(lines[1]).toContain('"Rex, the dog"');
    expect(lines[2]).toContain('"Mia ""tiny"""');
  });

  it('returns just the header when given an empty rows array', () => {
    const adapter = new CsvAdapter(petSchema);
    expect(adapter.serialize([])).toBe('name,age,vaccinated,bornAt');
  });
});
