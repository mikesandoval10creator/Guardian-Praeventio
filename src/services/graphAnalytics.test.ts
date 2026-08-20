// Praeventio Guard — §LEGACY graphAnalytics: tests para functions legacy
// nodesToRiskGraph + computeOfflineNetworkHealth (path unweighted, offline).
// No toca emisor, firestore.rules, auth, package.json. Reusa helper riskNode
// del hermano graphAnalytics.weight.test.ts (mismo shape, conexiones pobladas).

import { describe, it, expect } from 'vitest';
import { nodesToRiskGraph, computeOfflineNetworkHealth } from './graphAnalytics';
import type { RiskNode } from '../types';

function riskNode(id: string, title: string, connections: string[] = []): RiskNode {
  return {
    id,
    type: 'Riesgo' as any,
    title,
    description: `desc-${id}`,
    tags: [],
    metadata: { severity: 3 },
    connections,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('§LEGACY nodesToRiskGraph', () => {
  const a = riskNode('a', 'A');
  const b = riskNode('b', 'B', ['a']);
  const c = riskNode('c', 'C', ['a', 'b']);

  it('mapea cada RiskNode a un RiskGraphNode con id+label+severity', () => {
    const graph = nodesToRiskGraph([a, b, c]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0]).toMatchObject({ id: 'a', label: 'A', severity: 3 });
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a', label: 'A', severity: 3 }),
        expect.objectContaining({ id: 'b', label: 'B', severity: 3 }),
        expect.objectContaining({ id: 'c', label: 'C', severity: 3 }),
      ]),
    );
  });

  it('construye aristas desde node.connections', () => {
    const graph = nodesToRiskGraph([a, b, c]);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'b', to: 'a' }),
        expect.objectContaining({ from: 'c', to: 'a' }),
        expect.objectContaining({ from: 'c', to: 'b' }),
      ]),
    );
  });

  it('deduplica aristas bidireccionales (A→B y B→A → 1 sola)', () => {
    const x = riskNode('x', 'X', ['y']);
    const y = riskNode('y', 'Y', ['x']);
    const graph = nodesToRiskGraph([x, y]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual(expect.objectContaining({ from: 'x', to: 'y' }));
  });

  it('preserva múltiples aristas entre el mismo par si vienen de nodos distintos', () => {
    const hub = riskNode('hub', 'Hub');
    const n1 = riskNode('n1', 'N1', ['hub']);
    const n2 = riskNode('n2', 'N2', ['hub']);
    const graph = nodesToRiskGraph([hub, n1, n2]);
    // n1→hub y n2→hub: claves distintas (n1--hub ≠ n2--hub), 2 aristas.
    expect(graph.edges).toHaveLength(2);
    const froms = graph.edges.map((e) => e.from).sort();
    expect(froms).toEqual(['n1', 'n2']);
  });
});

describe('§LEGACY computeOfflineNetworkHealth', () => {
  it('devuelve healthScore 100 para grafo vacío', () => {
    const insights = computeOfflineNetworkHealth([]);
    expect(insights.healthScore).toBe(100);
    expect(insights.missingSynapses).toEqual([]);
    expect(insights.knowledgeGaps).toEqual([]);
  });

  it('devuelve insights con healthScore en [0,100] para grafo no vacío', () => {
    const nodes = [
      riskNode('a', 'A', ['b']),
      riskNode('b', 'B', ['a']),
      riskNode('c', 'C'), // aislado → penaliza (isolatedNodes)
    ];
    const insights = computeOfflineNetworkHealth(nodes);
    expect(insights.healthScore).toBeGreaterThanOrEqual(0);
    expect(insights.healthScore).toBeLessThanOrEqual(100);
    // Nodo aislado 'c' con graph.edges presentes genera al menos un missingSynapse.
    expect(insights.missingSynapses.length).toBeGreaterThanOrEqual(1);
  });

  it('healthScore refleja conectividad (más conectado → más alto)', () => {
    // Grafo parcialmente desconectado: 2 componentes → connectivityScore 40, pero
    // aislamiento y blind-spot reducen el total por debajo de un grafo conexo.
    const fragmented = [
      riskNode('a', 'A', ['b']),
      riskNode('b', 'B', ['a']),
      riskNode('c', 'C', ['d']),
      riskNode('d', 'D', ['c']),
    ];
    // Grafo conexo: todos enlazados en cadena/ciclo.
    const connected = [
      riskNode('a', 'A', ['b']),
      riskNode('b', 'B', ['a', 'c']),
      riskNode('c', 'C', ['b']),
    ];

    const fragmentedScore = computeOfflineNetworkHealth(fragmented).healthScore;
    const connectedScore = computeOfflineNetworkHealth(connected).healthScore;

    // connected: componentCount=1 (connScore 40), isolated 0 (isoScore 30),
    //   blindSpot (3 nodes < 3? no, size=3 no es <3) → connScore 15; amp 0 → 15. Total 100.
    // fragmented: 2 components (connScore 40-5=35), isolated 0 (iso 30),
    //   blindSpot 2 comps size 2 → 2*3=6 penalty (15-6=9), amp 0 → 15. Total 35+30+9+15=89.
    // Relación: más conectado (1 comp) > fragmentado (2 comps).
    expect(connectedScore).toBeGreaterThan(fragmentedScore);
  });
});


describe('§LEGACY adversarial inputs', () => {
  it('nodesToRiskGraph con array vacío retorna grafo vacío', () => {
    const graph = nodesToRiskGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it('nodesToRiskGraph con nodo que tiene connection a sí mismo crea self-loop', () => {
    const self = riskNode('solo', 'Solo', ['solo']);
    const graph = nodesToRiskGraph([self]);
    // El algoritmo actual SÍ crea self-loop (no lo filtra)
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'solo', to: 'solo' });
  });

  it('computeOfflineNetworkHealth con un solo nodo aislado retorna healthScore < 100', () => {
    const isolated = [riskNode('solo', 'Solo')];
    const insights = computeOfflineNetworkHealth(isolated);
    expect(insights.healthScore).toBeLessThan(100);
  });
});
