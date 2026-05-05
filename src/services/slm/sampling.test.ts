/**
 * Tests for the SLM sampling primitives (Brecha B — Sprint 23 Bucket DD).
 *
 * Pure-math tests: no ONNX, no fetch, no IndexedDB. Every case feeds a
 * hand-built `Float32Array` of logits and asserts the deterministic
 * pieces (greedy argmax, top-K masking, top-P cumulative cutoff,
 * repetition penalty sign-flip, seedable RNG reproducibility).
 *
 * Coverage map (matches Bucket DD.4):
 *   1. sampleGreedy returns the argmax (positive logits).
 *   2. sampleGreedy handles negative logits.
 *   3. sampleNucleus is deterministic with temperature=0 (= greedy).
 *   4. sampleNucleus is reproducible with a seeded RNG.
 *   5. applyRepetitionPenalty divides positive logits.
 *   6. applyRepetitionPenalty multiplies negative logits (sign flip).
 *   7. Top-K filters everything past the K-th highest logit.
 *   8. Top-P filters once cumulative probability mass crosses the
 *      threshold.
 *   9. sampleNucleus on uniform logits respects the seeded RNG draw.
 *  10. applyRepetitionPenalty is a no-op when penalty <= 1.
 */

import { describe, expect, it } from 'vitest';

import {
  applyRepetitionPenalty,
  makeMulberry32,
  sampleGreedy,
  sampleNucleus,
  type SamplingConfig,
} from './sampling';

describe('sampleGreedy', () => {
  it('returns the index of the largest positive logit', () => {
    const logits = new Float32Array([0.1, 5.0, 2.3, -1.0]);
    expect(sampleGreedy(logits)).toBe(1);
  });

  it('handles all-negative logits (still picks the max)', () => {
    const logits = new Float32Array([-10, -3, -7, -100]);
    expect(sampleGreedy(logits)).toBe(1);
  });

  it('throws on an empty array', () => {
    expect(() => sampleGreedy(new Float32Array(0))).toThrow();
  });
});

