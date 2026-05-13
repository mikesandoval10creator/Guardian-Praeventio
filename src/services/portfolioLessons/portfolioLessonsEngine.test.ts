// Praeventio Guard — Sprint 53 tests para portfolio lessons transfer engine.
//
// Cubre:
//   - Scoring (industry/size/projectKind/risk similarity/severity/tags).
//   - highPriority gate (score ≥ 75 AND (incident OR severity≥high)).
//   - Filtros (sourceProjectId == target, minMatchScore, maxResults).
//   - Determinismo de orden (score desc, severity tiebreaker).
//   - summarizePortfolioLearning (counts + transferableCount).

import { describe, it, expect } from 'vitest';
import {
  recommendLessons,
  summarizePortfolioLearning,
  type LessonRecord,
  type TargetProjectContext,
} from './portfolioLessonsEngine.js';

function lesson(over: Partial<LessonRecord> & { id: string }): LessonRecord {
  return {
    id: over.id,
    sourceProjectId: over.sourceProjectId ?? 'src-p1',
    title: over.title ?? 'Lección portfolio',
    category: over.category ?? 'good_practice',
    applicableIndustries: over.applicableIndustries ?? ['construction'],
    applicableSizes: over.applicableSizes ?? ['medium'],
    applicableProjectKinds: over.applicableProjectKinds,
    capturedAt: over.capturedAt ?? '2026-01-01T00:00:00Z',
    tags: over.tags ?? ['altura'],
    originalSeverity: over.originalSeverity,
    estimatedTransferValueClp: over.estimatedTransferValueClp,
  };
}

function target(over: Partial<TargetProjectContext> = {}): TargetProjectContext {
  return {
    projectId: over.projectId ?? 'tgt-1',
    industry: over.industry ?? 'construction',
    size: over.size ?? 'medium',
    projectKind: over.projectKind,
    tags: over.tags,
    currentRisksSimilarity: over.currentRisksSimilarity ?? 0,
  };
}

describe('recommendLessons — scoring components', () => {
  it('industry match aporta 40 pts', () => {
    const recos = recommendLessons([lesson({ id: 'l1' })], target());
    expect(recos).toHaveLength(1);
    expect(recos[0].matchScore).toBeGreaterThanOrEqual(40);
    expect(recos[0].applicabilityReasons.some((r) => r.includes('Industria'))).toBe(true);
  });

  it('size match aporta 20 pts', () => {
    const recos = recommendLessons(
      [lesson({ id: 'l1', applicableSizes: ['medium', 'large'] })],
      target({ size: 'large' }),
    );
    expect(recos[0].applicabilityReasons.some((r) => r.includes('Tamaño'))).toBe(true);
  });

  it('projectKind match aporta 10 pts', () => {
    const recos = recommendLessons(
      [lesson({ id: 'l1', applicableProjectKinds: ['edificio', 'puente'] })],
      target({ projectKind: 'puente' }),
    );
    const r = recos[0];
    expect(r.applicabilityReasons.some((x) => x.includes('Tipo de proyecto'))).toBe(true);
    // industry (40) + size (20) + kind (10) = 70
    expect(r.matchScore).toBe(70);
  });

  it('currentRisksSimilarity * 30 pts aporta linealmente', () => {
    const recos = recommendLessons(
      [lesson({ id: 'l1' })],
      target({ currentRisksSimilarity: 0.5 }),
    );
    // 40 + 20 + 0.5*30 = 75
    expect(recos[0].matchScore).toBe(75);
  });

  it('clampea currentRisksSimilarity fuera de [0,1]', () => {
    const recosHigh = recommendLessons(
      [lesson({ id: 'l1' })],
      target({ currentRisksSimilarity: 99 }),
    );
    // 40 + 20 + 30 (clamped) = 90
    expect(recosHigh[0].matchScore).toBe(90);
    const recosNeg = recommendLessons(
      [lesson({ id: 'l2' })],
      target({ currentRisksSimilarity: -2 }),
    );
    expect(recosNeg[0].matchScore).toBe(60);
  });

  it('severity bonus: sif/critical = +10, high = +5', () => {
    const sif = recommendLessons(
      [lesson({ id: 'l1', originalSeverity: 'sif' })],
      target(),
    );
    const crit = recommendLessons(
      [lesson({ id: 'l2', originalSeverity: 'critical' })],
      target(),
    );
    const high = recommendLessons(
      [lesson({ id: 'l3', originalSeverity: 'high' })],
      target(),
    );
    const low = recommendLessons(
      [lesson({ id: 'l4', originalSeverity: 'low' })],
      target(),
    );
    expect(sif[0].matchScore).toBe(70);
    expect(crit[0].matchScore).toBe(70);
    expect(high[0].matchScore).toBe(65);
    expect(low[0].matchScore).toBe(60);
  });

  it('tag overlap aporta 5pts por tag, capeado a +20', () => {
    const l = lesson({
      id: 'l1',
      tags: ['altura', 'epp', 'arnes', 'andamio', 'rescate'],
    });
    const recos = recommendLessons(
      [l],
      target({ tags: ['altura', 'epp', 'arnes', 'andamio', 'rescate', 'extra'] }),
    );
    // 40 + 20 + cap 20 = 80
    expect(recos[0].matchScore).toBe(80);
    expect(recos[0].applicabilityReasons.some((r) => r.includes('Tags en común'))).toBe(true);
  });

  it('no aporta industry pts si no matchea', () => {
    const recos = recommendLessons(
      [lesson({ id: 'l1', applicableIndustries: ['mining'] })],
      target({ industry: 'construction' }),
    );
    // size 20 only
    expect(recos[0]?.matchScore ?? 0).toBe(20);
  });
});

