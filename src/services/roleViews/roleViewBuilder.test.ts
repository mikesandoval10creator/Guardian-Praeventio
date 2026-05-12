import { describe, it, expect } from 'vitest';
import { buildRoleView, type RoleViewState } from './roleViewBuilder.js';

function baseState(over: Partial<RoleViewState> = {}): RoleViewState {
  return {
    userUid: 'u1',
    userRole: 'worker',
    overdueActions: 0,
    pendingApprovals: 0,
    todaysTasks: 0,
    myEppExpiringSoon: 0,
    myTrainingExpiringSoon: 0,
    myUnreadDocuments: 0,
    criticalIncidentsLast7d: 0,
    faenaState: 'operativa',
    ...over,
  };
}

describe('buildRoleView — worker', () => {
  it('siempre incluye card SOS', () => {
    const cards = buildRoleView(baseState({ userRole: 'worker' }));
    expect(cards.some((c) => c.category === 'emergency')).toBe(true);
  });

  it('muestra tareas hoy si > 0', () => {
    const cards = buildRoleView(baseState({ userRole: 'worker', todaysTasks: 3 }));
    expect(cards.find((c) => c.id === 'w-tasks')?.count).toBe(3);
  });

  it('muestra EPP expiring', () => {
    const cards = buildRoleView(baseState({ userRole: 'worker', myEppExpiringSoon: 1 }));
    expect(cards.some((c) => c.id === 'w-epp')).toBe(true);
  });

  it('muestra documentos por leer', () => {
    const cards = buildRoleView(baseState({ userRole: 'worker', myUnreadDocuments: 2 }));
    expect(cards.some((c) => c.id === 'w-docs')).toBe(true);
  });
});

describe('buildRoleView — site_chief', () => {
  it('faena en emergencia → card urgent', () => {
    const cards = buildRoleView(baseState({ userRole: 'site_chief', faenaState: 'emergencia' }));
    const stateCard = cards.find((c) => c.id === 'sc-state');
    expect(stateCard?.severity).toBe('urgent');
  });

  it('overdue actions visible', () => {
    const cards = buildRoleView(baseState({ userRole: 'site_chief', overdueActions: 5 }));
    expect(cards.find((c) => c.id === 'sc-overdue')?.count).toBe(5);
  });

  it('pending approvals visible', () => {
    const cards = buildRoleView(baseState({ userRole: 'site_chief', pendingApprovals: 2 }));
    expect(cards.some((c) => c.id === 'sc-approve')).toBe(true);
  });
});

describe('buildRoleView — prevention', () => {
  it('agrega compliance score si presente', () => {
    const cards = buildRoleView(
      baseState({ userRole: 'prevention', complianceScore: 75 }),
    );
    expect(cards.find((c) => c.id === 'p-compliance')?.title).toContain('75');
  });

  it('compliance bajo 60 → urgent', () => {
    const cards = buildRoleView(
      baseState({ userRole: 'prevention', complianceScore: 40 }),
    );
    const c = cards.find((c) => c.id === 'p-compliance');
    expect(c?.severity).toBe('urgent');
  });

  it('compliance >= 80 → info', () => {
    const cards = buildRoleView(
      baseState({ userRole: 'prevention', complianceScore: 90 }),
    );
    expect(cards.find((c) => c.id === 'p-compliance')?.severity).toBe('info');
  });
});

describe('buildRoleView — management', () => {
  it('compliance global card', () => {
    const cards = buildRoleView(
      baseState({ userRole: 'management', complianceScore: 88 }),
    );
    expect(cards.find((c) => c.id === 'mg-compliance')).toBeDefined();
  });

  it('overview con proyectos + workers', () => {
    const cards = buildRoleView(
      baseState({
        userRole: 'management',
        totalActiveProjects: 5,
        totalActiveWorkers: 120,
      }),
    );
    const overview = cards.find((c) => c.id === 'mg-overview');
    expect(overview?.title).toContain('5 proyectos');
    expect(overview?.title).toContain('120 trabajadores');
  });

  it('ROI mensual visible si presente', () => {
    const cards = buildRoleView(
      baseState({ userRole: 'management', preventiveROIClpMonth: 2_500_000 }),
    );
    expect(cards.find((c) => c.id === 'mg-roi')?.title).toContain('2.5M');
  });

  it('incidentes críticos → urgent', () => {
    const cards = buildRoleView(
      baseState({ userRole: 'management', criticalIncidentsLast7d: 2 }),
    );
    expect(cards.find((c) => c.id === 'mg-incidents')?.severity).toBe('urgent');
  });
});

describe('cobertura roles', () => {
  it('cada role devuelve al menos 1 card', () => {
    for (const role of ['worker', 'site_chief', 'prevention', 'management'] as const) {
      const cards = buildRoleView(baseState({ userRole: role, faenaState: 'emergencia', overdueActions: 3 }));
      expect(cards.length).toBeGreaterThan(0);
    }
  });
});
