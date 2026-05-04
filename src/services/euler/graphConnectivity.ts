// SPDX-License-Identifier: MIT
/**
 * Euler graph connectivity primitives — Fase 1 del plan Euler-Matrix
 * (Cartografía Topológica de Riesgos).
 *
 * Aplicación a prevención: en la red de seguridad de un proyecto
 * (peligros como nodos, interacciones como aristas), un grafo no
 * conexo indica silos de riesgo invisibles entre sí. Detectarlos a
 * tiempo evita que un peligro identificado en un sub-grafo no escale
 * por la cadena hacia los componentes desconectados, donde nadie lo
 * está observando.
 *
 * Origen: Königsberg 1736 — Leonhard Euler probó en
 * "Solutio problematis ad geometriam situs pertinentis" que un paseo
 * que cruce cada puente exactamente una vez requiere que el grafo
 * tenga 0 nodos de grado impar (circuito euleriano, vuelve al origen)
 * o exactamente 2 (camino euleriano, extremos distintos). Ese teorema
 * fundó la teoría de grafos moderna.
 *
 * Aquí lo aplicamos al revés del sentido turístico: si la red de
 * peligros tiene >2 nodos de grado impar, hay "trampas topológicas"
 * — puntos donde la cadena de prevención no puede recorrerse
 * íntegramente sin saltar pasos, equivalente a que un protocolo
 * de inspección dejaría obligatoriamente cabos sueltos.
 *
 * Pareja físico-matemática: Bernoulli (`src/services/zettelkasten/
 * bernoulli/*`) modela las MAGNITUDES de cada peligro (presiones,
 * velocidades, fuerzas). Euler modela las RELACIONES entre ellos —
 * la estructura del tejido. Ambos juntos cubren la cuantificación
 * y la cartografía del riesgo.
 *
 * Pure functions, sin side effects, sin deps externas.
 */

/** Nodo del grafo de seguridad. `severity` opcional — usado por consumers para ordenar. */
export interface RiskGraphNode {
  id: string;
  label: string;
  severity?: number;
}

/** Arista no dirigida. `weight` opcional — usado por consumers para análisis de flujo. */
export interface RiskGraphEdge {
  from: string;
  to: string;
  weight?: number;
}

/** Grafo completo: nodos + aristas. */
export interface RiskGraph {
  nodes: RiskGraphNode[];
  edges: RiskGraphEdge[];
}

/** Resultado del análisis de conectividad (Fase 1). */
export interface ConnectivityReport {
  /** True si todos los nodos son alcanzables entre sí (o si el grafo está vacío). */
  isConnected: boolean;
  /** Cantidad de componentes conexos. 0 si el grafo está vacío. */
  componentCount: number;
  /** Tamaños de cada componente, ordenados desc, e.g. [12, 3, 1]. */
  componentSizes: number[];
  /** IDs de nodos que no tienen ninguna arista (incluye si solo tienen self-loop). */
  isolatedNodes: string[];
  /**
   * Índices (en `componentSizes`) de los componentes considerados "puntos ciegos":
   * componentes cuyo tamaño cae bajo `blindSpotThreshold`. Cada índice apunta
   * al mismo orden que `componentSizes`.
   */
  blindSpotComponentIds: number[];
}

/** Resultado del análisis euleriano (Fase 1, segunda mitad). */
export interface EulerianAnalysis {
  /**
   * True si existe un circuito euleriano (cierra y cruza cada arista
   * exactamente una vez). Requiere: grafo conexo + 0 nodos de grado impar.
   */
  hasEulerianCircuit: boolean;
  /**
   * True si existe un camino euleriano (cruza cada arista una vez,
   * sin necesidad de cerrar). Requiere: grafo conexo + exactamente 0 o 2
   * nodos de grado impar.
   */
  hasEulerianPath: boolean;
  /**
   * IDs de nodos con grado impar — "trampas topológicas" del plan Fase 2:
   * cualquier valor > 2 implica que la red de seguridad no puede
   * recorrerse sin saltos.
   */
  oddDegreeNodes: string[];
}

/**
 * Detecta componentes conexos del grafo via BFS iterativo, identifica
 * silos (componentes pequeños bajo el umbral) y nodos aislados.
 *
 * Convenciones:
 * - Grafo vacío (0 nodos) → `isConnected: true` vacuamente, `componentCount: 0`.
 * - Nodo con solo self-loops → tratado como aislado para conectividad
 *   (no conecta con nadie más); el self-loop sí cuenta para grado en
 *   `analyzeEulerianStructure`.
 * - Aristas con `from` o `to` que no apuntan a nodos del grafo: se ignoran
 *   silenciosamente (defensivo — datos sucios desde upstream son comunes).
 */
