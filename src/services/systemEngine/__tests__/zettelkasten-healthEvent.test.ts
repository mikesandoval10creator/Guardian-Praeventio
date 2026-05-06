import { describe, expect, it } from 'vitest';

import { computeHealthScore } from '../zettelkasten/healthEvent';
import type { RiskGraph } from '../../euler/graphConnectivity';

const triangle: RiskGraph = {
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'c' }],
};

const twoIslands: RiskGraph = {
  nodes: [
    { id: 'a', label: 'A' }, { id: 'b', label: 'B' },
    { id: 'c', label: 'C' }, { id: 'd', label: 'D' },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'c', to: 'd' },
  ],
};

describe('computeHealthScore', () => {
  it('returns neutral 50 for trivial graphs', () => {
    expect(computeHealthScore({ graph: { nodes: [], edges: [] } }).score).toBe(50);
    expect(computeHealthScore({ graph: { nodes: [{ id: 'x', label: 'X' }], edges: [] } }).score).toBe(50);
  });

  it('rewards an eulerian-circuit-friendly triangle', () => {
    const r = computeHealthScore({ graph: triangle });
    expect(r.hasEulerianCycle).toBe(true);
    // Triangle has density=1 (over saturated), so penalty applies; net should
    // still be > 60 because the eulerian-cycle bonus stacks on top.
    expect(r.score).toBeGreaterThanOrEqual(60);
  });

  it('penalises disconnected components vs an equivalent connected graph', () => {
    // 10-node ring (every node has degree 2; density 0.222 — just over the
    // 0.20 sweet-spot ceiling; no hubs because 2/9 < 0.4) vs. 10-node graph
    // split into two 5-node rings (2 components, otherwise identical
    // density-and-hub profile). The disconnected version must score lower.
    const ring = (ids: string[]): RiskGraph => ({
      nodes: ids.map((id) => ({ id, label: id })),
      edges: ids.map((from, i) => ({ from, to: ids[(i + 1) % ids.length] })),
    });
    const oneRing = ring(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const twoRings: RiskGraph = {
      nodes: oneRing.nodes,
      edges: [...ring(['a', 'b', 'c', 'd', 'e']).edges, ...ring(['f', 'g', 'h', 'i', 'j']).edges],
    };
    const oneRingScore = computeHealthScore({ graph: oneRing }).score;
    const twoRingsScore = computeHealthScore({ graph: twoRings }).score;
    expect(twoRingsScore).toBeLessThan(oneRingScore);
  });

  it('detects multiple components and reports them', () => {
    const r = computeHealthScore({ graph: twoIslands });
    expect(r.components).toBe(2);
  });

  it('clamps the score into [0, 100]', () => {
    // Pathological: 100 nodes, no edges → density 0, components 100.
    const tooManyIslands: RiskGraph = {
      nodes: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: `N${i}` })),
      edges: [],
    };
    const r = computeHealthScore({ graph: tooManyIslands });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
