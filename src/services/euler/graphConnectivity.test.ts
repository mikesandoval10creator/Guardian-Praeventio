import { describe, it, expect } from 'vitest';
import {
  analyzeConnectivity,
  analyzeEulerianStructure,
  type RiskGraph,
} from './graphConnectivity';

const graph = (
  nodeIds: string[],
  edgePairs: Array<[string, string]>,
): RiskGraph => ({
  nodes: nodeIds.map((id) => ({ id, label: id })),
  edges: edgePairs.map(([from, to]) => ({ from, to })),
});

describe('analyzeConnectivity (Königsberg 1736 — Fase 1)', () => {
  it('empty graph: vacuously connected, zero components', () => {
    const report = analyzeConnectivity({ nodes: [], edges: [] });
    expect(report.isConnected).toBe(true);
    expect(report.componentCount).toBe(0);
    expect(report.componentSizes).toEqual([]);
    expect(report.isolatedNodes).toEqual([]);
    expect(report.blindSpotComponentIds).toEqual([]);
  });

  it('single node, no edges: connected, 1 component, isolated', () => {
    const report = analyzeConnectivity(graph(['A'], []));
    expect(report.isConnected).toBe(true);
    expect(report.componentCount).toBe(1);
    expect(report.componentSizes).toEqual([1]);
    expect(report.isolatedNodes).toEqual(['A']);
  });

  it('linear chain A-B-C: 1 connected component of size 3', () => {
    const report = analyzeConnectivity(graph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]));
    expect(report.isConnected).toBe(true);
    expect(report.componentCount).toBe(1);
    expect(report.componentSizes).toEqual([3]);
    expect(report.isolatedNodes).toEqual([]);
  });

  it('two disconnected pairs A-B, C-D: NOT connected, 2 components', () => {
    const report = analyzeConnectivity(
      graph(['A', 'B', 'C', 'D'], [['A', 'B'], ['C', 'D']]),
    );
    expect(report.isConnected).toBe(false);
    expect(report.componentCount).toBe(2);
    expect(report.componentSizes).toEqual([2, 2]);
  });

  it('blindSpotThreshold flags small components: a 5-node cluster + 1 lone silo', () => {
    const report = analyzeConnectivity(
      graph(
        ['A', 'B', 'C', 'D', 'E', 'X'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'D'],
          ['D', 'E'],
        ],
      ),
      3,
    );
    // Sizes desc: [5, 1]; threshold=3 → only the size-1 component is a silo.
    expect(report.componentSizes).toEqual([5, 1]);
    expect(report.blindSpotComponentIds).toEqual([1]);
    expect(report.isolatedNodes).toEqual(['X']);
  });

  it('ignores edges pointing to non-existent nodes (defensive)', () => {
    const report = analyzeConnectivity(
      graph(['A', 'B'], [['A', 'B'], ['A', 'GHOST']]),
    );
    expect(report.componentCount).toBe(1);
    expect(report.componentSizes).toEqual([2]);
  });

  it('node with only a self-loop is treated as isolated for connectivity', () => {
    const report = analyzeConnectivity(graph(['A'], [['A', 'A']]));
    expect(report.componentCount).toBe(1);
    expect(report.isolatedNodes).toEqual(['A']);
  });
});

describe('analyzeEulerianStructure (Königsberg 1736 — Euler theorem)', () => {
  it('triangle ABC: all degree 2 → Eulerian circuit exists', () => {
    const result = analyzeEulerianStructure(
      graph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['C', 'A']]),
    );
    expect(result.hasEulerianCircuit).toBe(true);
    expect(result.hasEulerianPath).toBe(true);
    expect(result.oddDegreeNodes).toEqual([]);
  });

  it('linear chain A-B-C: endpoints odd-degree → Eulerian path, no circuit', () => {
    const result = analyzeEulerianStructure(
      graph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]),
    );
    expect(result.hasEulerianCircuit).toBe(false);
    expect(result.hasEulerianPath).toBe(true);
    expect(result.oddDegreeNodes.sort()).toEqual(['A', 'C']);
  });

  it('Königsberg 1736 — 4 nodes, 7 edges, all 4 odd-degree: NO path, NO circuit', () => {
    // Classic configuration: A=land north, B=island east, C=land south, D=island west.
    // 7 puentes: A-B, A-B (two), A-D, B-D, B-C, B-C (two), C-D.
    const result = analyzeEulerianStructure(
      graph(
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
      ),
    );
    expect(result.hasEulerianCircuit).toBe(false);
    expect(result.hasEulerianPath).toBe(false);
    expect(result.oddDegreeNodes.length).toBe(4);
  });

  it('disconnected graph: even if degrees pass, both circuit/path are false', () => {
    // Two separate triangles — each is locally Eulerian, but globally not connected.
    const result = analyzeEulerianStructure(
      graph(
        ['A', 'B', 'C', 'D', 'E', 'F'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
          ['D', 'E'],
          ['E', 'F'],
          ['F', 'D'],
        ],
      ),
    );
    expect(result.hasEulerianCircuit).toBe(false);
    expect(result.hasEulerianPath).toBe(false);
    expect(result.oddDegreeNodes).toEqual([]);
  });

  it('self-loop adds +2 to node degree (Eulerian preserved)', () => {
    // A-B with a self-loop on A: degrees A=3 (1 + 2 from loop), B=1 → both odd, so Eulerian path exists.
    const result = analyzeEulerianStructure(
      graph(['A', 'B'], [['A', 'B'], ['A', 'A']]),
    );
    expect(result.oddDegreeNodes.sort()).toEqual(['A', 'B']);
    expect(result.hasEulerianPath).toBe(true);
    expect(result.hasEulerianCircuit).toBe(false);
  });

  it('empty graph: no circuit, no path, no odd nodes', () => {
    const result = analyzeEulerianStructure({ nodes: [], edges: [] });
    expect(result.hasEulerianCircuit).toBe(false);
    expect(result.hasEulerianPath).toBe(false);
    expect(result.oddDegreeNodes).toEqual([]);
  });

  it('all isolated nodes (no edges): no path/circuit', () => {
    const result = analyzeEulerianStructure(graph(['A', 'B', 'C'], []));
    expect(result.hasEulerianCircuit).toBe(false);
    expect(result.hasEulerianPath).toBe(false);
    expect(result.oddDegreeNodes).toEqual([]);
  });

  it('performance: 1000-node connected chain completes < 100ms', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `n${i}`);
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < ids.length - 1; i += 1) pairs.push([ids[i]!, ids[i + 1]!]);
    const start = performance.now();
    const report = analyzeConnectivity(graph(ids, pairs));
    const elapsed = performance.now() - start;
    expect(report.componentCount).toBe(1);
    expect(report.componentSizes).toEqual([1000]);
    expect(elapsed).toBeLessThan(100);
  });
});
