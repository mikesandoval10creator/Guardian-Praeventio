// Tests §ZK-1 — Backlinks bidireccionales (agregador estructurado).
//
// El edge layer ya soporta traversal bidireccional via `getRelatedNodes`.
// Este test cubre el AGGREGATOR de output que estructura los `RelatedNode[]`
// para consumo de UI (panel "Referenced by") + análisis estadístico.

import { describe, it, expect } from 'vitest';
import type { RelatedNode, ZkEdge, EdgeType, InverseEdgeType } from './edges';
import {
  groupBacklinksByEdgeType,
  summarizeBacklinks,
  topReferencingNodes,
  countByDirection,
} from './backlinks';

const NOW = '2026-05-28T00:00:00.000Z';

function fakeEdge(
  from: string,
  to: string,
  type: EdgeType,
  inverseType: InverseEdgeType,
): ZkEdge {
  return {
    id: `${from}-${to}-${type}`,
    fromNodeId: from,
    toNodeId: to,
    type,
    inverseType,
    createdAt: NOW,
    createdBy: 'system',
    tenantId: 't-1',
  };
}

function incoming(
  otherId: string,
  via: EdgeType | InverseEdgeType,
  edgeType: EdgeType = 'references',
  inverseType: InverseEdgeType = 'referenced_by',
): RelatedNode {
  return {
    nodeId: otherId,
    via,
    direction: 'incoming',
    edge: fakeEdge(otherId, 'target', edgeType, inverseType),
  };
}

function outgoing(
  otherId: string,
  via: EdgeType | InverseEdgeType,
  edgeType: EdgeType = 'references',
  inverseType: InverseEdgeType = 'referenced_by',
): RelatedNode {
  return {
    nodeId: otherId,
    via,
    direction: 'outgoing',
    edge: fakeEdge('target', otherId, edgeType, inverseType),
  };
}

describe('groupBacklinksByEdgeType', () => {
  it('agrupa por edge type observado (via)', () => {
    const related: RelatedNode[] = [
      incoming('n-1', 'mitigated_by', 'mitigates', 'mitigated_by'),
      incoming('n-2', 'mitigated_by', 'mitigates', 'mitigated_by'),
      incoming('n-3', 'referenced_by', 'references', 'referenced_by'),
    ];
    const grouped = groupBacklinksByEdgeType(related);
    expect(grouped.mitigated_by?.length).toBe(2);
    expect(grouped.referenced_by?.length).toBe(1);
  });

  it('lista vacía → objeto vacío', () => {
    expect(groupBacklinksByEdgeType([])).toEqual({});
  });

  it('preserva direction outgoing también', () => {
    const related: RelatedNode[] = [
      outgoing('n-1', 'mitigates', 'mitigates', 'mitigated_by'),
      incoming('n-2', 'mitigated_by', 'mitigates', 'mitigated_by'),
    ];
    const grouped = groupBacklinksByEdgeType(related);
    expect(grouped.mitigates?.length).toBe(1);
    expect(grouped.mitigated_by?.length).toBe(1);
  });
});

describe('summarizeBacklinks', () => {
  it('totales por dirección', () => {
    const related: RelatedNode[] = [
      incoming('n-1', 'referenced_by'),
      incoming('n-2', 'referenced_by'),
      outgoing('n-3', 'references'),
    ];
    const summary = summarizeBacklinks(related);
    expect(summary.totalIncoming).toBe(2);
    expect(summary.totalOutgoing).toBe(1);
    expect(summary.totalRelated).toBe(3);
  });

  it('uniqueNodeCount cuenta nodos distintos', () => {
    const related: RelatedNode[] = [
      incoming('n-1', 'mitigated_by', 'mitigates', 'mitigated_by'),
      incoming('n-1', 'referenced_by', 'references', 'referenced_by'),
      incoming('n-2', 'referenced_by', 'references', 'referenced_by'),
    ];
    const summary = summarizeBacklinks(related);
    // n-1 aparece 2 veces (vía 2 edges distintos), n-2 1 vez → 2 unique
    expect(summary.uniqueNodeCount).toBe(2);
    expect(summary.totalRelated).toBe(3);
  });

  it('edgeTypeBreakdown cuenta por tipo', () => {
    const related: RelatedNode[] = [
      incoming('n-1', 'mitigated_by', 'mitigates', 'mitigated_by'),
      incoming('n-2', 'mitigated_by', 'mitigates', 'mitigated_by'),
      incoming('n-3', 'referenced_by', 'references', 'referenced_by'),
    ];
    const summary = summarizeBacklinks(related);
    expect(summary.edgeTypeBreakdown.mitigated_by).toBe(2);
    expect(summary.edgeTypeBreakdown.referenced_by).toBe(1);
  });

  it('vacío → totales 0', () => {
    const summary = summarizeBacklinks([]);
    expect(summary.totalIncoming).toBe(0);
    expect(summary.totalOutgoing).toBe(0);
    expect(summary.totalRelated).toBe(0);
    expect(summary.uniqueNodeCount).toBe(0);
    expect(summary.edgeTypeBreakdown).toEqual({});
  });
});

describe('topReferencingNodes', () => {
  it('ranking nodos con más edges entrantes', () => {
    const related: RelatedNode[] = [
      incoming('n-popular', 'mitigated_by', 'mitigates', 'mitigated_by'),
      incoming('n-popular', 'referenced_by', 'references', 'referenced_by'),
      incoming('n-popular', 'caused_by', 'causes', 'caused_by'),
      incoming('n-other', 'referenced_by', 'references', 'referenced_by'),
    ];
    const ranked = topReferencingNodes(related, 5);
    expect(ranked[0]?.nodeId).toBe('n-popular');
    expect(ranked[0]?.count).toBe(3);
    expect(ranked[1]?.nodeId).toBe('n-other');
    expect(ranked[1]?.count).toBe(1);
  });

  it('limit respetado', () => {
    const related: RelatedNode[] = [
      incoming('a', 'referenced_by'),
      incoming('b', 'referenced_by'),
      incoming('c', 'referenced_by'),
      incoming('d', 'referenced_by'),
    ];
    expect(topReferencingNodes(related, 2)).toHaveLength(2);
  });

  it('solo cuenta incoming (no outgoing)', () => {
    const related: RelatedNode[] = [
      outgoing('n-1', 'references'),
      incoming('n-2', 'referenced_by'),
    ];
    const ranked = topReferencingNodes(related, 5);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.nodeId).toBe('n-2');
  });

  it('lista vacía → []', () => {
    expect(topReferencingNodes([], 5)).toEqual([]);
  });
});

describe('countByDirection', () => {
  it('cuenta incoming + outgoing por separado', () => {
    const related: RelatedNode[] = [
      incoming('a', 'referenced_by'),
      incoming('b', 'referenced_by'),
      outgoing('c', 'references'),
    ];
    const counts = countByDirection(related);
    expect(counts.incoming).toBe(2);
    expect(counts.outgoing).toBe(1);
  });

  it('vacío → 0/0', () => {
    expect(countByDirection([])).toEqual({ incoming: 0, outgoing: 0 });
  });
});

describe('determinismo', () => {
  it('mismos inputs → mismos outputs', () => {
    const related: RelatedNode[] = [
      incoming('n-1', 'mitigated_by', 'mitigates', 'mitigated_by'),
      incoming('n-2', 'referenced_by', 'references', 'referenced_by'),
      outgoing('n-3', 'references', 'references', 'referenced_by'),
    ];
    const a = summarizeBacklinks(related);
    const b = summarizeBacklinks(related);
    expect(a).toEqual(b);
  });
});
