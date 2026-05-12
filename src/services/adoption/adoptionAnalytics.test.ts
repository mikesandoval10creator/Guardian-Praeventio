import { describe, it, expect } from 'vitest';
import {
  buildModuleAdoptionReport,
  buildFunnelReport,
  assessChurnRisk,
  buildFirstValueReport,
  type TenantUsageSnapshot,
} from './adoptionAnalytics.js';

function snap(over: Partial<TenantUsageSnapshot> & { tenantId: string }): TenantUsageSnapshot {
  return {
    tenantId: over.tenantId,
    snapshotAt: over.snapshotAt ?? '2026-05-11T10:00:00Z',
    daysSinceSignup: over.daysSinceSignup ?? 30,
    activeModules: over.activeModules ?? new Set(['projects', 'workers']),
    events30d: over.events30d ?? 50,
    activeWorkers: over.activeWorkers ?? 10,
    activeProjects: over.activeProjects ?? 1,
    hasPaidPlan: over.hasPaidPlan ?? true,
  };
}

describe('buildModuleAdoptionReport', () => {
  it('% adopters por módulo', () => {
    const r = buildModuleAdoptionReport([
      snap({ tenantId: 't1', activeModules: new Set(['projects', 'incidents']) }),
      snap({ tenantId: 't2', activeModules: new Set(['projects', 'sitebook']) }),
      snap({ tenantId: 't3', activeModules: new Set(['projects']) }),
    ]);
    expect(r.byModule.projects.adoptionPercent).toBe(100);
    expect(r.byModule.incidents.adoptionPercent).toBe(33);
    expect(r.byModule.cphs.adoptionPercent).toBe(0);
  });
});

describe('buildFunnelReport', () => {
  it('embudo decreciente', () => {
    const r = buildFunnelReport([
      snap({
        tenantId: 't1',
        activeProjects: 1,
        activeWorkers: 5,
        activeModules: new Set(['projects', 'incidents', 'documents']),
        events30d: 50,
      }),
      snap({
        tenantId: 't2',
        activeProjects: 1,
        activeWorkers: 0,
        activeModules: new Set(['projects']),
        events30d: 5,
      }),
      snap({
        tenantId: 't3',
        activeProjects: 0,
        activeWorkers: 0,
        activeModules: new Set(),
        events30d: 0,
      }),
    ]);
    const signupStage = r.stages.find((s) => s.stage === 'signup')!;
    expect(signupStage.reached).toBe(3);
    const dailyStage = r.stages.find((s) => s.stage === 'daily_active')!;
    expect(dailyStage.reached).toBe(1); // solo t1
  });
});

describe('assessChurnRisk', () => {
  it('0 eventos + sin módulos + sin proyecto → critical', () => {
    const r = assessChurnRisk(
      snap({
        tenantId: 't1',
        events30d: 0,
        activeModules: new Set(),
        activeProjects: 0,
        daysSinceSignup: 45,
      }),
    );
    expect(r.level).toBe('critical');
  });

  it('tenant activo → low', () => {
    const r = assessChurnRisk(snap({ tenantId: 't1' }));
    expect(r.level).toBe('low');
  });

  it('30d+ sin proyecto → high o critical risk', () => {
    const r = assessChurnRisk(
      snap({ tenantId: 't1', daysSinceSignup: 45, activeProjects: 0, events30d: 2, activeModules: new Set() }),
    );
    expect(['high', 'critical']).toContain(r.level);
  });
});

describe('buildFirstValueReport', () => {
  it('cuenta reached + stuck', () => {
    const r = buildFirstValueReport(
      [
        { tenantId: 't1', signupAt: '2026-05-01T00:00:00Z', firstValueAt: '2026-05-05T00:00:00Z' },
        { tenantId: 't2', signupAt: '2026-05-01T00:00:00Z' }, // stuck > 7d
        { tenantId: 't3', signupAt: '2026-05-09T00:00:00Z' }, // aún no stuck
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.reachedFirstValue).toBe(1);
    expect(r.stuckCount).toBe(1);
    expect(r.averageDaysToFirstValue).toBe(4);
  });
});
