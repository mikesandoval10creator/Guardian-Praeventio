import { describe, it, expect } from 'vitest';
import {
  checkZoneEntry,
  type RestrictedZone,
  type ZoneEntryCheckInput,
} from './restrictedZonesEngine.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function makeZone(over: Partial<RestrictedZone> = {}): RestrictedZone {
  return {
    id: 'z1',
    kind: 'hot',
    name: 'Sector Soldadura',
    rules: {
      requiredEpp: ['Careta facial', 'Guantes ignífugos'],
      requiredTrainings: ['trabajo_caliente'],
      requiresPermit: true,
      responsibleUid: 'sup-1',
    },
    activeFrom: '2026-05-01T00:00:00Z',
    ...over,
  };
}

function input(over: Partial<ZoneEntryCheckInput> = {}): ZoneEntryCheckInput {
  return {
    workerUid: 'w1',
    workerEppLabels: ['Careta facial', 'Guantes ignífugos'],
    workerTrainings: ['trabajo_caliente'],
    workerActivePermitKinds: ['caliente'],
    zone: makeZone(),
    now: NOW,
    ...over,
  };
}

describe('checkZoneEntry', () => {
  it('worker cumple todo → allowed', () => {
    const r = checkZoneEntry(input());
    expect(r.allowed).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('falta EPP → not allowed', () => {
    const r = checkZoneEntry(input({ workerEppLabels: [] }));
    expect(r.allowed).toBe(false);
    expect(r.missing).toContain('EPP: Careta facial');
  });

  it('falta training → not allowed', () => {
    const r = checkZoneEntry(input({ workerTrainings: [] }));
    expect(r.allowed).toBe(false);
    expect(r.missing).toContain('Training: trabajo_caliente');
  });

  it('falta permit → not allowed cuando requiresPermit', () => {
    const r = checkZoneEntry(input({ workerActivePermitKinds: [] }));
    expect(r.allowed).toBe(false);
    expect(r.missing).toContain('Permit activo: caliente');
  });

  it('requiresPermit con kind sin permiso mapeado → warning honesto, nunca silencioso', () => {
    // `atex` has no mapped permit kind. The zone still demands a permit, so the
    // requirement must surface as a warning — never be silently satisfied.
    const r = checkZoneEntry(
      input({
        workerActivePermitKinds: [],
        zone: makeZone({
          kind: 'atex',
          rules: {
            requiredEpp: [],
            requiredTrainings: [],
            requiresPermit: true,
            responsibleUid: 'sup-1',
          },
        }),
      }),
    );
    expect(r.warnings.some((w) => w.includes('no tiene permiso configurado'))).toBe(
      true,
    );
    // The unmapped permit must NOT masquerade as a satisfied `missing` entry.
    expect(r.missing.some((m) => m.startsWith('Permit activo'))).toBe(false);
  });

  it('zona aún no activa → allowed (sin restricción)', () => {
    const future = new Date('2030-01-01T00:00:00Z').toISOString();
    const r = checkZoneEntry(input({ zone: makeZone({ activeFrom: future }) }));
    expect(r.allowed).toBe(true);
    expect(r.warnings).toContain('Zona aún no activa');
  });

  it('zona expirada → allowed (sin restricción)', () => {
    const past = new Date('2020-01-01T00:00:00Z').toISOString();
    const r = checkZoneEntry(input({ zone: makeZone({ activeUntil: past }) }));
    expect(r.allowed).toBe(true);
    expect(r.warnings).toContain('Zona expirada (sin restricción)');
  });

  it('zona confinado mapea a permit confinado', () => {
    const r = checkZoneEntry(
      input({
        zone: makeZone({
          kind: 'confined',
          rules: {
            requiredEpp: [],
            requiredTrainings: [],
            requiresPermit: true,
            responsibleUid: 'sup',
          },
        }),
        workerActivePermitKinds: ['caliente'], // tiene caliente, no confinado
      }),
    );
    expect(r.missing).toContain('Permit activo: confinado');
  });

  it('zona izaje mapea a permit izaje_critico', () => {
    const r = checkZoneEntry(
      input({
        zone: makeZone({
          kind: 'lifting',
          rules: {
            requiredEpp: [],
            requiredTrainings: [],
            requiresPermit: true,
            responsibleUid: 'sup',
          },
        }),
        workerActivePermitKinds: [],
      }),
    );
    expect(r.missing).toContain('Permit activo: izaje_critico');
  });
});
