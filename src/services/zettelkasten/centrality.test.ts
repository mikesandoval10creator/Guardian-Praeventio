// Praeventio Guard — §ZK-6 centrality metrics tests.
//
// Pure-function coverage for the graph-level degree centrality + archive
// candidacy that builds on §ZK-1 backlinks. No emulator / Firestore.

import { describe, it, expect } from 'vitest';
import {
  computeDegreeCentrality,
  rankHubs,
  findArchiveCandidates,
} from './centrality';
import { EDGE_TYPES, EDGE_INVERSES, type ZkEdge } from './edges';

/** Minimal valid ZkEdge — centrality only reads from/to, but we build the
 *  full shape so the fixtures stay honest against the real interface. */
function edge(from: string, to: string): ZkEdge {
  const type = EDGE_TYPES[0];
  return {
    id: `${from}|${to}|${type}`,
    fromNodeId: from,
    toNodeId: to,
    type,
    inverseType: EDGE_INVERSES[type],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'test',
    tenantId: 't1',
  };
}

describe('§ZK-6 computeDegreeCentrality', () => {
  it('returns an empty array when there are no edges', () => {
    expect(computeDegreeCentrality([])).toEqual([]);
  });

  it('counts in/out degree and distinct neighbours', () => {
    // A→B, A→C, B→A
    const c = computeDegreeCentrality([edge('A', 'B'), edge('A', 'C'), edge('B', 'A')]);
    const byId = Object.fromEntries(c.map((x) => [x.nodeId, x]));
    expect(byId.A).toMatchObject({ inDegree: 1, outDegree: 2, degree: 3, distinctNeighbors: 2 });
    expect(byId.B).toMatchObject({ inDegree: 1, outDegree: 1, degree: 2, distinctNeighbors: 1 });
    expect(byId.C).toMatchObject({ inDegree: 1, outDegree: 0, degree: 1, distinctNeighbors: 1 });
  });

  it('sorts by descending degree', () => {
    const c = computeDegreeCentrality([edge('A', 'B'), edge('A', 'C'), edge('B', 'A')]);
    expect(c.map((x) => x.nodeId)).toEqual(['A', 'B', 'C']); // deg 3, 2, 1
  });

  it('breaks degree ties alphabetically by nodeId', () => {
    // Z→Y and Y→Z: both degree 2 → tie → alphabetical
    const c = computeDegreeCentrality([edge('Z', 'Y'), edge('Y', 'Z')]);
    expect(c.map((x) => x.nodeId)).toEqual(['Y', 'Z']);
  });

  it('counts a self-edge as in+out but adds no distinct neighbour', () => {
    const c = computeDegreeCentrality([edge('A', 'A')]);
    expect(c[0]).toMatchObject({
      nodeId: 'A',
      inDegree: 1,
      outDegree: 1,
      degree: 2,
      distinctNeighbors: 0,
    });
  });
});

describe('§ZK-6 rankHubs', () => {
  it('returns the top-N nodes by degree', () => {
    // A→B, A→C, D→A → A:3, B:1, C:1, D:1 → top2 = A, B (tie-break)
    const hubs = rankHubs([edge('A', 'B'), edge('A', 'C'), edge('D', 'A')], 2);
    expect(hubs.map((h) => h.nodeId)).toEqual(['A', 'B']);
  });

  it('returns an empty array for limit <= 0', () => {
    expect(rankHubs([edge('A', 'B')], 0)).toEqual([]);
    expect(rankHubs([edge('A', 'B')], -1)).toEqual([]);
  });

  it('returns all nodes when the limit exceeds the node count', () => {
    expect(rankHubs([edge('A', 'B')], 10).map((h) => h.nodeId)).toEqual(['A', 'B']);
  });
});

describe('§ZK-6 findArchiveCandidates', () => {
  it('surfaces fully-isolated (degree 0) nodes from allNodeIds', () => {
    const cands = findArchiveCandidates(['A', 'B', 'ISO'], [edge('A', 'B')]);
    expect(cands).toEqual([{ nodeId: 'ISO', degree: 0, isolated: true }]);
  });

  it('includes leaves up to maxDegree, least-connected first', () => {
    // A→B, A→C → A:2, B:1, C:1, ISO:0
    const cands = findArchiveCandidates(
      ['A', 'B', 'C', 'ISO'],
      [edge('A', 'B'), edge('A', 'C')],
      { maxDegree: 1 },
    );
    expect(cands.map((c) => c.nodeId)).toEqual(['ISO', 'B', 'C']);
    expect(cands.find((c) => c.nodeId === 'ISO')?.isolated).toBe(true);
    expect(cands.find((c) => c.nodeId === 'B')?.isolated).toBe(false);
  });

  it('de-duplicates repeated ids in allNodeIds', () => {
    expect(findArchiveCandidates(['ISO', 'ISO'], [])).toHaveLength(1);
  });

  it('returns empty when every node exceeds maxDegree', () => {
    // A↔B both degree 2 → none ≤ 0
    const cands = findArchiveCandidates(['A', 'B'], [edge('A', 'B'), edge('B', 'A')], {
      maxDegree: 0,
    });
    expect(cands).toEqual([]);
  });
});
