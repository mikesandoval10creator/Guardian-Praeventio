import { describe, it, expect } from 'vitest';
import { rankRiskNodesByIper, type RiskNodeInput } from './riskNodeRanking';

function node(over: Partial<RiskNodeInput> = {}): RiskNodeInput {
  return {
    id: over.id ?? 'n1',
    title: over.title ?? 'Riesgo X',
    category: over.category,
    probabilidad: over.probabilidad ?? 3,
    severidad: over.severidad ?? 3,
  };
}

describe('rankRiskNodesByIper', () => {
  it('ranks by descending IPER score (P×S)', () => {
    const ranked = rankRiskNodesByIper([
      node({ id: 'low', probabilidad: 1, severidad: 1 }), // 1
      node({ id: 'high', probabilidad: 5, severidad: 5 }), // 25
      node({ id: 'mid', probabilidad: 3, severidad: 3 }), // 9
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['high', 'mid', 'low']);
    expect(ranked[0]!.iperScore).toBe(25);
  });

  it('classifies via the canonical DS44 engine (level + criticidad)', () => {
    const [r] = rankRiskNodesByIper([node({ probabilidad: 5, severidad: 5 })]);
    expect(r!.iperLevel).toBe('intolerable');
    expect(r!.criticidad).toBe('Crítica');
    // P=3×S=3 → DS44 'moderado' → Media (NOT the old ad-hoc 'Alta').
    const [m] = rankRiskNodesByIper([node({ probabilidad: 3, severidad: 3 })]);
    expect(m!.iperLevel).toBe('moderado');
    expect(m!.criticidad).toBe('Media');
  });

  it('respects topN and defaults to 10', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      node({ id: `n${i}`, probabilidad: ((i % 5) + 1) as number }),
    );
    expect(rankRiskNodesByIper(many)).toHaveLength(10);
    expect(rankRiskNodesByIper(many, 3)).toHaveLength(3);
    expect(rankRiskNodesByIper(many, 0)).toHaveLength(15); // 0 → all
  });

  it('ties keep input order (stable)', () => {
    const ranked = rankRiskNodesByIper([
      node({ id: 'a', probabilidad: 2, severidad: 2 }), // 4
      node({ id: 'b', probabilidad: 4, severidad: 1 }), // 4
      node({ id: 'c', probabilidad: 1, severidad: 4 }), // 4
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('is defensive: missing / out-of-range metadata is clamped, never throws', () => {
    expect(() =>
      rankRiskNodesByIper([
        { id: 'x', title: 'sin metadata' }, // no P/S → clamp to 1
        node({ id: 'over', probabilidad: 99, severidad: 7 }), // → 5,5
        node({ id: 'under', probabilidad: 0, severidad: -3 }), // → 1,1
      ]),
    ).not.toThrow();
    const ranked = rankRiskNodesByIper([
      node({ id: 'over', probabilidad: 99, severidad: 7 }),
    ]);
    expect(ranked[0]!.probabilidad).toBe(5);
    expect(ranked[0]!.severidad).toBe(5);
    expect(ranked[0]!.iperScore).toBe(25);
  });

  it('falls back to a category label when missing/blank', () => {
    const [r] = rankRiskNodesByIper([node({ category: '   ' })]);
    expect(r!.category).toBe('sin categoría');
    const [r2] = rankRiskNodesByIper([node({ category: 'altura' })]);
    expect(r2!.category).toBe('altura');
  });
});