describe('recommendLessons — highPriority gate', () => {
  it('marca highPriority cuando score ≥ 75 y category=incident', () => {
    const recos = recommendLessons(
      [
        lesson({
          id: 'l1',
          category: 'incident',
          applicableProjectKinds: ['edificio'],
        }),
      ],
      target({ projectKind: 'edificio', currentRisksSimilarity: 0.2 }),
    );
    // 40 + 20 + 10 + 6 = 76
    expect(recos[0].matchScore).toBeGreaterThanOrEqual(75);
    expect(recos[0].highPriority).toBe(true);
  });

  it('marca highPriority con severity high+ aún si category != incident', () => {
    const recos = recommendLessons(
      [
        lesson({
          id: 'l1',
          category: 'good_practice',
          originalSeverity: 'critical',
          applicableProjectKinds: ['edificio'],
        }),
      ],
      target({ projectKind: 'edificio', currentRisksSimilarity: 0.5 }),
    );
    // 40 + 20 + 10 + 15 + 10 = 95
    expect(recos[0].matchScore).toBeGreaterThanOrEqual(75);
    expect(recos[0].highPriority).toBe(true);
  });

  it('NO marca highPriority con score < 75 aunque sea incident', () => {
    const recos = recommendLessons(
      [lesson({ id: 'l1', category: 'incident' })],
      target(),
    );
    expect(recos[0].matchScore).toBeLessThan(75);
    expect(recos[0].highPriority).toBe(false);
  });

  it('NO marca highPriority con score alto pero category=culture y severity=medium', () => {
    const recos = recommendLessons(
      [
        lesson({
          id: 'l1',
          category: 'culture',
          originalSeverity: 'medium',
          applicableProjectKinds: ['edificio'],
        }),
      ],
      target({ projectKind: 'edificio', currentRisksSimilarity: 0.5 }),
    );
    expect(recos[0].matchScore).toBeGreaterThanOrEqual(75);
    expect(recos[0].highPriority).toBe(false);
  });
});

