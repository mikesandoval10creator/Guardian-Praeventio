// Praeventio Guard — §ZK-1: Backlinks bidireccionales (agregador).
//
// El edge layer (`edges.ts`) ya soporta traversal bidireccional via
// `getRelatedNodes` con `direction: 'both'`. Lo que faltaba era el
// AGGREGATOR que estructura el output (`RelatedNode[]`) para consumo
// de:
//   - UI panel "Referenced by" en página de nodo
//   - Análisis estadístico Risk Network (hub-detection)
//   - Métricas de centralidad para auto-archive (§ZK-6)
//
// Funciones PURAS — no tocan Firestore, no leen del store. Consumen
// el output ya materializado de `getRelatedNodes` y lo proyectan a
// shapes útiles para downstream.

import type { EdgeType, InverseEdgeType, RelatedNode } from './edges';

/**
 * Cualquier etiqueta de edge que puede aparecer en `RelatedNode.via`
 * (tipo canónico OUTGOING o etiqueta inversa INCOMING).
 */
export type EdgeViaLabel = EdgeType | InverseEdgeType;

/**
 * Backlinks agrupados por el tipo observado desde el nodo `target`.
 *
 * Ejemplo: `target` es un Risk Node. `grouped.mitigated_by` =
 * todos los Control Nodes cuyos edges `mitigates` apuntan a este risk.
 */
export type BacklinksGrouped = Partial<Record<EdgeViaLabel, RelatedNode[]>>;

export interface BacklinksSummary {
  totalRelated: number;
  totalIncoming: number;
  totalOutgoing: number;
  /** Nodos distintos (un mismo nodo puede aparecer vía múltiples edges). */
  uniqueNodeCount: number;
  /** Conteo por `via` label (`mitigated_by`, `referenced_by`, etc). */
  edgeTypeBreakdown: Partial<Record<EdgeViaLabel, number>>;
}

export interface TopReferencingNode {
  nodeId: string;
  /** Cantidad de edges INCOMING desde este nodo al target. */
  count: number;
}

/** Group RelatedNode[] por su etiqueta `via`. */
export function groupBacklinksByEdgeType(related: RelatedNode[]): BacklinksGrouped {
  const grouped: BacklinksGrouped = {};
  for (const r of related) {
    const bucket = grouped[r.via] ?? [];
    bucket.push(r);
    grouped[r.via] = bucket;
  }
  return grouped;
}

/** Cuenta incoming + outgoing por separado. */
export function countByDirection(related: RelatedNode[]): {
  incoming: number;
  outgoing: number;
} {
  let incoming = 0;
  let outgoing = 0;
  for (const r of related) {
    if (r.direction === 'incoming') incoming += 1;
    else outgoing += 1;
  }
  return { incoming, outgoing };
}

/**
 * Ranking de nodos con más edges INCOMING hacia el target.
 *
 * Útil para descubrir hubs de información — un risk con muchos
 * `mitigates` incoming = control well-covered; un control con
 * muchos `documented_by` incoming = control bien documentado.
 *
 * Solo cuenta incoming porque "referencing" implica que el otro
 * apunta hacia mí.
 */
export function topReferencingNodes(
  related: RelatedNode[],
  limit: number,
): TopReferencingNode[] {
  const counts = new Map<string, number>();
  for (const r of related) {
    if (r.direction !== 'incoming') continue;
    counts.set(r.nodeId, (counts.get(r.nodeId) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([nodeId, count]) => ({ nodeId, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.nodeId.localeCompare(b.nodeId);
    })
    .slice(0, limit);
}

/** Resumen estructurado de backlinks para dashboard / métricas. */
export function summarizeBacklinks(related: RelatedNode[]): BacklinksSummary {
  const { incoming, outgoing } = countByDirection(related);
  const uniqueIds = new Set(related.map((r) => r.nodeId));
  const edgeTypeBreakdown: Partial<Record<EdgeViaLabel, number>> = {};
  for (const r of related) {
    edgeTypeBreakdown[r.via] = (edgeTypeBreakdown[r.via] ?? 0) + 1;
  }
  return {
    totalRelated: related.length,
    totalIncoming: incoming,
    totalOutgoing: outgoing,
    uniqueNodeCount: uniqueIds.size,
    edgeTypeBreakdown,
  };
}
