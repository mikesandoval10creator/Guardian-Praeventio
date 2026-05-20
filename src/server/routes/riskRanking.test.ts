// Praeventio Guard — Plan 3.12: contract tests for the risk-ranking router.
//
// Two layers of coverage:
//
//   (a) Router structural contract — verifies all 4 endpoints are registered
//       with the right HTTP verb. Mirrors the convention used by
//       riskRadar.test.ts / correctiveActions.test.ts so the suite is
//       consistent across the wired-orphan series.
//
//   (b) Cache behavior — the in-memory per-process cache is the single
//       piece of stateful logic that lives in the route file itself. We
//       exercise its TTL + project-scoped eviction directly via the
//       `__test` export so the engine can stay deterministic.

import { describe, it, expect, beforeEach } from 'vitest';
import riskRankingRouter, { __test } from './riskRanking';

interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

function layers(): RouterLayer[] {
  return (riskRankingRouter as unknown as { stack: RouterLayer[] }).stack;
}

describe('riskRankingRouter (Plan 3.12 wire orphan contract)', () => {
  it('exports a Router instance', () => {
    expect(riskRankingRouter).toBeDefined();
    expect(typeof riskRankingRouter).toBe('function');
  });

  it('registers GET /:projectId/top', () => {
    const layer = layers().find(
      (l) => l.route?.path === '/:projectId/top' && l.route.methods.get,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/weak-controls', () => {
    const layer = layers().find(
      (l) => l.route?.path === '/:projectId/weak-controls' && l.route.methods.get,
    );
    expect(layer).toBeDefined();
  });

  it('registers GET /:projectId/timeseries', () => {
    const layer = layers().find(
      (l) => l.route?.path === '/:projectId/timeseries' && l.route.methods.get,
    );
    expect(layer).toBeDefined();
  });

  it('registers POST /:projectId/recompute', () => {
    const layer = layers().find(
      (l) => l.route?.path === '/:projectId/recompute' && l.route.methods.post,
    );
    expect(layer).toBeDefined();
  });

  it('exposes exactly 4 routed paths (no accidental endpoints)', () => {
    const paths = layers()
      .map((l) => l.route?.path)
      .filter((p): p is string => typeof p === 'string');
    expect(paths).toHaveLength(4);
    expect(new Set(paths)).toEqual(
      new Set([
        '/:projectId/top',
        '/:projectId/weak-controls',
        '/:projectId/timeseries',
        '/:projectId/recompute',
      ]),
    );
  });
});

describe('riskRanking cache (TTL + project-scoped eviction)', () => {
  beforeEach(() => {
    // Drop any leftover state from prior suites. The cache is per-process
    // so test isolation matters.
    __test.cacheDropProject('proj-a');
    __test.cacheDropProject('proj-b');
  });

  it('cacheGet returns the stored value on a hit', () => {
    __test.cacheSet('proj-a:top:10', { topRisks: [] });
    expect(__test.cacheGet<{ topRisks: unknown[] }>('proj-a:top:10')).toEqual({
      topRisks: [],
    });
  });

  it('cacheGet returns null on a miss', () => {
    expect(__test.cacheGet('proj-a:nothing')).toBeNull();
  });

  it('cacheDropProject evicts only the targeted project keys', () => {
    __test.cacheSet('proj-a:top:10', { kind: 'a-top' });
    __test.cacheSet('proj-a:weak:10', { kind: 'a-weak' });
    __test.cacheSet('proj-b:top:10', { kind: 'b-top' });

    const dropped = __test.cacheDropProject('proj-a');
    expect(dropped).toBe(2);
    expect(__test.cacheGet('proj-a:top:10')).toBeNull();
    expect(__test.cacheGet('proj-a:weak:10')).toBeNull();
    expect(__test.cacheGet('proj-b:top:10')).toEqual({ kind: 'b-top' });

    // Cleanup the b-key so we don't leak into other tests.
    __test.cacheDropProject('proj-b');
  });

  it('TTL constant is finite + positive (sanity guard against accidental Infinity)', () => {
    expect(Number.isFinite(__test.TTL_MS)).toBe(true);
    expect(__test.TTL_MS).toBeGreaterThan(0);
  });
});