describe('recommendLessons — filters & ordering', () => {
  it('excluye lecciones cuyo sourceProjectId == target.projectId', () => {
    const recos = recommendLessons(
      [
        lesson({ id: 'l1', sourceProjectId: 'tgt-1' }),
        lesson({ id: 'l2', sourceProjectId: 'src-2' }),
      ],
      target({ projectId: 'tgt-1' }),
    );
    expect(recos.map((r) => r.lesson.id)).toEqual(['l2']);
  });

  it('respeta minMatchScore', () => {
    const recos = recommendLessons(
      [
        lesson({ id: 'low', applicableIndustries: ['mining'] }), // sólo size +20
        lesson({ id: 'hi' }),
      ],
      target(),
      { minMatchScore: 40 },
    );
    expect(recos.map((r) => r.lesson.id)).toEqual(['hi']);
  });

  it('respeta maxResults', () => {
    const lessons: LessonRecord[] = [];
    for (let i = 0; i < 8; i++) lessons.push(lesson({ id: `l${i}` }));
    const recos = recommendLessons(lessons, target(), { maxResults: 3 });
    expect(recos).toHaveLength(3);
  });

  it('ordena por matchScore DESC', () => {
    const recos = recommendLessons(
      [
        lesson({ id: 'mid' }), // 60
        lesson({
          id: 'top',
          applicableProjectKinds: ['edificio'],
        }), // 70
        lesson({ id: 'low', applicableIndustries: ['mining'] }), // 20
      ],
      target({ projectKind: 'edificio' }),
    );
    expect(recos.map((r) => r.lesson.id)).toEqual(['top', 'mid', 'low']);
  });

  it('en empate de score, severity más alta gana', () => {
    const recos = recommendLessons(
      [
        lesson({ id: 'a', originalSeverity: 'low' }),
        lesson({ id: 'b', originalSeverity: 'medium' }),
      ],
      target(),
    );
    // ambos: 40+20 = 60 + sevBonus(0). Empate, severity rank b > a.
    expect(recos[0].lesson.id).toBe('b');
  });

  it('filtra lecciones sin ninguna razón de aplicabilidad', () => {
    const recos = recommendLessons(
      [
        lesson({
          id: 'nada',
          applicableIndustries: ['mining'],
          applicableSizes: ['enterprise'],
        }),
      ],
      target({ industry: 'construction', size: 'small' }),
    );
    expect(recos).toHaveLength(0);
  });

  it('recommendedActions varían según category', () => {
    const inc = recommendLessons([lesson({ id: 'l1', category: 'incident' })], target());
    const eff = recommendLessons(
      [lesson({ id: 'l2', category: 'efficiency' })],
      target(),
    );
    expect(inc[0].recommendedActions.join(' ')).toMatch(/control crítico|Bowtie/);
    expect(eff[0].recommendedActions.join(' ')).toMatch(/optimización|ahorro/);
  });

  it('agrega acción extra cuando severity histórica es alta', () => {
    const recos = recommendLessons(
      [lesson({ id: 'l1', originalSeverity: 'sif' })],
      target(),
    );
    expect(recos[0].recommendedActions.some((a) => a.includes('líder SSO'))).toBe(true);
  });
});

describe('summarizePortfolioLearning', () => {
  it('cuenta totales, categorías e industrias', () => {
    const corpus: LessonRecord[] = [
      lesson({ id: 'a', category: 'incident', applicableIndustries: ['construction'] }),
      lesson({ id: 'b', category: 'incident', applicableIndustries: ['mining'] }),
      lesson({ id: 'c', category: 'good_practice', applicableIndustries: ['construction', 'mining'] }),
      lesson({ id: 'd', category: 'culture', applicableIndustries: [] }),
    ];
    const sum = summarizePortfolioLearning(corpus);
    expect(sum.totalLessons).toBe(4);
    expect(sum.byCategory.incident).toBe(2);
    expect(sum.byCategory.good_practice).toBe(1);
    expect(sum.byCategory.culture).toBe(1);
    expect(sum.byIndustry.construction).toBe(2);
    expect(sum.byIndustry.mining).toBe(2);
  });

  it('transferableCount excluye lecciones sin industries ni sizes', () => {
    const corpus: LessonRecord[] = [
      lesson({ id: 'ok', applicableIndustries: ['construction'], applicableSizes: ['medium'] }),
      lesson({ id: 'sizeOnly', applicableIndustries: [], applicableSizes: ['large'] }),
      lesson({ id: 'none', applicableIndustries: [], applicableSizes: [] }),
    ];
    const sum = summarizePortfolioLearning(corpus);
    expect(sum.totalLessons).toBe(3);
    expect(sum.transferableCount).toBe(2);
  });

  it('biblioteca vacía → ceros', () => {
    const sum = summarizePortfolioLearning([]);
    expect(sum.totalLessons).toBe(0);
    expect(sum.transferableCount).toBe(0);
    expect(Object.keys(sum.byCategory)).toHaveLength(0);
    expect(Object.keys(sum.byIndustry)).toHaveLength(0);
  });
});