describe('sampleNucleus', () => {
  it('is deterministic with temperature=0 (collapses to greedy)', () => {
    const logits = new Float32Array([1.0, 4.2, 3.7, 0.5]);
    const config: SamplingConfig = { maxTokens: 1, temperature: 0 };
    // Run multiple times — should always return the argmax (idx=1).
    for (let i = 0; i < 10; i++) {
      expect(sampleNucleus(logits, config)).toBe(1);
    }
  });

  it('is reproducible with a seeded RNG', () => {
    const logits = new Float32Array([1.0, 1.0, 1.0, 1.0, 1.0]);
    const seed = 42;
    const a = sampleNucleus(logits, {
      maxTokens: 1,
      temperature: 1.0,
      topP: 1.0,
      topK: 0,
      rng: makeMulberry32(seed),
    });
    const b = sampleNucleus(logits, {
      maxTokens: 1,
      temperature: 1.0,
      topP: 1.0,
      topK: 0,
      rng: makeMulberry32(seed),
    });
    expect(a).toBe(b);
  });

  it('top-K=1 collapses to greedy regardless of temperature', () => {
    const logits = new Float32Array([0.1, 5.0, 2.3, -1.0]);
    const config: SamplingConfig = {
      maxTokens: 1,
      temperature: 1.0,
      topK: 1,
      rng: makeMulberry32(7),
    };
    expect(sampleNucleus(logits, config)).toBe(1);
  });

  it('top-P with very low cutoff keeps only the top token', () => {
    // Construct a distribution where token 2 dominates by a huge margin.
    const logits = new Float32Array([0.0, 0.0, 100.0, 0.0]);
    const config: SamplingConfig = {
      maxTokens: 1,
      temperature: 1.0,
      topP: 0.01,
      rng: makeMulberry32(123),
    };
    // After softmax, token 2 holds ~all the mass; top-P=0.01 cuts after
    // the first token. So we always pick 2.
    for (let i = 0; i < 5; i++) {
      expect(sampleNucleus(logits, config)).toBe(2);
    }
  });

  it('throws when every logit is -Infinity', () => {
    const logits = new Float32Array([-Infinity, -Infinity, -Infinity]);
    expect(() => sampleNucleus(logits, { maxTokens: 1, temperature: 1 })).toThrow();
  });

  it('different RNG seeds produce different draws on uniform logits', () => {
    // 64-token uniform distribution — large enough that two different
    // seeds almost surely hit different bucket indices.
    const logits = new Float32Array(64).fill(0);
    const draws = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      draws.add(
        sampleNucleus(logits, {
          maxTokens: 1,
          temperature: 1.0,
          topP: 1.0,
          rng: makeMulberry32(seed),
        }),
      );
    }
    // 8 seeds → expect at least 2 distinct outcomes (extremely high p).
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe('applyRepetitionPenalty', () => {
  it('divides positive logits by the penalty factor', () => {
    const logits = new Float32Array([1.0, 4.0, 2.0, -3.0]);
    applyRepetitionPenalty(logits, [1, 2], 2.0);
    expect(logits[1]).toBeCloseTo(2.0, 5); // 4 / 2
    expect(logits[2]).toBeCloseTo(1.0, 5); // 2 / 2
    // Untouched indices unchanged.
    expect(logits[0]).toBeCloseTo(1.0, 5);
    expect(logits[3]).toBeCloseTo(-3.0, 5);
  });

  it('multiplies negative logits by the penalty (sign-flip rule)', () => {
    const logits = new Float32Array([-2.0, -5.0, 3.0]);
    applyRepetitionPenalty(logits, [0, 1], 2.0);
    expect(logits[0]).toBeCloseTo(-4.0, 5); // -2 * 2
    expect(logits[1]).toBeCloseTo(-10.0, 5); // -5 * 2
    expect(logits[2]).toBeCloseTo(3.0, 5);
  });

  it('is a no-op when penalty <= 1', () => {
    const logits = new Float32Array([1.0, 2.0, 3.0]);
    applyRepetitionPenalty(logits, [0, 1, 2], 1.0);
    expect(Array.from(logits)).toEqual([1, 2, 3]);

    applyRepetitionPenalty(logits, [0, 1, 2], 0.5);
    expect(Array.from(logits)).toEqual([1, 2, 3]);
  });

  it('is a no-op when recentTokenIds is empty', () => {
    const logits = new Float32Array([1.0, 2.0, 3.0]);
    applyRepetitionPenalty(logits, [], 5.0);
    expect(Array.from(logits)).toEqual([1, 2, 3]);
  });

  it('dedupes repeated token IDs (each penalized once)', () => {
    const logits = new Float32Array([4.0, 4.0]);
    applyRepetitionPenalty(logits, [0, 0, 0, 0], 2.0);
    // Without dedup: 4 / 2 / 2 / 2 / 2 = 0.25. With dedup: 4 / 2 = 2.
    expect(logits[0]).toBeCloseTo(2.0, 5);
    expect(logits[1]).toBeCloseTo(4.0, 5);
  });

  it('ignores out-of-range token IDs without throwing', () => {
    const logits = new Float32Array([1.0, 2.0]);
    expect(() =>
      applyRepetitionPenalty(logits, [-1, 99, 0], 2.0),
    ).not.toThrow();
    // Only id 0 was valid → it got divided by 2.
    expect(logits[0]).toBeCloseTo(0.5, 5);
    expect(logits[1]).toBeCloseTo(2.0, 5);
  });
});

describe('integration: penalty + nucleus', () => {
  it('repetition penalty shifts the argmax away from a recent token', () => {
    // Token 1 leads by 0.5; after a heavy penalty it should fall behind.
    const logits = new Float32Array([1.0, 1.5, 1.2]);
    applyRepetitionPenalty(logits, [1], 4.0);
    // 1.5 / 4 = 0.375 → token 2 (1.2) now dominates.
    expect(sampleNucleus(logits, { maxTokens: 1, temperature: 0 })).toBe(2);
  });
});

describe('makeMulberry32', () => {
  it('produces values in [0, 1)', () => {
    const rng = makeMulberry32(99);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed yields identical sequences', () => {
    const a = makeMulberry32(2026);
    const b = makeMulberry32(2026);
    for (let i = 0; i < 20; i++) {
      expect(a()).toBe(b());
    }
  });
});
