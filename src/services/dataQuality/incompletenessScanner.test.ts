import { describe, it, expect } from 'vitest';
import {
  scanWorkers,
  scanProjects,
  scanEppAssignments,
  scanDocuments,
  scanIncidents,
  scanMachines,
  scanTrainings,
  scanAll,
  pickTopGaps,
} from './incompletenessScanner.js';

describe('scanWorkers', () => {
  it('detecta fullName + cargo + industry faltantes', () => {
    const gaps = scanWorkers([{ id: 'w1' }]);
    const fields = gaps.map((g) => g.field).sort();
    expect(fields).toEqual(['cargo', 'fullName', 'industry']);
  });

  it('rut presente pero vacío → medium', () => {
    const gaps = scanWorkers([{ id: 'w1', fullName: 'A', cargo: 'c', industry: 'i', rut: '' }]);
    const rutGap = gaps.find((g) => g.field === 'rut');
    expect(rutGap?.severity).toBe('medium');
  });

  it('worker completo → 0 gaps', () => {
    const gaps = scanWorkers([
      { id: 'w1', fullName: 'Ana Soto', cargo: 'soldador', industry: 'construction' },
    ]);
    expect(gaps).toHaveLength(0);
  });
});

describe('scanProjects', () => {
  it('falla por name + industry + workersCount + location', () => {
    const gaps = scanProjects([{ id: 'p1' }]);
    expect(gaps.length).toBe(4);
    expect(gaps.some((g) => g.field === 'industry' && g.severity === 'high')).toBe(true);
  });

  it('proyecto completo → 0 gaps', () => {
    const gaps = scanProjects([
      { id: 'p1', name: 'Obra Andes', industry: 'mining', workersCount: 120, location: { lat: -33, lng: -70 } },
    ]);
    expect(gaps).toHaveLength(0);
  });

  it('location parcial → gap', () => {
    const gaps = scanProjects([
      { id: 'p1', name: 'x', industry: 'y', workersCount: 5, location: { lat: -33 } },
    ]);
    expect(gaps.find((g) => g.field === 'location')).toBeDefined();
  });
});

describe('scanEppAssignments', () => {
  it('detecta expiresAt faltante como high', () => {
    const gaps = scanEppAssignments([{ id: 'e1' }]);
    const exp = gaps.find((g) => g.field === 'expiresAt');
    expect(exp?.severity).toBe('high');
  });

  it('completo → 0 gaps', () => {
    const gaps = scanEppAssignments([
      { id: 'e1', deliveredAt: '2026-05-01T00:00:00Z', expiresAt: '2027-05-01T00:00:00Z' },
    ]);
    expect(gaps).toHaveLength(0);
  });
});

describe('scanIncidents', () => {
  it('sin rootCauseCategory → high', () => {
    const gaps = scanIncidents([{ id: 'i1', description: 'caída' }]);
    expect(gaps.find((g) => g.field === 'rootCauseCategory')?.severity).toBe('high');
  });

  it('sin description → high', () => {
    const gaps = scanIncidents([{ id: 'i1' }]);
    expect(gaps.find((g) => g.field === 'description')?.severity).toBe('high');
  });
});

describe('scanMachines', () => {
  it('sin type → high', () => {
    const gaps = scanMachines([{ id: 'm1', code: 'MAQ-001' }]);
    expect(gaps.find((g) => g.field === 'type')?.severity).toBe('high');
  });

  it('sin nextMaintenanceAt → medium', () => {
    const gaps = scanMachines([{ id: 'm1', code: 'x', type: 'soldadora' }]);
    expect(gaps.find((g) => g.field === 'nextMaintenanceAt')?.severity).toBe('medium');
  });
});

describe('scanTrainings', () => {
  it('sin expiresAt + sin participants → 2 gaps', () => {
    const gaps = scanTrainings([{ id: 't1', title: 'altura' }]);
    expect(gaps.length).toBe(2);
  });

  it('completo → 0 gaps', () => {
    const gaps = scanTrainings([
      { id: 't1', title: 'altura R1', expiresAt: '2028-01-01T00:00:00Z', participants: ['w1', 'w2'] },
    ]);
    expect(gaps).toHaveLength(0);
  });
});

describe('scanAll + qualityScore', () => {
  it('sin inputs → score 100', () => {
    const r = scanAll({});
    expect(r.qualityScore).toBe(100);
    expect(r.totalGaps).toBe(0);
  });

  it('input perfecto → score 100', () => {
    const r = scanAll({
      workers: [{ id: 'w', fullName: 'A', cargo: 'c', industry: 'i' }],
      projects: [{ id: 'p', name: 'a', industry: 'b', workersCount: 1, location: { lat: 0, lng: 0 } }],
    });
    expect(r.qualityScore).toBe(100);
  });

  it('input pésimo → score bajo', () => {
    const r = scanAll({
      workers: [{ id: 'w1' }, { id: 'w2' }],
      projects: [{ id: 'p' }],
      incidents: [{ id: 'i' }],
      machines: [{ id: 'm' }],
    });
    expect(r.qualityScore).toBeLessThan(50);
  });

  it('byDomain cuenta correctamente', () => {
    const r = scanAll({
      workers: [{ id: 'w1' }, { id: 'w2' }],
    });
    expect(r.byDomain.worker).toBeGreaterThan(0);
  });

  it('bySeverity cuenta', () => {
    const r = scanAll({
      workers: [{ id: 'w' }], // 3 gaps (2 high, 1 medium)
    });
    expect(r.bySeverity.high).toBe(2);
    expect(r.bySeverity.medium).toBe(1);
  });
});

describe('pickTopGaps', () => {
  it('prioriza high sobre medium/low', () => {
    const r = scanAll({
      workers: [{ id: 'w' }], // 2 high + 1 medium
      eppAssignments: [{ id: 'e' }], // 1 high (expiresAt) + 1 medium (deliveredAt)
    });
    const top = pickTopGaps(r, 3);
    expect(top.every((g) => g.severity === 'high')).toBe(true);
  });

  it('cap N items', () => {
    const r = scanAll({ workers: Array.from({ length: 10 }, (_, i) => ({ id: `w${i}` })) });
    expect(pickTopGaps(r, 5).length).toBe(5);
  });
});
