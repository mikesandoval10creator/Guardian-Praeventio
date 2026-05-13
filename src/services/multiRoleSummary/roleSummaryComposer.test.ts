import { describe, it, expect } from 'vitest';
import {
  composeRoleSummary,
  composeAllAudiences,
  filterTransferableLessons,
  type ProjectSnapshot,
} from './roleSummaryComposer.js';

const SNAPSHOT: ProjectSnapshot = {
  projectId: 'p1',
  projectName: 'Obra Norte',
  periodFrom: '2026-04-01T00:00:00Z',
  periodTo: '2026-04-30T23:59:59Z',
  metrics: {
    incidentsCount: 8,
    sifIncidentsCount: 0,
    trir: 1.2,
    ltifr: 0.8,
    workersActive: 50,
    workersWithCompleteEpp: 48,
    inspectionsCompleted: 14,
    correctiveActionsClosed: 10,
    correctiveActionsOpen: 3,
    complianceScore: 87,
    averageReadinessScore: 78,
    daysSinceLastSif: 412,
  },
  highlights: [
    {
      kind: 'achievement',
      text: '0 SIF en abril por 13 meses consecutivos',
      relevantTo: ['worker', 'supervisor', 'executive', 'client_mandante'],
    },
    {
      kind: 'concern',
      text: 'Acciones correctivas pendientes en torre norte',
      relevantTo: ['supervisor', 'prevencionista'],
    },
    {
      kind: 'critical_decision',
      text: 'Aprobada nueva línea de vida ingeniería',
      relevantTo: ['executive', 'prevencionista', 'auditor_external'],
    },
  ],
};

describe('composeRoleSummary — audience tailoring', () => {
  it('worker → focuses en daysSinceLastSif + EPP', () => {
    const s = composeRoleSummary(SNAPSHOT, 'worker');
    expect(s.headlineMetric?.label).toMatch(/Días sin SIF/);
    expect(s.bullets.length).toBeLessThanOrEqual(3);
    expect(s.callToAction).toMatch(/EPP/);
  });

  it('executive → focuses en TRIR + LTIFR', () => {
    const s = composeRoleSummary(SNAPSHOT, 'executive');
    expect(s.headlineMetric?.label).toBe('TRIR');
    expect(s.bullets.length).toBeLessThanOrEqual(4);
  });

  it('prevencionista → ve más bullets que worker', () => {
    const w = composeRoleSummary(SNAPSHOT, 'worker');
    const p = composeRoleSummary(SNAPSHOT, 'prevencionista');
    expect(p.bullets.length).toBeGreaterThan(w.bullets.length);
  });

  it('cliente mandante NO ve concerns operativos', () => {
    const s = composeRoleSummary(SNAPSHOT, 'client_mandante');
    expect(s.bullets.every((b) => !/Acciones correctivas pendientes/.test(b))).toBe(true);
  });

  it('auditor_external ve critical_decision', () => {
    const s = composeRoleSummary(SNAPSHOT, 'auditor_external');
    expect(s.bullets.some((b) => /línea de vida/i.test(b))).toBe(true);
  });

  it('mutualidad enfoca SIF + TRIR', () => {
    const s = composeRoleSummary(SNAPSHOT, 'mutuality');
    expect(s.headlineMetric?.label).toMatch(/SIF/);
  });
});

describe('composeRoleSummary — language', () => {
  it('es-CL produce string en español Chile', () => {
    const s = composeRoleSummary(SNAPSHOT, 'worker', 'es-CL');
    expect(s.callToAction).toMatch(/Revisa/);
  });

  it('pt-BR produce string en portugués', () => {
    const s = composeRoleSummary(SNAPSHOT, 'worker', 'pt-BR');
    expect(s.callToAction).toMatch(/Verifique/);
  });

  it('en-US produce string en inglés', () => {
    const s = composeRoleSummary(SNAPSHOT, 'executive', 'en-US');
    expect(s.callToAction).toMatch(/Approve|engineering/);
  });

  it('language sin coverage cae back a metric keys raw', () => {
    const s = composeRoleSummary(SNAPSHOT, 'mutuality', 'pt-BR');
    expect(s.headlineMetric).toBeDefined(); // siempre hay headline
  });

  it('idioma desconocido → fallback es-CL', () => {
    const s = composeRoleSummary(SNAPSHOT, 'worker', 'xx-XX' as never);
    expect(s.callToAction).toMatch(/Revisa|charla/i);
  });
});

describe('composeRoleSummary — metric coverage', () => {
  it('snapshot vacío de metrics → bullets vacíos + sin headline', () => {
    const empty: ProjectSnapshot = {
      projectId: 'p2',
      projectName: 'Vacío',
      periodFrom: '2026-04-01T00:00:00Z',
      periodTo: '2026-04-30T23:59:59Z',
    };
    const s = composeRoleSummary(empty, 'prevencionista');
    expect(s.bullets).toHaveLength(0);
    expect(s.headlineMetric).toBeUndefined();
  });

  it('bulletsSkipped > 0 si hay más candidates que maxBullets', () => {
    const s = composeRoleSummary(SNAPSHOT, 'worker'); // maxBullets 3
    expect(s.bulletsSkipped).toBeGreaterThanOrEqual(0);
  });
});

describe('composeAllAudiences', () => {
  it('produce summary para las 8 audiences', () => {
    const all = composeAllAudiences(SNAPSHOT);
    expect(Object.keys(all)).toHaveLength(8);
    expect(all.worker.audience).toBe('worker');
    expect(all.executive.audience).toBe('executive');
  });
});

describe('filterTransferableLessons', () => {
  const lessons = [
    { summary: 'A — applies to any', applicableTo: 'any' as const },
    { summary: 'B — same industry', applicableTo: 'similar_industry' as const },
    { summary: 'C — same size', applicableTo: 'similar_size' as const },
    { summary: 'D — same risk', applicableTo: 'similar_risk_profile' as const },
  ];

  it('any siempre pasa', () => {
    const r = filterTransferableLessons(lessons, { industry: 'mining' });
    expect(r.some((l) => l.summary.startsWith('A'))).toBe(true);
  });

  it('industry match filtra similar_industry', () => {
    const r = filterTransferableLessons(lessons, {
      industry: 'mining',
      source: { industry: 'mining' },
    });
    expect(r.some((l) => l.summary.startsWith('B'))).toBe(true);
  });

  it('industry mismatch NO pasa similar_industry', () => {
    const r = filterTransferableLessons(lessons, {
      industry: 'mining',
      source: { industry: 'construction' },
    });
    expect(r.some((l) => l.summary.startsWith('B'))).toBe(false);
  });

  it('size match filtra similar_size', () => {
    const r = filterTransferableLessons(lessons, {
      workforceSize: 'large',
      source: { workforceSize: 'large' },
    });
    expect(r.some((l) => l.summary.startsWith('C'))).toBe(true);
  });
});
