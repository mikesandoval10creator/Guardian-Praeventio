// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { findEulerianTraversal } from './eulerianPath';
import type { RiskGraph } from './graphConnectivity';

const graph = (
  nodeIds: string[],
  edgePairs: Array<[string, string]>,
): RiskGraph => ({
  nodes: nodeIds.map((id) => ({ id, label: id })),
  edges: edgePairs.map(([from, to]) => ({ from, to })),
});

/** Verifica que `sequence` recorra cada arista en `edges` exactamente una vez. */
const verifyTraversesAllEdges = (sequence: string[], edges: Array<[string, string]>) => {
  if (sequence.length === 0) return edges.length === 0;
  // Construir multiset de aristas no dirigidas pendientes.
  const pending = edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`));
  for (let i = 0; i < sequence.length - 1; i += 1) {
    const u = sequence[i]!;
    const v = sequence[i + 1]!;
    const key = u < v ? `${u}|${v}` : `${v}|${u}`;
    const idx = pending.indexOf(key);
    if (idx === -1) return false;
    pending.splice(idx, 1);
  }
  return pending.length === 0;
};

describe('findEulerianTraversal — Hierholzer 1873 (Fase 2)', () => {
  it('triangle ABC (all degree 2): kind=circuit, 4 nodes in sequence, 3 edges used', () => {
    const g = graph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['C', 'A']]);
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('circuit');
    expect(result.sequence).toHaveLength(4);
    expect(result.edgesUsed).toBe(3);
    expect(result.sequence[0]).toBe(result.sequence[3]); // cierra
    expect(verifyTraversesAllEdges(result.sequence, [['A', 'B'], ['B', 'C'], ['C', 'A']])).toBe(true);
  });

  it('linear chain A-B-C (degrees 1,2,1): kind=path, sequence covers all 3 nodes, 2 edges', () => {
    const g = graph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('path');
    expect(result.sequence).toHaveLength(3);
    expect(result.edgesUsed).toBe(2);
    // Comienza en uno de los impares (A o C), termina en el otro.
    const ends = [result.sequence[0], result.sequence[2]].sort();
    expect(ends).toEqual(['A', 'C']);
    expect(result.sequence[1]).toBe('B');
    expect(result.startNode).toBeDefined();
  });

  it('Königsberg 1736 (4 nodes, 7 edges, all 4 odd): kind=none, reason=too_many_odd_degree', () => {
    const g = graph(
      ['A', 'B', 'C', 'D'],
      [
        ['A', 'B'],
        ['A', 'B'],
        ['A', 'D'],
        ['B', 'D'],
        ['B', 'C'],
        ['B', 'C'],
        ['C', 'D'],
      ],
    );
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('none');
    expect(result.reason).toBe('too_many_odd_degree');
    expect(result.sequence).toEqual([]);
    expect(result.edgesUsed).toBe(0);
  });

  it('two disconnected triangles: kind=none, reason=disconnected', () => {
    const g = graph(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'A'],
        ['D', 'E'],
        ['E', 'F'],
        ['F', 'D'],
      ],
    );
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('none');
    expect(result.reason).toBe('disconnected');
  });

  it('empty graph: kind=circuit (vacuously), sequence=[], edgesUsed=0', () => {
    const result = findEulerianTraversal({ nodes: [], edges: [] });
    expect(result.kind).toBe('circuit');
    expect(result.sequence).toEqual([]);
    expect(result.edgesUsed).toBe(0);
  });

  it('single node, no edges: kind=circuit, sequence=[node], edgesUsed=0', () => {
    const result = findEulerianTraversal(graph(['A'], []));
    expect(result.kind).toBe('circuit');
    expect(result.sequence).toEqual(['A']);
    expect(result.edgesUsed).toBe(0);
  });

  it('self-loop on a single node: kind=circuit, sequence=[A,A], edgesUsed=1', () => {
    const g = graph(['A'], [['A', 'A']]);
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('circuit');
    expect(result.edgesUsed).toBe(1);
    expect(result.sequence).toEqual(['A', 'A']);
  });

  it('star graph (center C + 4 leaves): kind=none, reason=too_many_odd_degree', () => {
    // C tiene grado 4 (par), cada hoja tiene grado 1 (impar) → 4 impares.
    const g = graph(
      ['C', 'L1', 'L2', 'L3', 'L4'],
      [
        ['C', 'L1'],
        ['C', 'L2'],
        ['C', 'L3'],
        ['C', 'L4'],
      ],
    );
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('none');
    expect(result.reason).toBe('too_many_odd_degree');
  });

  it('butterfly graph (2 triangles sharing a vertex): kind=circuit', () => {
    // Nodos: H (hub), A, B (triángulo 1: H-A-B-H), C, D (triángulo 2: H-C-D-H).
    // H tiene grado 4, A,B,C,D grado 2 → todos pares.
    const g = graph(
      ['H', 'A', 'B', 'C', 'D'],
      [
        ['H', 'A'],
        ['A', 'B'],
        ['B', 'H'],
        ['H', 'C'],
        ['C', 'D'],
        ['D', 'H'],
      ],
    );
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('circuit');
    expect(result.edgesUsed).toBe(6);
    expect(result.sequence).toHaveLength(7);
    expect(result.sequence[0]).toBe(result.sequence[6]);
    expect(
      verifyTraversesAllEdges(result.sequence, [
        ['H', 'A'],
        ['A', 'B'],
        ['B', 'H'],
        ['H', 'C'],
        ['C', 'D'],
        ['D', 'H'],
      ]),
    ).toBe(true);
  });

  it('multi-edge graph (parallel edges A-B-A-B): each parallel edge used once', () => {
    // 4 aristas paralelas A-B → grados 4 y 4 (pares) → circuit.
    const g = graph(['A', 'B'], [['A', 'B'], ['A', 'B'], ['A', 'B'], ['A', 'B']]);
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('circuit');
    expect(result.edgesUsed).toBe(4);
    expect(result.sequence).toHaveLength(5);
  });

  it('edges-with-isolated-nodes: kind found ignoring isolated', () => {
    // Triángulo + nodo aislado X → conectividad de aristas OK.
    const g = graph(['A', 'B', 'C', 'X'], [['A', 'B'], ['B', 'C'], ['C', 'A']]);
    const result = findEulerianTraversal(g);
    expect(result.kind).toBe('circuit');
    expect(result.edgesUsed).toBe(3);
    expect(result.sequence).not.toContain('X');
  });

  it('determinism: same input → same output across multiple calls', () => {
    const g = graph(['A', 'B', 'C', 'D'], [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']]);
    const r1 = findEulerianTraversal(g);
    const r2 = findEulerianTraversal(g);
    expect(r1.sequence).toEqual(r2.sequence);
    expect(r1.kind).toBe(r2.kind);
  });

  it('performance: 100-edge cycle completes < 50ms', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `n${i}`);
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < ids.length; i += 1) {
      pairs.push([ids[i]!, ids[(i + 1) % ids.length]!]);
    }
    const g = graph(ids, pairs);
    const start = performance.now();
    const result = findEulerianTraversal(g);
    const elapsed = performance.now() - start;
    expect(result.kind).toBe('circuit');
    expect(result.edgesUsed).toBe(100);
    expect(elapsed).toBeLessThan(50);
  });
});
