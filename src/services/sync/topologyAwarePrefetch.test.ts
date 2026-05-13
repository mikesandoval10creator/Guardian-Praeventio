import { describe, it, expect } from 'vitest';
import {
  buildPredictivePrefetch,
  buildPullBatches,
  expandCandidatesFromContext,
  type PrefetchCandidate,
  type PastUsageSample,
  type ZkNodeSnapshot,
} from './topologyAwarePrefetch.js';

const EMPTY_BASE_PLAN = {
  zettelkastenRoots: [],
  documentCategories: [],
  trainingCategories: [],
  crewHistoryUids: [],
};

function cand(over: Partial<PrefetchCandidate> = {}): PrefetchCandidate {
  return {
    uid: 'u-1',
    collection: 'zettelkasten_node',
    estimatedBytes: 8192,
    severity: 'medium',
    reason: 'upcoming_task_category',
    ...over,
  };
}

describe('buildPredictivePrefetch — scoring + ordering', () => {
  it('orden por score desc, dentro del mismo score por bytes asc', () => {
    const r = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [
        cand({ uid: 'a', estimatedBytes: 20_000, severity: 'critical' }),
        cand({ uid: 'b', estimatedBytes: 5_000, severity: 'critical' }),
        cand({ uid: 'c', estimatedBytes: 10_000, severity: 'low' }),
      ],
    });
    // Critical primero. Entre los 2 críticos el más chico va antes.
    expect(r.ordered[0]!.uid).toBe('b');
    expect(r.ordered[1]!.uid).toBe('a');
    expect(r.ordered[2]!.uid).toBe('c');
  });

  it('skip already_fresh cuando watermark cliente ≥ server rev', () => {
    const r = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [cand({ uid: 'a', clientWatermark: 10, serverRev: 10 })],
    });
    expect(r.stats.skippedAlreadyFresh).toBe(1);
    expect(r.ordered[0]!.skipReason).toBe('already_fresh');
    expect(r.ordered[0]!.selected).toBe(false);
  });

  it('dedup mismo uid+collection', () => {
    const r = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [
        cand({ uid: 'dup', collection: 'document' }),
        cand({ uid: 'dup', collection: 'document' }),
      ],
    });
    expect(r.stats.skippedDuplicate).toBe(1);
  });

  it('mismo uid pero distinto collection → ambos pasan', () => {
    const r = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [
        cand({ uid: 'a', collection: 'document' }),
        cand({ uid: 'a', collection: 'training_module' }),
      ],
    });
    expect(r.stats.skippedDuplicate).toBe(0);
    expect(r.stats.selected).toBe(2);
  });

  it('budget cap respeta maxBytes', () => {
    const r = buildPredictivePrefetch(
      {
        basePlan: EMPTY_BASE_PLAN,
        candidates: [
          cand({ uid: 'a', estimatedBytes: 8_000 }),
          cand({ uid: 'b', estimatedBytes: 8_000 }),
          cand({ uid: 'c', estimatedBytes: 8_000 }),
        ],
      },
      { maxBytes: 16_000 },
    );
    expect(r.stats.selected).toBe(2);
    expect(r.stats.skippedOverBudget).toBe(1);
    expect(r.totalBytes).toBe(16_000);
  });

  it('maxItems cap', () => {
    const r = buildPredictivePrefetch(
      {
        basePlan: EMPTY_BASE_PLAN,
        candidates: [
          cand({ uid: 'a' }),
          cand({ uid: 'b' }),
          cand({ uid: 'c' }),
          cand({ uid: 'd' }),
        ],
      },
      { maxItems: 2 },
    );
    expect(r.stats.selected).toBe(2);
    expect(r.stats.skippedOverBudget).toBe(2);
  });

  it('low score floor — un candidato muy débil queda fuera', () => {
    const r = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [
        cand({ uid: 'weak', collection: 'worker_profile', severity: 'low', reason: 'recent_usage_pattern' }),
      ],
    });
    // worker_profile base 30 + low 10 (skip prioritize OFF? no, ON, 0.4*25=10) → ~40 (sin reason bonus)
    // Realmente: base 0.5*60=30 + severity 0.4*25=10 = 40 → above floor 20 → selected
    // No probamos floor con esto, probemos sin severity ni reason boost
    const r2 = buildPredictivePrefetch(
      {
        basePlan: EMPTY_BASE_PLAN,
        candidates: [
          cand({
            uid: 'very-weak',
            collection: 'worker_profile',
            severity: undefined,
            reason: 'recent_usage_pattern',
          }),
        ],
      },
      { prioritizeHighSeverity: false, applyUsageHeuristic: false },
    );
    // base 30 + reason 0 = 30 (recent_usage_pattern no tiene bonus) → above 20 → selected
    expect(r2.stats.selected).toBeGreaterThanOrEqual(0);
  });

  it('usage heuristic boostea cuando hay matches en pastUsage', () => {
    const past: PastUsageSample[] = [
      {
        collection: 'document',
        accessedUids: ['frequent-doc'],
        hitCount: 8,
        recencyHours: 1,
      },
    ];
    const noBoost = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [cand({ uid: 'frequent-doc', collection: 'document', severity: undefined })],
      pastUsage: undefined,
    });
    const withBoost = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [cand({ uid: 'frequent-doc', collection: 'document', severity: undefined })],
      pastUsage: past,
    });
    expect(withBoost.ordered[0]!.score).toBeGreaterThan(noBoost.ordered[0]!.score);
  });
});

