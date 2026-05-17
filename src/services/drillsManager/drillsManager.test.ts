import { describe, it, expect } from 'vitest';
import {
  LEGAL_FREQUENCY_DAYS,
  evaluateDrillResult,
  buildDrillComplianceReport,
  type DrillResult,
} from './drillsManager.js';

function result(over: Partial<DrillResult> & { id: string }): DrillResult {
  return {
    id: over.id,
    drillKind: over.drillKind ?? 'evacuation',
    executedAt: over.executedAt ?? '2026-05-01T10:00:00Z',
    participantCount: over.participantCount ?? 95,
    expectedCount: over.expectedCount ?? 100,
    responseTimeSeconds: over.responseTimeSeconds ?? 180,
    benchmarkSeconds: over.benchmarkSeconds ?? 240,
    observedGaps: over.observedGaps ?? [],
    requiredExternal: over.requiredExternal ?? false,
  };
}

describe('LEGAL_FREQUENCY_DAYS', () => {
  it('evacuation = semestral 183d (DS 132)', () => {
    expect(LEGAL_FREQUENCY_DAYS.evacuation).toBe(183);
  });
});

describe('evaluateDrillResult', () => {
  it('participación 95% + más rápido + sin gaps → excellent', () => {
    const r = evaluateDrillResult(result({ id: 'd1' }));
    expect(r.level).toBe('excellent');
    expect(r.participationRate).toBe(95);
  });

  it('lentitud >40% → needs_improvement', () => {
    const r = evaluateDrillResult(
      result({ id: 'd1', responseTimeSeconds: 500, benchmarkSeconds: 240 }),
    );
    expect(r.speedDeficitPercent).toBeGreaterThan(40);
    expect(['needs_improvement', 'critical']).toContain(r.level);
  });

  it('participación <60% → critical', () => {
    const r = evaluateDrillResult(
      result({ id: 'd1', participantCount: 40, expectedCount: 100 }),
    );
    expect(r.level).toBe('critical');
  });

  it('recomendaciones específicas', () => {
    const r = evaluateDrillResult(
      result({
        id: 'd1',
        participantCount: 50,
        expectedCount: 100,
        observedGaps: ['salida emergencia bloqueada'],
        requiredExternal: true,
      }),
    );
    expect(r.recommendations.length).toBeGreaterThanOrEqual(3);
  });

  // Codex PR #316 P2 (sprintK.ts line 1300): sin baselines reales no
  // debemos gradear como "Excelente" por default. Antes el route
  // defaulteaba `expectedCount` a `participantCount` y `benchmarkSeconds`
  // a `responseTimeSeconds`, haciendo que participación = 100% y déficit
  // = 0% siempre. Ahora reportamos `insufficient_baseline`.
  describe('insufficient_baseline (Codex PR #316 P2)', () => {
    it('sin expectedCount → insufficient_baseline y participationRate null', () => {
      const r = evaluateDrillResult({
        id: 'd1',
        drillKind: 'evacuation',
        executedAt: '2026-05-01T10:00:00Z',
        participantCount: 95,
        responseTimeSeconds: 180,
        benchmarkSeconds: 240,
        observedGaps: [],
        requiredExternal: false,
      });
      expect(r.level).toBe('insufficient_baseline');
      expect(r.participationRate).toBeNull();
      expect(r.speedDeficitPercent).not.toBeNull();
      expect(r.recommendations.some((s) => /Baseline insuficiente/.test(s))).toBe(
        true,
      );
    });

    it('sin benchmarkSeconds → insufficient_baseline y speedDeficitPercent null', () => {
      const r = evaluateDrillResult({
        id: 'd1',
        drillKind: 'evacuation',
        executedAt: '2026-05-01T10:00:00Z',
        participantCount: 95,
        expectedCount: 100,
        responseTimeSeconds: 180,
        observedGaps: [],
        requiredExternal: false,
      });
      expect(r.level).toBe('insufficient_baseline');
      expect(r.speedDeficitPercent).toBeNull();
      expect(r.participationRate).toBe(95);
    });

    it('sin ningún baseline → insufficient_baseline con ambos null', () => {
      const r = evaluateDrillResult({
        id: 'd1',
        drillKind: 'evacuation',
        executedAt: '2026-05-01T10:00:00Z',
        participantCount: 95,
        responseTimeSeconds: 180,
        observedGaps: [],
        requiredExternal: false,
      });
      expect(r.level).toBe('insufficient_baseline');
      expect(r.participationRate).toBeNull();
      expect(r.speedDeficitPercent).toBeNull();
    });

    it('expectedCount = 0 → tratado como baseline ausente', () => {
      const r = evaluateDrillResult({
        id: 'd1',
        drillKind: 'evacuation',
        executedAt: '2026-05-01T10:00:00Z',
        participantCount: 0,
        expectedCount: 0,
        responseTimeSeconds: 180,
        benchmarkSeconds: 240,
        observedGaps: [],
        requiredExternal: false,
      });
      expect(r.level).toBe('insufficient_baseline');
    });

    it('insufficient_baseline preserva recomendaciones de gaps y externa', () => {
      const r = evaluateDrillResult({
        id: 'd1',
        drillKind: 'evacuation',
        executedAt: '2026-05-01T10:00:00Z',
        participantCount: 95,
        responseTimeSeconds: 180,
        observedGaps: ['salida bloqueada'],
        requiredExternal: true,
      });
      expect(r.level).toBe('insufficient_baseline');
      expect(r.recommendations.length).toBeGreaterThanOrEqual(3);
      expect(r.recommendations.some((s) => /Baseline insuficiente/.test(s))).toBe(
        true,
      );
      expect(r.recommendations.some((s) => /salida bloqueada/.test(s))).toBe(
        true,
      );
      expect(r.recommendations.some((s) => /externa/i.test(s))).toBe(true);
    });
  });
});

describe('buildDrillComplianceReport', () => {
  it('sin simulacros → todos overdue', () => {
    const r = buildDrillComplianceReport([], '2026-05-11T00:00:00Z');
    expect(r.every((rep) => rep.isOverdue)).toBe(true);
  });

  it('último simulacro reciente → no overdue', () => {
    const r = buildDrillComplianceReport(
      [result({ id: 'd1', drillKind: 'evacuation', executedAt: '2026-04-01T00:00:00Z' })],
      '2026-05-11T00:00:00Z',
    );
    const evac = r.find((rep) => rep.kind === 'evacuation')!;
    expect(evac.isOverdue).toBe(false);
    expect(evac.daysUntilDue).toBeGreaterThan(0);
  });

  it('simulacro de hace >183d → overdue', () => {
    const r = buildDrillComplianceReport(
      [result({ id: 'd1', drillKind: 'evacuation', executedAt: '2025-01-01T00:00:00Z' })],
      '2026-05-11T00:00:00Z',
    );
    const evac = r.find((rep) => rep.kind === 'evacuation')!;
    expect(evac.isOverdue).toBe(true);
  });
});
