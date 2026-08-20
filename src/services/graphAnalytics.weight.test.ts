// Praeventio Guard — §ZK-5 PR-3c: test de nodesToRiskGraphWithEdges.
//
// Verifica que el consumer path aplica effectiveWeight(): aristas vigentes
// se cuentan, expiradas no, decayFunc aplicado.
// No toca RiskNetworkHealth (ese test está en RiskNetworkHealth.test.tsx).

import { describe, it, expect } from 'vitest';
import { EDGE_TYPES, buildEdge, type ZkEdge } from './zettelkasten/edges';
import { nodesToRiskGraphWithEdges } from './graphAnalytics';
import type { RiskNode } from '../types';

const NOW = new Date('2026-08-13T12:00:00Z').getTime();

/** Minimal RiskNode fixture. */
function riskNode(id: string, title: string): RiskNode {
  return {
    id,
    type: 'Riesgo' as any,
    title,
    description: `desc-${id}`,
    tags: [],
    metadata: { severity: 3 },
    connections: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('§ZK-5 PR-3c nodesToRiskGraphWithEdges', () => {
  const nodes = [riskNode('n1', 'Risk 1'), riskNode('n2', 'Risk 2'), riskNode('n3', 'Risk 3')];

  it('incluye aristas vigentes en el grafo resultante', () => {
    const edge: ZkEdge = buildEdge({
      fromNodeId: 'n1',
      toNodeId: 'n2',
      type: 'mitigates',
      tenantId: 't1',
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const graph = nodesToRiskGraphWithEdges(nodes, [edge], NOW);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'n1', to: 'n2' });
  });

  it('excluye aristas expiradas (validUntil < now)', () => {
    const expired: ZkEdge = buildEdge({
      fromNodeId: 'n1',
      toNodeId: 'n2',
      type: 'requires',
      tenantId: 't1',
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-06-01T00:00:00.000Z', // expirada antes de NOW
    });
    const graph = nodesToRiskGraphWithEdges(nodes, [expired], NOW);
    expect(graph.edges).toHaveLength(0);
  });

  it('excluye aristas antes de validFrom', () => {
    const future: ZkEdge = buildEdge({
      fromNodeId: 'n1',
      toNodeId: 'n2',
      type: 'causes',
      tenantId: 't1',
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      validFrom: '2027-01-01T00:00:00.000Z', // en el futuro respecto a NOW
    });
    const graph = nodesToRiskGraphWithEdges(nodes, [future], NOW);
    expect(graph.edges).toHaveLength(0);
  });

  it('aplica decay exp y conserva el peso en RiskGraphEdge.weight', () => {
    // Edge con weight 0.5 y decayLineal, validFrom → validUntil.
    // En NOW (mitad del intervalo) el peso efectivo debe ser 0.25.
    const mid = new Date('2026-07-01T12:00:00Z').getTime(); // mitad entre validFrom y validUntil
    const half = 0.5;
    const edge: ZkEdge = buildEdge({
      fromNodeId: 'n1',
      toNodeId: 'n3',
      type: 'mitigates',
      tenantId: 't1',
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      weight: 0.5,
      validFrom: '2026-06-01T00:00:00.000Z',
      validUntil: '2026-08-01T00:00:00.000Z',
      decayFn: 'linear',
    });
    const graph = nodesToRiskGraphWithEdges(nodes, [edge], mid);
    expect(graph.edges).toHaveLength(1);
    // linear: weight * (1 - elapsed/total) = 0.5 * (1 - 0.5) = 0.25
    expect(graph.edges[0].weight).toBeCloseTo(0.25, 5);
  });

  it('skippea aristas que referencian nodos fuera del proyecto scope', () => {
    const outOfScope: ZkEdge = buildEdge({
      fromNodeId: 'n1',
      toNodeId: 'external-node',
      type: 'requires',
      tenantId: 't1',
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const graph = nodesToRiskGraphWithEdges(nodes, [outOfScope], NOW);
    expect(graph.edges).toHaveLength(0);
  });

  it('deduplica aristas bidireccionales (A→B y B→A)', () => {
    const e1: ZkEdge = buildEdge({
      fromNodeId: 'n1', toNodeId: 'n2', type: 'requires', tenantId: 't1', createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const e2: ZkEdge = buildEdge({
      fromNodeId: 'n2', toNodeId: 'n1', type: 'requires', tenantId: 't1', createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const graph = nodesToRiskGraphWithEdges(nodes, [e1, e2], NOW);
    // La arista es la misma (sort key) → deduplicada a 1.
    expect(graph.edges).toHaveLength(1);
  });
});
