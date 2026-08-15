// Praeventio Guard — [P1][Mejora-ZK] Camino de razonamiento explicable.
//
// Ticket 3a4aa66d-73fe-81f4-9ff8-fa922905d0c4: el grafo ZK no expone
// helpers de path traversal. Sin un findShortestPath BFS/DFS, la
// explicabilidad de recomendaciones (recommendationExplainer.ts) tiene
// que enlazar "evidencia → recomendación" ad-hoc; no puede mostrar la
// cadena causal real que une la causa con la conclusión.
//
// Este módulo agrega dos helpers puros sobre el grafo (nodos + aristas):
//   - findShortestPath   : BFS que retorna el primer camino entre
//                           fromId y toId (lista de nodeIds).
//   - findPathToAny      : BFS al primer nodo que pertenezca a un set
//                           de candidatos (uso típico: explicabilidad
//                           contra un set de evidencias).
//   - neighbors           : aristas salientes (closed form para tests).
//
// 100% determinístico. Sin IO. Sin LLM. Sin acceso a Firestore —
// el caller trae los nodos/edges en memoria. Esto permite tests
// puros con fixtures pequeños sin tocar el store.

import type { ZkEdge } from "./edges.js";

/** Minimal node shape for path operations. ZkNodeRef is the real
 *  interface; this is the smallest subset we need for traversal. */
export interface PathNode {
  id: string;
}

/** Outgoing edges from a single node, used to walk the graph. */
export function neighbors<T extends PathNode>(
  nodes: ReadonlyArray<T>,
  edges: ReadonlyArray<ZkEdge>,
  nodeId: string,
): Set<string> {
  const out = new Set<string>();
  // Only edges originating from nodeId and pointing to nodes that exist
  // in `nodes` (skip stale edges pointing at deleted nodes).
  for (const e of edges) {
    if (e.fromNodeId === nodeId && nodes.some((n) => n.id === e.toNodeId)) {
      out.add(e.toNodeId);
    }
  }
  return out;
}

/**
 * BFS shortest path between two node ids. Returns the list of node ids
 * (including both endpoints) or null if no path exists. Deterministic:
 * when multiple shortest paths exist, returns the one discovered first
 * via FIFO — the underlying BFS order matches the lexicographic order
 * of the edges array (stable insertion order from Firestore stream).
 *
 * Caller is responsible for sanity: `edges` may include references
 * to nodes absent from `nodes`; such dangling edges are ignored at
 * neighbor expansion time.
 */
export function findShortestPath<T extends PathNode>(
  nodes: ReadonlyArray<T>,
  edges: ReadonlyArray<ZkEdge>,
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return [fromId];
  const visited = new Set<string>([fromId]);
  // Each entry: [nodeId, path so far].
  const queue: Array<[string, string[]]> = [[fromId, [fromId]]];
  let head = 0;
  while (head < queue.length) {
    const [current, path] = queue[head++];
    for (const next of neighbors(nodes, edges, current)) {
      if (visited.has(next)) continue;
      const newPath = [...path, next];
      if (next === toId) return newPath;
      visited.add(next);
      queue.push([next, newPath]);
    }
  }
  return null;
}

/**
 * BFS shortest path from fromId to ANY node in targetIds. Returns the
 * matching node + the path that reached it, or null if no target is
 * reachable. Used by the explainability layer to locate the closest
 * supporting evidence for a recommendation when several candidates
 * exist.
 */
export function findPathToAny<T extends PathNode>(
  nodes: ReadonlyArray<T>,
  edges: ReadonlyArray<ZkEdge>,
  fromId: string,
  targetIds: ReadonlySet<string>,
): { target: string; path: string[] } | null {
  if (targetIds.size === 0) return null;
  if (targetIds.has(fromId)) return { target: fromId, path: [fromId] };
  const visited = new Set<string>([fromId]);
  const queue: Array<[string, string[]]> = [[fromId, [fromId]]];
  let head = 0;
  while (head < queue.length) {
    const [current, path] = queue[head++];
    for (const next of neighbors(nodes, edges, current)) {
      if (visited.has(next)) continue;
      const newPath = [...path, next];
      if (targetIds.has(next)) return { target: next, path: newPath };
      visited.add(next);
      queue.push([next, newPath]);
    }
  }
  return null;
}

/**
 * Slice of nodes reachable from `fromId` within `maxDepth` hops
 * (inclusive of the start node). Useful for "explaining which subgraph
 * connects this recommendation to its evidence cluster" — bounded BFS.
 */
export function reachableWithin<T extends PathNode>(
  nodes: ReadonlyArray<T>,
  edges: ReadonlyArray<ZkEdge>,
  fromId: string,
  maxDepth: number,
): Set<string> {
  const reached = new Set<string>([fromId]);
  let frontier = new Set<string>([fromId]);
  for (let depth = 0; depth < maxDepth; depth++) {
    const next = new Set<string>();
    for (const nodeId of frontier) {
      for (const neighbor of neighbors(nodes, edges, nodeId)) {
        if (!reached.has(neighbor)) {
          reached.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return reached;
}