export function analyzeConnectivity(graph: RiskGraph, blindSpotThreshold = 3): ConnectivityReport {
  const { nodes, edges } = graph;

  if (nodes.length === 0) {
    return {
      isConnected: true,
      componentCount: 0,
      componentSizes: [],
      isolatedNodes: [],
      blindSpotComponentIds: [],
    };
  }

  // Adjacency map. Self-loops NO se cuentan como vecinos para conectividad
  // (un nodo no se "alcanza a sí mismo" para fines de descubrir silos).
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());

  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    if (edge.from === edge.to) continue; // self-loop: skip para vecindad
    adjacency.get(edge.from)!.add(edge.to);
    adjacency.get(edge.to)!.add(edge.from);
  }

  // BFS para encontrar componentes conexos.
  const visited = new Set<string>();
  const componentSizes: number[] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    let size = 0;
    const queue: string[] = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      size += 1;
      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    componentSizes.push(size);
  }

  componentSizes.sort((a, b) => b - a);

  // Aislados: nodos cuya entrada en `adjacency` queda con vecinos = 0.
  // Incluye nodos que solo tenían self-loops (que filtramos arriba).
  const isolatedNodes = nodes
    .filter((n) => adjacency.get(n.id)!.size === 0)
    .map((n) => n.id);

  // Silos: componentes cuyo tamaño está bajo el umbral.
  const blindSpotComponentIds: number[] = [];
  componentSizes.forEach((size, idx) => {
    if (size < blindSpotThreshold) blindSpotComponentIds.push(idx);
  });

  return {
    isConnected: componentSizes.length <= 1,
    componentCount: componentSizes.length,
    componentSizes,
    isolatedNodes,
    blindSpotComponentIds,
  };
}

/**
 * Aplica el teorema de Euler 1736 al grafo de seguridad: cuenta grados,
 * deriva existencia de circuito/camino euleriano y lista los nodos de
 * grado impar (las "trampas topológicas" mencionadas por el plan Fase 2).
 *
 * Reglas (Königsberg):
 * - hasEulerianCircuit: grafo conexo + |odd| === 0.
 * - hasEulerianPath: grafo conexo + (|odd| === 0 || |odd| === 2).
 * - Self-loops contribuyen +2 al grado del nodo (entran y salen del
 *   mismo nodo) — convención estándar en teoría de grafos.
 *
 * Para grafos no conexos retornamos `false` en ambos flags pero seguimos
 * exponiendo `oddDegreeNodes` para que el consumer pueda mostrar los
 * cuellos de botella aún cuando no exista paseo global.
 */
export function analyzeEulerianStructure(graph: RiskGraph): EulerianAnalysis {
  const { nodes, edges } = graph;

  if (nodes.length === 0) {
    return { hasEulerianCircuit: false, hasEulerianPath: false, oddDegreeNodes: [] };
  }

  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);

  for (const edge of edges) {
    if (!degree.has(edge.from) || !degree.has(edge.to)) continue;
    if (edge.from === edge.to) {
      // Self-loop: +2 al mismo nodo.
      degree.set(edge.from, degree.get(edge.from)! + 2);
    } else {
      degree.set(edge.from, degree.get(edge.from)! + 1);
      degree.set(edge.to, degree.get(edge.to)! + 1);
    }
  }

  const oddDegreeNodes: string[] = [];
  for (const [id, deg] of degree) {
    if (deg % 2 === 1) oddDegreeNodes.push(id);
  }

  // Eulerian circuit/path requieren grafo conexo (sobre nodos con al
  // menos una arista). Si la conectividad falla, marcamos ambos false.
  const conn = analyzeConnectivity(graph);
  // Caso especial: si todos los nodos están aislados (sin aristas),
  // técnicamente no hay nada que recorrer → ambos false.
  const hasAnyEdge = edges.length > 0;
  const isConnectedOverEdges = conn.isConnected && hasAnyEdge;

  return {
    hasEulerianCircuit: isConnectedOverEdges && oddDegreeNodes.length === 0,
    hasEulerianPath:
      isConnectedOverEdges &&
      (oddDegreeNodes.length === 0 || oddDegreeNodes.length === 2),
    oddDegreeNodes,
  };
}
