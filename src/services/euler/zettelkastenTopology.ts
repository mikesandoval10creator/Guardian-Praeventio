// SPDX-License-Identifier: MIT
//
// Topología auto-organizativa de Zettelkasten — Fase 7 del plan Euler-Matrix.
//
// El Zettelkasten de Praeventio modela el conocimiento de prevención
// como un grafo: nodos = conceptos (humedad, electricidad, polvo, ruido,
// EPP, normativas, casos de incidente), aristas = relaciones inferidas
// (cita, opone, deriva, agrava, mitiga).
//
// Aplicación a prevención (insight del usuario):
//   "Si el nodo A (humedad) y el nodo B (electricidad) se conectan, el
//    riesgo C (electrocución) aumenta exponencialmente."
//
// Este módulo aplica métricas topológicas para que el sistema
// "aprenda" qué nodos son centrales y qué conexiones revelan riesgos
// emergentes — no solo la suma de los riesgos individuales sino el
// PRODUCTO de su acoplamiento.
//
// Métricas implementadas:
//   - clusteringCoefficient — qué tan denso es el barrio de un nodo
//   - degreeCentrality — cuántas conexiones tiene un nodo (normalizado)
//   - betweennessCentrality — fracción de caminos cortos que pasan
//     por un nodo (cuello de botella en el flujo de información)
//   - riskAmplificationScore — peligro emergente de combinaciones
//     de nodos de clase riesgo (humedad + electricidad → electrocución)
//
// Origen: Euler 1736 (teoría de grafos) + métricas de topología de
// redes desarrolladas por Watts & Strogatz (1998), Freeman (1977).
// Aplicado aquí a la auto-organización del Zettelkasten.
//
// Reusa primitivos de `graphConnectivity.ts` para no duplicar adjacency
// build. Pure functions, no side effects.

import type { RiskGraph, RiskGraphNode } from './graphConnectivity';

/** Adjacency map keyed by node id. Both directions populated for undirected graphs. */
type AdjacencyMap = Map<string, Set<string>>;

/** Build adjacency map from RiskGraph. Treats edges as undirected. */
function buildAdjacency(graph: RiskGraph): AdjacencyMap {
  const adj: AdjacencyMap = new Map();
  for (const node of graph.nodes) {
    if (!adj.has(node.id)) adj.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, new Set());
    if (!adj.has(edge.to)) adj.set(edge.to, new Set());
    adj.get(edge.from)!.add(edge.to);
    adj.get(edge.to)!.add(edge.from);
  }
  return adj;
}

/**
 * Coeficiente de clustering local C(v) = 2·|E_v| / (k_v · (k_v − 1))
 * donde E_v = aristas entre los k_v vecinos de v.
 *
 * Rango [0, 1]. C=1 significa que todos los vecinos del nodo están
 * conectados entre sí (clique). C=0 significa que ningún vecino se
 * conecta con otro vecino.
 *
 * Aplicación: alto clustering en una región del Zettelkasten = "tema
 * cohesivo" (ej. todos los conceptos sobre EPP están relacionados).
 * Bajo clustering = nodo "puente" entre temas distintos.
 *
 * Para nodos con grado < 2 se devuelve 0 (no hay triángulos posibles).
 */
export function clusteringCoefficient(graph: RiskGraph, nodeId: string): number {
  const adj = buildAdjacency(graph);
  const neighbors = adj.get(nodeId);
  if (!neighbors || neighbors.size < 2) return 0;
  const k = neighbors.size;
  let edgesAmongNeighbors = 0;
  const arr = Array.from(neighbors);
  for (let i = 0; i < arr.length; i++) {
    const ni = arr[i];
    const niAdj = adj.get(ni);
    if (!niAdj) continue;
    for (let j = i + 1; j < arr.length; j++) {
      if (niAdj.has(arr[j])) edgesAmongNeighbors++;
    }
  }
  // Maximum possible edges among k neighbors = k·(k-1)/2.
  const maxEdges = (k * (k - 1)) / 2;
  return edgesAmongNeighbors / maxEdges;
}

/**
 * Grado normalizado: degree(v) / (N − 1), donde N es el total de nodos.
 * Rango [0, 1]. 1 significa que el nodo está conectado con TODOS los
 * demás (hub absoluto).
 *
 * Aplicación: identifica "nodos hub" del Zettelkasten — conceptos
 * mencionados por muchos otros (ej. "EPP" probablemente sea un hub).
 */
export function degreeCentrality(graph: RiskGraph, nodeId: string): number {
  if (graph.nodes.length <= 1) return 0;
  const adj = buildAdjacency(graph);
  const neighbors = adj.get(nodeId);
  if (!neighbors) return 0;
  return neighbors.size / (graph.nodes.length - 1);
}

/**
 * Betweenness centrality (Freeman 1977): fracción de pares de nodos
 * cuyo camino más corto pasa por v.
 *
 *   B(v) = Σ_{s≠v≠t} σ_st(v) / σ_st
 *
 * donde σ_st = # de caminos cortos s→t y σ_st(v) = # que pasan por v.
 *
 * Implementación: BFS desde cada nodo (algoritmo de Brandes 2001).
 * O(N · E) tiempo, O(N²) espacio.
 *
 * Aplicación: alto betweenness = nodo crítico para el flujo de
 * conocimiento. Si lo eliminas, otros conceptos quedan desconectados.
 * En un Zettelkasten de prevención, identifica conceptos "puente"
 * entre dominios (ej. "humedad" puede ser puente entre "eléctrico" y
 * "biológico-moho").
 *
 * Devuelve un Map<nodeId, betweenness> con rangos [0, ∞) — para
 * normalizar dividir por (N-1)(N-2)/2 en grafos no dirigidos.
 */