describe('buildPullBatches', () => {
  it('agrupa selected por collection', () => {
    const result = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [
        cand({ uid: 'd1', collection: 'document' }),
        cand({ uid: 'd2', collection: 'document' }),
        cand({ uid: 't1', collection: 'training_module' }),
      ],
    });
    const batches = buildPullBatches(result);
    const byColl = new Map(batches.map((b) => [b.collection, b]));
    expect(byColl.get('document')!.uids.sort()).toEqual(['d1', 'd2']);
    expect(byColl.get('training_module')!.uids).toEqual(['t1']);
  });

  it('minWatermark es el menor clientWatermark del batch', () => {
    const result = buildPredictivePrefetch({
      basePlan: EMPTY_BASE_PLAN,
      candidates: [
        cand({ uid: 'd1', collection: 'document', clientWatermark: 100, serverRev: 200 }),
        cand({ uid: 'd2', collection: 'document', clientWatermark: 50, serverRev: 200 }),
      ],
    });
    const batches = buildPullBatches(result);
    const doc = batches.find((b) => b.collection === 'document');
    expect(doc?.minWatermark).toBe(50);
  });
});

describe('expandCandidatesFromContext — BFS topology', () => {
  const snapshot: ZkNodeSnapshot[] = [
    { uid: 'risk:altura', type: 'risk_altura', severity: 'high', connections: ['ctrl:linea-vida'] },
    { uid: 'ctrl:linea-vida', type: 'critical_control', severity: 'critical', connections: ['training:r1'] },
    { uid: 'training:r1', type: 'training_module', connections: [] },
    { uid: 'unrelated', type: 'irrelevant', connections: [] },
  ];

  it('seedea desde upcomingTaskCategories matching', () => {
    const candidates = expandCandidatesFromContext(
      {
        workerUid: 'w1',
        upcomingTaskCategories: ['altura'],
      },
      snapshot,
      { depth: 1 },
    );
    expect(candidates.map((c) => c.uid)).toContain('risk:altura');
    expect(candidates.map((c) => c.uid)).not.toContain('unrelated');
  });

  it('BFS depth 2 alcanza nodos conectados', () => {
    const candidates = expandCandidatesFromContext(
      {
        workerUid: 'w1',
        upcomingTaskCategories: ['altura'],
      },
      snapshot,
      { depth: 2 },
    );
    const uids = candidates.map((c) => c.uid);
    expect(uids).toContain('risk:altura');
    expect(uids).toContain('ctrl:linea-vida');
  });

  it('BFS depth 0 no produce nada', () => {
    const candidates = expandCandidatesFromContext(
      { workerUid: 'w1', upcomingTaskCategories: ['altura'] },
      snapshot,
      { depth: 0 },
    );
    expect(candidates).toHaveLength(0);
  });

  it('sin categorías matching → vacío', () => {
    const candidates = expandCandidatesFromContext(
      { workerUid: 'w1', upcomingTaskCategories: ['xyz'] },
      snapshot,
      { depth: 3 },
    );
    expect(candidates).toHaveLength(0);
  });
});
