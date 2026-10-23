import type { RiskNode } from '../../types';

/**
 * Client-side defense in depth for the project boundary.
 * Firestore and the server are authoritative; UI consumers must never rely on
 * a query filter alone because stale snapshots and malformed legacy documents
 * can outlive the project that created them.
 */
export function filterProjectNodes(nodes: RiskNode[], projectId: string): RiskNode[] {
  return nodes.filter((node) => node.projectId === projectId);
}

export function buildProjectEdges(
  nodes: RiskNode[],
): { from: string; to: string }[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeSet = new Set<string>();
  const edges: { from: string; to: string }[] = [];

  nodes.forEach((node) => {
    (node.connections ?? []).forEach((toId) => {
      // A connection to an unreadable/foreign node is not a graph edge in this
      // project. Do not leak its identifier to graph consumers.
      if (!nodeIds.has(toId)) return;
      const key = [node.id, toId].sort().join('--');
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push({ from: node.id, to: toId });
    });
  });

  return edges;
}
