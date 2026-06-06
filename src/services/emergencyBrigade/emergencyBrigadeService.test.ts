import { describe, it, expect } from 'vitest';
import {
  buildBrigadeCoverageReport,
  buildResourceReadinessReport,
  detectCoverageGaps,
  type BrigadeMember,
  type EmergencyResource,
} from './emergencyBrigadeService.js';

function member(over: Partial<BrigadeMember> & { workerUid: string }): BrigadeMember {
  return {
    workerUid: over.workerUid,
    role: over.role ?? 'brigade_chief',
    trainedAt: over.trainedAt ?? '2026-01-01T00:00:00Z',
    trainingValidYears: over.trainingValidYears ?? 2,
    active: over.active ?? true,
  };
}

function resource(over: Partial<EmergencyResource> & { id: string }): EmergencyResource {
  return {
    id: over.id,
    kind: over.kind ?? 'extinguisher',
    location: 'A',
    lastInspectedAt: '2026-05-01',
    nextExpirationAt: over.nextExpirationAt ?? '2027-01-01T00:00:00Z',
    operational: over.operational ?? true,
  };
}

describe('buildBrigadeCoverageReport', () => {
  it('meetsMinimum=true con los 3 roles base activos', () => {
    const r = buildBrigadeCoverageReport([
      member({ workerUid: 'a', role: 'brigade_chief' }),
      member({ workerUid: 'b', role: 'first_aid' }),
      member({ workerUid: 'c', role: 'fire_response' }),
    ]);
    expect(r.meetsMinimum).toBe(true);
  });

  it('uncoveredRoles si falta cobertura', () => {
    const r = buildBrigadeCoverageReport([
      member({ workerUid: 'a', role: 'brigade_chief' }),
    ]);
    expect(r.uncoveredRoles).toContain('first_aid');
    expect(r.meetsMinimum).toBe(false);
  });

  it('detecta capacitación vencida', () => {
    const r = buildBrigadeCoverageReport(
      [
        member({
          workerUid: 'a',
          role: 'brigade_chief',
          trainedAt: '2020-01-01T00:00:00Z',
          trainingValidYears: 2,
        }),
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.expiredTrainings).toHaveLength(1);
    // No cuenta como cobertura
    expect(r.byRole.brigade_chief).toBe(0);
  });

  it('ignora miembros inactivos', () => {
    const r = buildBrigadeCoverageReport([
      member({ workerUid: 'a', role: 'brigade_chief', active: false }),
    ]);
    expect(r.totalMembers).toBe(0);
  });

  it('fail-closed: trainedAt inválido NO cuenta como cobertura (antes daba falso positivo de vida)', () => {
    const r = buildBrigadeCoverageReport(
      [
        member({ workerUid: 'a', role: 'brigade_chief', trainedAt: 'fecha-corrupta' }),
        member({ workerUid: 'b', role: 'first_aid' }),
        member({ workerUid: 'c', role: 'fire_response' }),
      ],
      '2026-05-11T00:00:00Z',
    );
    // El miembro con fecha que no parsea (Date.parse → NaN) se trata como
    // VENCIDO, no se cuenta en byRole, y el rol queda descubierto. Antes del
    // fix `NaN < now` era false → contaba como vigente → meetsMinimum=true con
    // un brigade_chief sin capacitación válida.
    expect(r.byRole.brigade_chief).toBe(0);
    expect(r.expiredTrainings.map((m) => m.workerUid)).toContain('a');
    expect(r.uncoveredRoles).toContain('brigade_chief');
    expect(r.meetsMinimum).toBe(false);
  });
});

describe('buildResourceReadinessReport', () => {
  it('cuenta operativos y operationalPercent', () => {
    const r = buildResourceReadinessReport(
      [
        resource({ id: 'r1' }),
        resource({ id: 'r2', operational: false }),
      ],
      '2026-05-11',
    );
    expect(r.operational).toBe(1);
    expect(r.operationalPercent).toBe(50);
  });

  it('needingAttention incluye vencidos próximos (<=30d)', () => {
    const r = buildResourceReadinessReport(
      [
        resource({ id: 'r1', nextExpirationAt: '2026-05-25T00:00:00Z' }),
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.needingAttention).toHaveLength(1);
  });
});

describe('detectCoverageGaps', () => {
  it('detecta shortfall', () => {
    const r = detectCoverageGaps(
      [resource({ id: 'r1', kind: 'extinguisher' })],
      [{ kind: 'extinguisher', minimumCount: 5 }],
    );
    expect(r[0].shortfall).toBe(4);
  });

  it('no devuelve gaps si cubre', () => {
    const r = detectCoverageGaps(
      [resource({ id: 'r1', kind: 'extinguisher' })],
      [{ kind: 'extinguisher', minimumCount: 1 }],
    );
    expect(r).toEqual([]);
  });

  it('NO cuenta inoperativos', () => {
    const r = detectCoverageGaps(
      [
        resource({ id: 'r1', kind: 'extinguisher', operational: false }),
      ],
      [{ kind: 'extinguisher', minimumCount: 1 }],
    );
    expect(r[0].shortfall).toBe(1);
  });
});
