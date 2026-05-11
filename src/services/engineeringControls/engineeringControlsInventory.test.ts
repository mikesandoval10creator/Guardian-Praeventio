import { describe, it, expect } from 'vitest';
import {
  buildEngineeringInventoryReport,
  auditRiskHierarchy,
  auditEppQuality,
  type EngineeringControl,
  type RiskHierarchyState,
  type EppItem,
} from './engineeringControlsInventory.js';

function ec(over: Partial<EngineeringControl> & { id: string }): EngineeringControl {
  return {
    id: over.id,
    kind: over.kind ?? 'physical_barrier',
    label: over.label ?? 'Baranda perimetral',
    mitigatesRiskCategory: over.mitigatesRiskCategory ?? 'altura',
    location: over.location ?? 'nivel 2',
    status: over.status ?? 'operativo',
    maintainedByUid: over.maintainedByUid ?? 'maint1',
  };
}

describe('buildEngineeringInventoryReport', () => {
  it('cuenta byKind + coveredRiskCategories', () => {
    const r = buildEngineeringInventoryReport(
      [
        ec({ id: 'a', kind: 'physical_barrier' }),
        ec({ id: 'b', kind: 'ventilation', mitigatesRiskCategory: 'confinado' }),
        ec({ id: 'c', kind: 'physical_barrier' }),
      ],
      ['altura', 'confinado', 'electric'],
    );
    expect(r.total).toBe(3);
    expect(r.byKind.physical_barrier).toBe(2);
    expect(r.coveredRiskCategories).toContain('altura');
    expect(r.uncoveredRiskCategories).toContain('electric');
  });

  it('control fuera de servicio NO se cuenta como cobertura', () => {
    const r = buildEngineeringInventoryReport(
      [ec({ id: 'a', status: 'fuera_servicio' })],
      ['altura'],
    );
    expect(r.coveredRiskCategories).toEqual([]);
    expect(r.uncoveredRiskCategories).toContain('altura');
    expect(r.outOfService).toHaveLength(1);
  });
});

describe('auditRiskHierarchy', () => {
  it('solo EPP → onlyLowerTier true', () => {
    const r = auditRiskHierarchy({
      riskCategory: 'altura',
      presentLevels: new Set(['epp', 'administrative']),
    });
    expect(r.onlyLowerTier).toBe(true);
    expect(r.highestLevelApplied).toBe('administrative');
    expect(r.suggestedAdditions).toContain('engineering');
  });

  it('engineering presente → no onlyLowerTier', () => {
    const r = auditRiskHierarchy({
      riskCategory: 'altura',
      presentLevels: new Set(['engineering', 'epp']),
    });
    expect(r.onlyLowerTier).toBe(false);
    expect(r.highestLevelApplied).toBe('engineering');
  });

  it('elimination presente → suggestedAdditions vacío (o solo refinamientos)', () => {
    const r = auditRiskHierarchy({
      riskCategory: 'quimico',
      presentLevels: new Set(['elimination', 'epp']),
    });
    expect(r.suggestedAdditions).not.toContain('elimination');
  });
});

describe('auditEppQuality', () => {
  function epp(over: Partial<EppItem> & { id: string }): EppItem {
    return {
      id: over.id,
      category: over.category ?? 'arnés',
      workerUid: over.workerUid ?? 'w1',
      handedOverAt: over.handedOverAt ?? '2026-01-01T00:00:00Z',
      estimatedLifespanDays: over.estimatedLifespanDays ?? 365,
      inUse: over.inUse ?? true,
      lastInspectedAt: over.lastInspectedAt,
      inspectedState: over.inspectedState,
      expectedReplacementAt: over.expectedReplacementAt,
    };
  }

  it('EPP nunca inspeccionado en >90d → issue', () => {
    const r = auditEppQuality(
      [epp({ id: 'e1', handedOverAt: '2026-01-01T00:00:00Z' })],
      '2026-05-11T00:00:00Z',
    );
    expect(r.byIssue.never_inspected).toBe(1);
  });

  it('EPP inutilizable aún en uso → issue', () => {
    const r = auditEppQuality(
      [
        epp({
          id: 'e1',
          lastInspectedAt: '2026-05-01T00:00:00Z',
          inspectedState: 'inutilizable',
        }),
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.byIssue.inutilizable_still_in_use).toBe(1);
  });

  it('EPP past lifespan → issue', () => {
    const r = auditEppQuality(
      [
        epp({
          id: 'e1',
          lastInspectedAt: '2026-05-01T00:00:00Z',
          expectedReplacementAt: '2026-04-01T00:00:00Z',
        }),
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.byIssue.past_lifespan).toBe(1);
  });

  it('EPP no inUse no genera issues', () => {
    const r = auditEppQuality(
      [epp({ id: 'e1', inUse: false, inspectedState: 'inutilizable' })],
      '2026-05-11T00:00:00Z',
    );
    expect(r.withIssues).toBe(0);
  });

  it('EPP observado sin acción → issue', () => {
    const r = auditEppQuality(
      [
        epp({
          id: 'e1',
          lastInspectedAt: '2026-05-01T00:00:00Z',
          inspectedState: 'observado',
        }),
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.byIssue.observado_no_action).toBe(1);
  });
});
