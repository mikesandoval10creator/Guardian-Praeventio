import { describe, it, expect } from 'vitest';
import {
  eulerCharacteristic,
  isValidConvexPolyhedron,
  progressFromQuiz,
  suggestedPolyhedron,
  PLATONIC_SOLIDS,
  type PolyhedronShape,
} from './polyhedronAchievements';

describe('eulerCharacteristic — V-E+F (Euler 1758)', () => {
  it('tetrahedron satisfies χ = 2', () => {
    expect(eulerCharacteristic({ V: 4, E: 6, F: 4 })).toBe(2);
  });

  it('all 5 platonic solids satisfy χ = 2', () => {
    const shapes: PolyhedronShape[] = [
      'tetrahedron',
      'cube',
      'octahedron',
      'dodecahedron',
      'icosahedron',
    ];
    for (const s of shapes) {
      const spec = PLATONIC_SOLIDS[s];
      expect(eulerCharacteristic(spec)).toBe(2);
    }
  });

  it('non-convex / wonky spec V=5, E=9, F=5 has χ = 1 (NOT a valid polyhedron)', () => {
    // 5 - 9 + 5 = 1. Like a pyramid with an extra wonky vertex.
    expect(eulerCharacteristic({ V: 5, E: 9, F: 5 })).toBe(1);
  });

  it('torus-like surface V=8, E=16, F=8 has χ = 0 (genus 1, not convex)', () => {
    expect(eulerCharacteristic({ V: 8, E: 16, F: 8 })).toBe(0);
  });
});

describe('isValidConvexPolyhedron — invariant gate', () => {
  it('cube V=8, E=12, F=6 is valid', () => {
    expect(isValidConvexPolyhedron({ V: 8, E: 12, F: 6 })).toBe(true);
  });

  it('icosahedron V=12, E=30, F=20 is valid', () => {
    expect(isValidConvexPolyhedron({ V: 12, E: 30, F: 20 })).toBe(true);
  });

  it('degenerate {V:0, E:0, F:0} is not a valid polyhedron', () => {
    expect(isValidConvexPolyhedron({ V: 0, E: 0, F: 0 })).toBe(false);
  });

  it('"sphere-point" {V:1, E:0, F:1} has χ=2 but is not a real polyhedron — rejected by V>=4 floor', () => {
    // Documents the edge case: V-E+F = 1-0+1 = 2 satisfies χ=2 but is
    // not a convex polyhedron. The minimum convex polyhedron is the
    // tetrahedron (V=4).
    expect(eulerCharacteristic({ V: 1, E: 0, F: 1 })).toBe(2);
    expect(isValidConvexPolyhedron({ V: 1, E: 0, F: 1 })).toBe(false);
  });

  it('non-convex spec V=5, E=9, F=5 (χ=1) is invalid', () => {
    expect(isValidConvexPolyhedron({ V: 5, E: 9, F: 5 })).toBe(false);
  });
});

describe('PLATONIC_SOLIDS table integrity', () => {
  it('every entry satisfies V-E+F = 2', () => {
    for (const key of Object.keys(PLATONIC_SOLIDS) as PolyhedronShape[]) {
      const spec = PLATONIC_SOLIDS[key];
      expect(spec.V - spec.E + spec.F).toBe(2);
    }
  });

  it('table is readonly at the TS level (as const)', () => {
    // This block is mostly a type-level assertion — at runtime we just
    // verify the values match the canonical (V, E, F) for each shape.
    expect(PLATONIC_SOLIDS.tetrahedron).toEqual({
      shape: 'tetrahedron',
      V: 4,
      E: 6,
      F: 4,
    });
    expect(PLATONIC_SOLIDS.cube).toEqual({ shape: 'cube', V: 8, E: 12, F: 6 });
    expect(PLATONIC_SOLIDS.octahedron).toEqual({
      shape: 'octahedron',
      V: 6,
      E: 12,
      F: 8,
    });
    expect(PLATONIC_SOLIDS.dodecahedron).toEqual({
      shape: 'dodecahedron',
      V: 20,
      E: 30,
      F: 12,
    });
    expect(PLATONIC_SOLIDS.icosahedron).toEqual({
      shape: 'icosahedron',
      V: 12,
      E: 30,
      F: 20,
    });
  });
});

describe('progressFromQuiz — quiz → polyhedron mapping', () => {
  it('full quiz on cube → 100 %, isComplete, χ_partial = 2', () => {
    const progress = progressFromQuiz(
      { correctAnswers: 8, topicalConnections: 12, modulesCompleted: 6 },
      'cube',
    );
    expect(progress.unlockedV).toBe(8);
    expect(progress.unlockedE).toBe(12);
    expect(progress.unlockedF).toBe(6);
    expect(progress.completionPercent).toBe(100);
    expect(progress.isComplete).toBe(true);
    expect(progress.chiPartial).toBe(2);
  });

  it('half quiz on cube → ~50 %', () => {
    const progress = progressFromQuiz(
      { correctAnswers: 4, topicalConnections: 6, modulesCompleted: 3 },
      'cube',
    );
    // (4 + 6 + 3) / (8 + 12 + 6) = 13/26 = 50 %
    expect(progress.completionPercent).toBeCloseTo(50, 1);
    expect(progress.isComplete).toBe(false);
  });

  it('overflow caps at V/E/F (no over-unlock allowed)', () => {
    const progress = progressFromQuiz(
      { correctAnswers: 999, topicalConnections: 999, modulesCompleted: 999 },
      'tetrahedron',
    );
    expect(progress.unlockedV).toBe(4); // tetra V
    expect(progress.unlockedE).toBe(6); // tetra E
    expect(progress.unlockedF).toBe(4); // tetra F
    expect(progress.isComplete).toBe(true);
    expect(progress.completionPercent).toBe(100);
  });

  it('zero quiz → 0 %, χ_partial = 0', () => {
    const progress = progressFromQuiz(
      { correctAnswers: 0, topicalConnections: 0, modulesCompleted: 0 },
      'icosahedron',
    );
    expect(progress.completionPercent).toBe(0);
    expect(progress.chiPartial).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it('negative inputs are clamped to 0 (defensive)', () => {
    const progress = progressFromQuiz(
      { correctAnswers: -5, topicalConnections: -10, modulesCompleted: -2 },
      'octahedron',
    );
    expect(progress.unlockedV).toBe(0);
    expect(progress.unlockedE).toBe(0);
    expect(progress.unlockedF).toBe(0);
    expect(progress.completionPercent).toBe(0);
    expect(progress.isComplete).toBe(false);
  });

  it('completed dodecahedron has χ_partial = 2 (V-E+F invariant for full unlock)', () => {
    const progress = progressFromQuiz(
      { correctAnswers: 20, topicalConnections: 30, modulesCompleted: 12 },
      'dodecahedron',
    );
    expect(progress.chiPartial).toBe(2);
    expect(progress.isComplete).toBe(true);
  });
});

describe('suggestedPolyhedron — level-based progression', () => {
  it("beginner → tetrahedron (V=4, the 'gateway' polyhedron)", () => {
    expect(suggestedPolyhedron('beginner')).toBe('tetrahedron');
  });

  it('intermediate → cube', () => {
    expect(suggestedPolyhedron('intermediate')).toBe('cube');
  });

  it('advanced → icosahedron (most demanding in edges/connections)', () => {
    const result = suggestedPolyhedron('advanced');
    expect(['dodecahedron', 'icosahedron']).toContain(result);
  });
});
