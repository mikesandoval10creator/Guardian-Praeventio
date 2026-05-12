import { describe, it, expect } from 'vitest';
import {
  computeResidualRisk,
  detectCriticalityDrift,
  classifyRiskKinds,
  type RiskAssessment,
  type CriticalityChangeEvent,
} from './residualRiskEngine.js';

describe('computeResidualRisk', () => {
  it('riesgo alto + sin controles → residual = inicial', () => {
    const assessment: RiskAssessment = {
      riskId: 'r1',
      category: 'altura',
      likelihood: 'likely',
      severity: 'major',
      riskKind: 'physical',
    };
    const r = computeResidualRisk(assessment, []);
    expect(r.initialScore).toBe(16); // likely=4 * major=4
    expect(r.residualScore).toBe(16);
    expect(r.residualLevel).toBe('extreme');
    expect(r.requiresFormalAcceptance).toBe(true);
  });

  it('controles efectivos bajan el riesgo', () => {
    const r = computeResidualRisk(
      {
        riskId: 'r1',
        category: 'altura',
        likelihood: 'likely',
        severity: 'major',
        riskKind: 'physical',
      },
      [
        { controlId: 'c1', effectiveness: 'full' }, // -14
        { controlId: 'c2', effectiveness: 'significant' }, // -8
      ],
    );
    expect(r.controlReduction).toBe(22);
    expect(r.residualScore).toBe(1); // min 1
    expect(r.residualLevel).toBe('low');
  });

  it('residual high → requiresFormalAcceptance', () => {
    const r = computeResidualRisk(
      {
        riskId: 'r1',
        category: 'altura',
        likelihood: 'likely',
        severity: 'major',
        riskKind: 'physical',
      },
      [{ controlId: 'c1', effectiveness: 'partial' }], // -4
    );
    expect(r.residualScore).toBe(12);
    expect(r.residualLevel).toBe('high');
    expect(r.requiresFormalAcceptance).toBe(true);
  });

  it('residual low → no formal acceptance', () => {
    const r = computeResidualRisk(
      {
        riskId: 'r1',
        category: 'altura',
        likelihood: 'rare',
        severity: 'minor',
        riskKind: 'physical',
      },
      [],
    );
    expect(r.residualLevel).toBe('low');
    expect(r.requiresFormalAcceptance).toBe(false);
  });

  it('extreme → revisión a 30d, high → 90d, medium → 180d, low → 365d', () => {
    const high = computeResidualRisk(
      {
        riskId: 'r1',
        category: 'altura',
        likelihood: 'likely',
        severity: 'major',
        riskKind: 'physical',
      },
      [{ controlId: 'c1', effectiveness: 'partial' }],
    );
    expect(high.nextReviewInDays).toBe(90);

    const extreme = computeResidualRisk(
      {
        riskId: 'r2',
        category: 'altura',
        likelihood: 'almost_certain',
        severity: 'catastrophic',
        riskKind: 'physical',
      },
      [],
    );
    expect(extreme.nextReviewInDays).toBe(30);
  });
});

describe('detectCriticalityDrift', () => {
  function change(over: Partial<CriticalityChangeEvent> & { daysAgo?: number }): CriticalityChangeEvent {
    return {
      riskId: over.riskId ?? 'r1',
      fromLevel: over.fromLevel ?? 'high',
      toLevel: over.toLevel ?? 'low',
      changedAt: new Date(
        Date.parse('2026-05-11T10:00:00Z') - (over.daysAgo ?? 0) * 86_400_000,
      ).toISOString(),
      changedByUid: over.changedByUid ?? 'sup1',
      rationale: over.rationale ?? 'sin razón',
      hasEvidence: over.hasEvidence ?? false,
    };
  }

  it('vacío → no sospechoso', () => {
    const r = detectCriticalityDrift([], 7, '2026-05-11T10:00:00Z');
    expect(r.isSuspicious).toBe(false);
  });

  it('>=5 bajadas sin evidencia → sospechoso', () => {
    const events = [1, 2, 3, 4, 5, 6].map((n) =>
      change({ riskId: `r${n}`, daysAgo: n - 1, hasEvidence: false }),
    );
    const r = detectCriticalityDrift(events, 7, '2026-05-11T10:00:00Z');
    expect(r.isSuspicious).toBe(true);
    expect(r.unbackedDowngrades).toBe(6);
  });

  it('bajadas con evidencia → no sospechoso', () => {
    const events = [1, 2, 3, 4, 5].map((n) =>
      change({ riskId: `r${n}`, daysAgo: n - 1, hasEvidence: true }),
    );
    const r = detectCriticalityDrift(events, 7, '2026-05-11T10:00:00Z');
    expect(r.isSuspicious).toBe(false);
    expect(r.unbackedRate).toBe(0);
  });

  it('70%+ bajadas sin evidencia (con >=3) → sospechoso', () => {
    const events = [
      change({ riskId: 'r1', daysAgo: 1, hasEvidence: false }),
      change({ riskId: 'r2', daysAgo: 2, hasEvidence: false }),
      change({ riskId: 'r3', daysAgo: 3, hasEvidence: false }),
      change({ riskId: 'r4', daysAgo: 4, hasEvidence: true }), // 1/4 con ev = 75% sin
    ];
    const r = detectCriticalityDrift(events, 7, '2026-05-11T10:00:00Z');
    expect(r.unbackedRate).toBe(75);
    expect(r.isSuspicious).toBe(true);
  });
});

describe('classifyRiskKinds', () => {
  it('cuenta físico vs administrativo', () => {
    const assessments: RiskAssessment[] = [
      { riskId: 'r1', category: 'altura', likelihood: 'likely', severity: 'major', riskKind: 'physical' },
      { riskId: 'r2', category: 'electric', likelihood: 'possible', severity: 'moderate', riskKind: 'physical' },
      { riskId: 'r3', category: 'documentation', likelihood: 'rare', severity: 'minor', riskKind: 'administrative' },
    ];
    const s = classifyRiskKinds(assessments);
    expect(s.physical).toBe(2);
    expect(s.administrative).toBe(1);
    expect(s.recommendation).toMatch(/balanceado/i);
  });

  it('mayoría administrativos → recomendación de foco físico', () => {
    const assessments: RiskAssessment[] = [
      { riskId: 'r1', category: 'doc1', likelihood: 'rare', severity: 'minor', riskKind: 'administrative' },
      { riskId: 'r2', category: 'doc2', likelihood: 'rare', severity: 'minor', riskKind: 'administrative' },
      { riskId: 'r3', category: 'doc3', likelihood: 'rare', severity: 'minor', riskKind: 'administrative' },
      { riskId: 'r4', category: 'altura', likelihood: 'rare', severity: 'minor', riskKind: 'physical' },
    ];
    const s = classifyRiskKinds(assessments);
    expect(s.recommendation).toMatch(/NO desviar|brechas/i);
  });
});
