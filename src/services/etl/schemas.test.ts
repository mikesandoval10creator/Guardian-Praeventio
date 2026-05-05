// Sprint 24 — Bucket JJ — Pre-built schema tests.
//
// One test per entity type plus a sanity test on `getAdapter`. We verify
// that the schema's `transform` produces a row that survives `validate`
// for the happy path, and that `validate` rejects the canonical bad
// inputs (invalid status, out-of-range numeric, bad email, bad date).

import { describe, it, expect } from 'vitest';
import {
  workerSchema,
  findingSchema,
  processSchema,
  trainingSchema,
  crewSchema,
  inspectionSchema,
  getAdapter,
  ALL_ETL_ENTITY_TYPES,
} from './schemas';
import { CsvAdapter } from './csvAdapter';

describe('workerSchema', () => {
  it('parses a Spanish-headered CSV and rejects bad emails', () => {
    const adapter = new CsvAdapter(workerSchema);
    const csv = [
      'nombre,cargo,correo,telefono',
      'Juan Perez,Supervisor,juan@example.com,+56912345678',
      'Maria Soto,Prevencionista,not-an-email,+56987654321',
    ].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toMatchObject({ name: 'Juan Perez', role: 'Supervisor' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toContain('email');
  });
});

describe('findingSchema', () => {
  it('rejects unknown severity and accepts the known ones', () => {
    const adapter = new CsvAdapter(findingSchema);
    const csv = [
      'title,description,severity',
      'Caída detectada,Trabajador sin arnés en altura,Crítica',
      'Algo,Algo más,Mortal', // invalid severity
    ].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].severity).toBe('Crítica');
    expect(result.errors[0].reason).toContain('severidad');
  });
});

describe('processSchema', () => {
  it('rejects out-of-range complianceScore', () => {
    const adapter = new CsvAdapter(processSchema);
    const csv = [
      'name,type,crewId,complianceScore',
      'Hormigonado piso 3,concreto,crew-1,95',
      'Soldadura viga,soldadura,crew-2,150',
    ].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].name).toBe('Hormigonado piso 3');
    expect(result.errors[0].reason).toContain('complianceScore');
  });

  it('rejects unknown process type', () => {
    const adapter = new CsvAdapter(processSchema);
    const csv = [
      'name,type,crewId',
      'Tarea X,inventado,crew-1',
    ].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toEqual([]);
    expect(result.errors[0].reason).toContain('tipo');
  });
});

describe('trainingSchema', () => {
  it('parses a duration in number form and rejects status outside the union', () => {
    const adapter = new CsvAdapter(trainingSchema);
    const csv = [
      'title,date,duration,status',
      'Capacitación EPP,2026-05-04,30,scheduled',
      'Curso ergonomía,2026-05-05,45,bogus',
    ].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toMatchObject({
      title: 'Capacitación EPP',
      duration: 30,
      status: 'scheduled',
    });
    expect(result.errors[0].reason).toContain('status');
  });
});

describe('crewSchema', () => {
  it('splits memberUids on pipe/semicolon and rejects negative xp', () => {
    const adapter = new CsvAdapter(crewSchema);
    const csv = [
      'name,memberUids,xp',
      'Cuadrilla A,uid1|uid2|uid3,120',
      'Cuadrilla B,uid4;uid5,-10',
    ].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].memberUids).toEqual(['uid1', 'uid2', 'uid3']);
    expect(result.errors[0].reason).toContain('xp');
  });
});

describe('inspectionSchema', () => {
  it('parses a Spanish CSV and rejects unknown result values', () => {
    const adapter = new CsvAdapter(inspectionSchema);
    const csv = [
      'titulo,inspector,fecha,resultado,observaciones',
      'Andamio nivel 5,Pedro Ríos,2026-05-04,Conforme,Todo en orden',
      'Excavación,Ana Vera,2026-05-04,QuizásNo,nada',
    ].join('\n');
    const result = adapter.parse(csv);
    expect(result.success).toHaveLength(1);
    expect(result.success[0].result).toBe('Conforme');
    expect(result.errors[0].reason).toContain('resultado');
  });
});

describe('getAdapter', () => {
  it('returns a CsvAdapter for every declared entity type', () => {
    for (const type of ALL_ETL_ENTITY_TYPES) {
      const adapter = getAdapter(type);
      expect(adapter).toBeInstanceOf(CsvAdapter);
    }
  });

  it('throws on unknown entity types', () => {
    expect(() => getAdapter('aliens' as any)).toThrow(/schema not registered/);
  });
});