export function betweennessCentrality(graph: RiskGraph): Map<string, number> {
  const result = new Map<string, number>();
  for (const n of graph.nodes) result.set(n.id, 0);

  const adj = buildAdjacency(graph);

  // Brandes' algorithm — single-source shortest path with predecessor tracking.
  for (const source of graph.nodes) {
    const stack: string[] = [];
    const predecessors = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();

    for (const v of graph.nodes) {
      predecessors.set(v.id, []);
      sigma.set(v.id, 0);
      dist.set(v.id, -1);
    }
    sigma.set(source.id, 1);
    dist.set(source.id, 0);

    const queue: string[] = [source.id];
    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const vAdj = adj.get(v) ?? new Set<string>();
      for (const w of vAdj) {
        if (dist.get(w) === -1) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          predecessors.get(w)!.push(v);
        }
      }
    }

    // Accumulation
    const delta = new Map<string, number>();
    for (const v of graph.nodes) delta.set(v.id, 0);
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of predecessors.get(w)!) {
        const contribution = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + contribution);
      }
      if (w !== source.id) {
        result.set(w, result.get(w)! + delta.get(w)!);
      }
    }
  }

  // Each pair counted twice (s→t y t→s). Divide by 2 para grafos no dirigidos.
  for (const [k, v] of result.entries()) {
    result.set(k, v / 2);
  }
  return result;
}

export interface RiskAmplification {
  /** Pair of node IDs that, when both present + connected, amplify a derived risk. */
  source: [string, string];
  /** Description of the amplified risk (e.g., "electrocución"). */
  derivedRisk: string;
  /** Multiplicative factor applied to baseline severity. */
  amplification: number;
}

/**
 * Catálogo curado de combinaciones de riesgo conocidas. Cada entrada
 * es una pareja de conceptos que, cuando aparecen conectados en el
 * Zettelkasten del proyecto, indican un riesgo emergente.
 *
 * Esto es seed knowledge — futuro Sprint puede aprenderlas vía
 * histórico de incidentes. Por ahora hardcoded con casos canónicos.
 */
export const KNOWN_RISK_AMPLIFICATIONS: ReadonlyArray<RiskAmplification> = [
  { source: ['humedad', 'electricidad'], derivedRisk: 'electrocucion', amplification: 8 },
  { source: ['polvo', 'electricidad'], derivedRisk: 'arco_electrico', amplification: 5 },
  { source: ['polvo', 'chispa'], derivedRisk: 'explosion_polvorienta', amplification: 12 },
  { source: ['gas_inflamable', 'chispa'], derivedRisk: 'deflagracion', amplification: 15 },
  { source: ['altura', 'fatiga'], derivedRisk: 'caida_grave', amplification: 6 },
  { source: ['ruido', 'fatiga'], derivedRisk: 'error_humano', amplification: 3 },
  { source: ['confinado', 'gas_toxico'], derivedRisk: 'asfixia_quimica', amplification: 20 },
  { source: ['carga_pesada', 'piso_resbaloso'], derivedRisk: 'aplastamiento', amplification: 7 },
  { source: ['soldadura', 'oxigeno_alto'], derivedRisk: 'incendio_intenso', amplification: 10 },
  { source: ['frio_extremo', 'humedad'], derivedRisk: 'hipotermia', amplification: 4 },
];

/**
 * Detecta amplificaciones de riesgo activas en el grafo: pares del
 * catálogo que aparecen como aristas conectadas. Devuelve el subset
 * que aplica al grafo dado.
 *
 * Las búsquedas son case-insensitive y por substring contra los IDs
 * Y los labels de los nodos — flexibilidad para que el catálogo
 * funcione con múltiples nomenclaturas del Zettelkasten.
 */
export function detectRiskAmplifications(
  graph: RiskGraph,
  catalog: ReadonlyArray<RiskAmplification> = KNOWN_RISK_AMPLIFICATIONS,
): RiskAmplification[] {
  const adj = buildAdjacency(graph);
  const labelByLower = new Map<string, RiskGraphNode>();
  for (const n of graph.nodes) {
    labelByLower.set(n.id.toLowerCase(), n);
    labelByLower.set(n.label.toLowerCase(), n);
  }

  const findNodeMatching = (term: string): RiskGraphNode | undefined => {
    const lower = term.toLowerCase();
    // Exact match first.
    if (labelByLower.has(lower)) return labelByLower.get(lower);
    // Substring match second.
    for (const [key, node] of labelByLower.entries()) {
      if (key.includes(lower)) return node;
    }
    return undefined;
  };

  const out: RiskAmplification[] = [];
  for (const entry of catalog) {
    const a = findNodeMatching(entry.source[0]);
    const b = findNodeMatching(entry.source[1]);
    if (!a || !b || a.id === b.id) continue;
    const aAdj = adj.get(a.id);
    if (aAdj && aAdj.has(b.id)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Score agregado de amplificación en el grafo: producto de los
 * factores de amplificación de cada combinación detectada.
 *
 *   score = Π amplification_i
 *
 * Si no hay combinaciones detectadas devuelve 1 (riesgo baseline).
 *
 * Aplicación: dashboard de prevención muestra un score "indice de
 * peligro emergente" — cuantitativo y comparable entre proyectos.
 */
export function totalAmplificationScore(
  graph: RiskGraph,
  catalog: ReadonlyArray<RiskAmplification> = KNOWN_RISK_AMPLIFICATIONS,
): number {
  const detected = detectRiskAmplifications(graph, catalog);
  if (detected.length === 0) return 1;
  return detected.reduce((acc, e) => acc * e.amplification, 1);
}
