import { describe, it, expect } from 'vitest';
import {
  requiredSignageForZone,
  auditZoneSignage,
  rankSiteSignage,
  findEvacuationPaths,
  type SignagePlacement,
  type SignageZoneAudit,
  type EvacuationNode,
} from './signageValidator.js';

const NOW = new Date('2026-05-13T10:00:00Z');

function place(over: Partial<SignagePlacement> & { id: string; code: SignagePlacement['code'] }): SignagePlacement {
  return {
    category: 'safe_condition',
    position: { lat: -33.4, lng: -70.6 },
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('requiredSignageForZone', () => {
  it('zone production_floor incluye head_protection y exit', () => {
    const req = requiredSignageForZone('production_floor');
    expect(req).toContain('M014_head_protection');
    expect(req).toContain('E001_emergency_exit_left');
  });

  it('zone chemical_storage incluye eye_wash y safety_shower', () => {
    const req = requiredSignageForZone('chemical_storage');
    expect(req).toContain('E012_eye_wash');
    expect(req).toContain('E013_safety_shower');
  });

  it('extraRequired se suma sin duplicar', () => {
    const req = requiredSignageForZone('office', [
      'E001_emergency_exit_left',
      'M001_general_mandatory',
    ]);
    const exitCount = req.filter((c) => c === 'E001_emergency_exit_left').length;
    expect(exitCount).toBe(1);
    expect(req).toContain('M001_general_mandatory');
  });
});

describe('auditZoneSignage', () => {
  it('todas las señaléticas presentes en buen estado → compliance 100', () => {
    const audit: SignageZoneAudit = {
      zoneId: 'office-1',
      zoneKind: 'office',
      placedSignage: [
        place({ id: '1', code: 'E001_emergency_exit_left', installedAt: NOW.toISOString() }),
        place({ id: '2', code: 'F001_fire_extinguisher', installedAt: NOW.toISOString() }),
        place({ id: '3', code: 'E004_emergency_phone', installedAt: NOW.toISOString() }),
      ],
    };
    const r = auditZoneSignage(audit, NOW);
    expect(r.complianceScore).toBe(100);
    expect(r.gaps).toHaveLength(0);
    expect(r.criticalIntervention).toBe(false);
  });

  it('faltan todas las señaléticas → gaps missing + score bajo', () => {
    const audit: SignageZoneAudit = {
      zoneId: 'office-2',
      zoneKind: 'office',
      placedSignage: [],
    };
    const r = auditZoneSignage(audit, NOW);
    expect(r.gaps.every((g) => g.kind === 'missing_required')).toBe(true);
    expect(r.complianceScore).toBeLessThan(50);
    expect(r.criticalIntervention).toBe(true);
  });

  it('señalética dañada → gap present_but_damaged + crítica', () => {
    const audit: SignageZoneAudit = {
      zoneId: 'office-3',
      zoneKind: 'office',
      placedSignage: [
        place({
          id: '1',
          code: 'E001_emergency_exit_left',
          installedAt: NOW.toISOString(),
          reportedIssue: 'damaged',
        }),
        place({ id: '2', code: 'F001_fire_extinguisher', installedAt: NOW.toISOString() }),
        place({ id: '3', code: 'E004_emergency_phone', installedAt: NOW.toISOString() }),
      ],
    };
    const r = auditZoneSignage(audit, NOW);
    expect(r.gaps.some((g) => g.kind === 'present_but_damaged')).toBe(true);
    expect(r.criticalIntervention).toBe(true);
  });

  it('señalética obscured pesa menos que damaged', () => {
    const auditDamaged: SignageZoneAudit = {
      zoneId: 'a',
      zoneKind: 'office',
      placedSignage: [
        place({ id: '1', code: 'M001_general_mandatory', installedAt: NOW.toISOString(), reportedIssue: 'damaged' }),
      ],
    };
    const auditObscured: SignageZoneAudit = {
      zoneId: 'b',
      zoneKind: 'office',
      placedSignage: [
        place({ id: '1', code: 'M001_general_mandatory', installedAt: NOW.toISOString(), reportedIssue: 'obscured' }),
      ],
    };
    const r1 = auditZoneSignage(auditDamaged, NOW);
    const r2 = auditZoneSignage(auditObscured, NOW);
    const w1 = r1.gaps.find((g) => g.kind === 'present_but_damaged')?.weight ?? 0;
    const w2 = r2.gaps.find((g) => g.kind === 'present_but_obscured')?.weight ?? 0;
    expect(w1).toBeGreaterThan(w2);
  });

  it('maintenance overdue → gap maintenance_overdue', () => {
    const audit: SignageZoneAudit = {
      zoneId: 'old-1',
      zoneKind: 'office',
      placedSignage: [
        place({
          id: '1',
          code: 'F001_fire_extinguisher',
          installedAt: '2024-01-01T00:00:00Z',
          lastMaintenanceAt: '2024-01-01T00:00:00Z',
        }),
        place({ id: '2', code: 'E001_emergency_exit_left', installedAt: NOW.toISOString() }),
        place({ id: '3', code: 'E004_emergency_phone', installedAt: NOW.toISOString() }),
      ],
    };
    const r = auditZoneSignage(audit, NOW);
    expect(r.gaps.some((g) => g.kind === 'maintenance_overdue')).toBe(true);
  });
});

describe('rankSiteSignage', () => {
  it('zonesByPriority orden desc por totalWeight', () => {
    const audits = [
      auditZoneSignage({ zoneId: 'a', zoneKind: 'office', placedSignage: [] }, NOW),
      auditZoneSignage(
        {
          zoneId: 'b',
          zoneKind: 'office',
          placedSignage: [
            place({ id: '1', code: 'E001_emergency_exit_left', installedAt: NOW.toISOString() }),
            place({ id: '2', code: 'F001_fire_extinguisher', installedAt: NOW.toISOString() }),
            place({ id: '3', code: 'E004_emergency_phone', installedAt: NOW.toISOString() }),
          ],
        },
        NOW,
      ),
    ];
    const r = rankSiteSignage(audits);
    expect(r.zonesByPriority[0]!.zoneId).toBe('a'); // más gaps
  });

  it('topPatterns detecta el code que falta más veces', () => {
    const empty = (id: string) =>
      auditZoneSignage({ zoneId: id, zoneKind: 'production_floor', placedSignage: [] }, NOW);
    const audits = [empty('z1'), empty('z2'), empty('z3')];
    const r = rankSiteSignage(audits);
    const exitOccurrences = r.topPatterns.find((p) => p.code === 'E001_emergency_exit_left')!.occurrences;
    expect(exitOccurrences).toBe(3);
  });
});

describe('findEvacuationPaths', () => {
  // Grafo: A -> B -> C(exit)
  //        A -> D -> C(exit)
  //        D -> E(blocked)
  const NODES: EvacuationNode[] = [
    { id: 'A', position: { lat: -33.4, lng: -70.6 }, connectsTo: ['B', 'D'] },
    { id: 'B', position: { lat: -33.4001, lng: -70.6 }, connectsTo: ['A', 'C'] },
    { id: 'C', position: { lat: -33.4002, lng: -70.6 }, connectsTo: ['B', 'D'], isExit: true },
    { id: 'D', position: { lat: -33.4, lng: -70.6001 }, connectsTo: ['A', 'C', 'E'] },
    { id: 'E', position: { lat: -33.4, lng: -70.6002 }, connectsTo: ['D'], isExit: true, blocked: true },
  ];

  it('encuentra rutas hasta exit C', () => {
    const paths = findEvacuationPaths(NODES, 'A');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]!.nodes[paths[0]!.nodes.length - 1]).toBe('C');
  });

  it('NO incluye rutas a exits bloqueadas', () => {
    const paths = findEvacuationPaths(NODES, 'A');
    expect(paths.every((p) => !p.nodes.includes('E'))).toBe(true);
  });

  it('prioriza rutas con menos zonas riesgosas', () => {
    const risky = new Set(['B']);
    const paths = findEvacuationPaths(NODES, 'A', risky);
    // Primera ruta debería evitar B (vía D)
    expect(paths[0]!.nodes).not.toContain('B');
  });

  it('sin exits accesibles → array vacío', () => {
    const blockedAll: EvacuationNode[] = NODES.map((n) =>
      n.isExit ? { ...n, blocked: true } : n,
    );
    const paths = findEvacuationPaths(blockedAll, 'A');
    expect(paths).toHaveLength(0);
  });

  it('startId desconocido → vacío', () => {
    const paths = findEvacuationPaths(NODES, 'UNKNOWN');
    expect(paths).toHaveLength(0);
  });

  it('respeta maxRoutes cap', () => {
    const paths = findEvacuationPaths(NODES, 'A', new Set(), 1);
    expect(paths).toHaveLength(1);
  });
});
