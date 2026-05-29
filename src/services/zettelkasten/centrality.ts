// Praeventio Guard — §ZK-6: Graph centrality metrics + archive candidacy.
//
// Builds on §ZK-1 backlinks (`backlinks.ts`, per-node) with a GRAPH-LEVEL
// view: given the canonical edge list (`ZkEdge[]`), compute per-node degree
// centrality to surface:
//   (a) HUBS — highly-connected knowledge nodes worth promoting/pinning in the
//       Risk Network UI (a risk with many `mitigated_by`, a control documented
//       by many sources, etc.).
//   (b) ARCHIVE CANDIDATES — low-connectivity nodes (orphans/leaves) the
//       curator should review for archival. Zettelkasten hygiene: an isolated
//       note with no inbound references rarely earns its keep, and a graph that
//       only grows becomes noise.
//
// PURE functions — no Firestore, no store reads. The caller supplies the edge
// list (and, for archive candidacy, the full node-id set so isolated 0-degree
// nodes — which never appear in any edge — are included). Mirrors the purity of
// `backlinks.ts` for the same reasons: testability + reuse from jobs, the Risk
// Network analytics layer, and UI.
//
// NEVER auto-archives. `findArchiveCandidates` returns suggestions for human
// review, consistent with the smartActions rule ("nunca auto-aplicar").

import type { ZkEdge } from './edges';

export interface NodeCentrality {
  nodeId: string;
  /** Edges pointing AT this node (others reference it). */
  inDegree: number;
  /** Edges pointing AWAY from this node (it references others). */
  outDegree: number;
  /** inDegree + outDegree — total edge endpoints touching this node. */
  degree: number;
  /** Distinct neighbour nodes (a pair linked in both directions counts once). */
  distinctNeighbors: number;
}

export interface ArchiveCandidate {
  nodeId: string;
  degree: number;
  /** True when the node has NO edges at all (fully isolated). */
  isolated: boolean;
}

/**
 * Degree centrality for every node that appears in at least one edge, sorted
 * by descending degree (stable tie-break by nodeId). Isolated (0-degree) nodes
 * are NOT in the result — they never appear in an edge; pass them to
 * `findArchiveCandidates` via `allNodeIds` to surface them.
 *
 * A self-edge (fromNodeId === toNodeId) counts once toward both in- and
 * out-degree but contributes no distinct neighbour (a node is not its own
 * neighbour).
 */
export function computeDegreeCentrality(edges: readonly ZkEdge[]): NodeCentrality[] {
  const acc = new Map<string, { in: number; out: number; neighbors: Set<string> }>();
  const ensure = (id: string) => {
    let entry = acc.get(id);
    if (!entry) {
      entry = { in: 0, out: 0, neighbors: new Set<string>() };
      acc.set(id, entry);
    }
    return entry;
  };

  for (const edge of edges) {
    const from = ensure(edge.fromNodeId);
    const to = ensure(edge.toNodeId);
    from.out += 1;
    to.in += 1;
    if (edge.fromNodeId !== edge.toNodeId) {
      from.neighbors.add(edge.toNodeId);
      to.neighbors.add(edge.fromNodeId);
    }
  }

  return Array.from(acc.entries())
    .map(([nodeId, e]) => ({
      nodeId,
      inDegree: e.in,
      outDegree: e.out,
      degree: e.in + e.out,
      distinctNeighbors: e.neighbors.size,
    }))
    .sort((a, b) =>
      b.degree !== a.degree ? b.degree - a.degree : a.nodeId.localeCompare(b.nodeId),
    );
}

/**
 * Top-N hubs by total degree (stable tie-break by nodeId). `limit <= 0`
 * returns an empty array.
 */
export function rankHubs(edges: readonly ZkEdge[], limit: number): NodeCentrality[] {
  if (limit <= 0) return [];
  return computeDegreeCentrality(edges).slice(0, limit);
}

/**
 * Nodes whose total degree is `<= maxDegree` (default 0) — orphans/leaves the
 * curator should review for archival, sorted least-connected first.
 *
 * `allNodeIds` MUST include every node in scope so fully-isolated (0-degree)
 * nodes — which never appear in `edges` — are surfaced; they are the prime
 * archive candidates. Duplicate ids in `allNodeIds` are de-duplicated. This
 * returns SUGGESTIONS only — callers present them for human review and never
 * auto-archive.
 */
export function findArchiveCandidates(
  allNodeIds: readonly string[],
  edges: readonly ZkEdge[],
  opts: { maxDegree?: number } = {},
): ArchiveCandidate[] {
  const maxDegree = opts.maxDegree ?? 0;
  const degreeById = new Map<string, number>();
  for (const c of computeDegreeCentrality(edges)) degreeById.set(c.nodeId, c.degree);

  const seen = new Set<string>();
  const candidates: ArchiveCandidate[] = [];
  for (const nodeId of allNodeIds) {
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const degree = degreeById.get(nodeId) ?? 0;
    if (degree <= maxDegree) {
      candidates.push({ nodeId, degree, isolated: degree === 0 });
    }
  }

  return candidates.sort((a, b) =>
    a.degree !== b.degree ? a.degree - b.degree : a.nodeId.localeCompare(b.nodeId),
  );
}
