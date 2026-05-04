// SPDX-License-Identifier: MIT
/**
 * Eulerian path / circuit finder — Fase 2 del plan Euler-Matrix
 * (Optimización de Flujos de Evacuación, Caminos de Euler).
 *
 * Un "camino euleriano" cruza CADA arista del grafo exactamente una vez.
 * Existe sii (Euler 1736):
 *   - El grafo es conexo (sobre las aristas)
 *   - Tiene exactamente 0 o 2 nodos de grado impar
 *
 * Si tiene 0 → es un CIRCUITO euleriano (cierra en el nodo de inicio).
 * Si tiene 2 → es un CAMINO euleriano (empieza y termina en los impares).
 *
 * Aplicación a evacuación (faena minera, planta industrial, hospital):
 * el grafo de pasillos + salidas debe permitir un paseo continuo sin
 * retroceder. Si hay más de 2 nodos de grado impar, hay puntos donde
 * el flujo se "atasca" — son las "trampas topológicas" del plan
 * Fase 2: la planificación de evacuación debe anteceder el problema
 * con bifurcaciones explícitas (rampas alternas, doble salida, etc.).
 *
 * Algoritmo: Hierholzer (1873). Complejidad O(V + E).
 *   1. Pick start (oddDegreeNodes[0] si 2 impares, else any).
 *   2. Stack-based traversal: mientras el nodo actual tenga aristas
 *      no usadas, sigue una; al agotar, pop al circuito de salida.
 *   3. El array final, reverseado, es la secuencia euleriana.
 *
 * Re-uso: este módulo NO duplica la teoría — invoca
 * `analyzeEulerianStructure` y `analyzeConnectivity` de
 * `graphConnectivity.ts` (Euler-1, Fase 1) para preflight.
 *
 * Pareja matemática con Bernoulli (`src/services/zettelkasten/
 * bernoulli/*`): Bernoulli mide presiones/velocidades en cada
 * pasillo (caudal de evacuados); Euler decide si el TRAZADO de
 * pasillos permite un paseo coherente. Los dos juntos = ruta
 * factible bajo carga real.
 *
 * Origen matemático:
 *   - Euler 1736 — "Solutio problematis ad geometriam situs
 *     pertinentis" (existencia: Königsberg).
 *   - Hierholzer 1873 — algoritmo constructivo lineal.
 *
 * Pure function, deterministic (igual entrada → igual salida —
 * adjacency se construye en el orden estable de `graph.edges`).
 */
import {
  analyzeConnectivity,
  analyzeEulerianStructure,
  type RiskGraph,
} from './graphConnectivity';

/** Tipo de paseo encontrado: 'circuit' cierra; 'path' no; 'none' no existe. */
export type EulerianTraversalKind = 'circuit' | 'path' | 'none';

/**
 * Razón por la que no existe paseo euleriano.
 * - 'too_many_odd_degree': hay más de 2 nodos con grado impar.
 * - 'disconnected': el subgrafo de aristas no es conexo (silos).
 */
export type EulerianTraversalNoneReason = 'too_many_odd_degree' | 'disconnected';

export interface EulerianTraversalResult {
  /** 'circuit' | 'path' | 'none'. */
  kind: EulerianTraversalKind;
  /**
   * Sequence of node IDs in traversal order.
   * - Para 'circuit' o 'path': length === edges.length + 1, primer y último
   *   nodo son el inicio (mismo nodo si es circuit, distinto si es path).
   * - Para 'none': array vacío.
   */
  sequence: string[];
  /**
   * Cantidad de aristas recorridas. Debe igual `graph.edges.length` cuando
   * `kind !== 'none'`. 0 cuando 'none'.
   */
  edgesUsed: number;
  /** Si `kind === 'none'`, explica el motivo. */
  reason?: EulerianTraversalNoneReason;
  /**
   * Cuando `kind === 'path'`, el nodo de inicio (uno de los 2 impares).
   * Cuando `kind === 'circuit'`, el nodo elegido como ancla (también el
   * último del `sequence`).
   */
  startNode?: string;
}

/**
 * Encuentra un circuito o camino euleriano vía algoritmo de Hierholzer.
 *
 * Casos especiales:
 * - Grafo vacío (0 nodos, 0 aristas) → kind='circuit', sequence=[],
 *   edgesUsed=0 (vacuamente eulerian — no hay nada que recorrer).
 * - Grafo con nodos pero sin aristas → kind='circuit' si hay ≥1 nodo,
 *   sequence=[node[0].id], edgesUsed=0 (vacuamente, ya que no hay
 *   aristas que cruzar).
 * - Self-loop sobre un único nodo → kind='circuit', sequence=[node, node],
 *   edgesUsed=1 (el self-loop cuenta como arista).
 *
 * Determinismo: la adjacency list se construye en el orden de
 * `graph.edges`. Hierholzer consume aristas del FINAL del array de
 * adyacencia (pop, O(1)), por lo que para una entrada fija el resultado
 * es estable.
 */
export function findEulerianTraversal(graph: RiskGraph): EulerianTraversalResult {
  const { nodes, edges } = graph;

  // Caso: grafo totalmente vacío. Vacuamente circuito (no hay aristas
  // que recorrer; no hay nodo donde anclarse). Devolvemos circuit
  // con sequence vacía.
  if (nodes.length === 0 && edges.length === 0) {
    return { kind: 'circuit', sequence: [], edgesUsed: 0 };
  }

  // Caso: nodos pero sin aristas. Consideramos circuit vacuo, anclado
  // al primer nodo (es lo que la mayoría de consumers espera para
  // pintar "no hay rutas que validar pero el nodo existe").
  if (edges.length === 0) {
    return {
      kind: 'circuit',
      sequence: [nodes[0]!.id],
      edgesUsed: 0,
      startNode: nodes[0]!.id,
    };
  }

  // Preflight con Fase 1 — reusamos la lógica probada en lugar de
  // recontar grados/conectividad aquí.
  const eulerian = analyzeEulerianStructure(graph);
  const oddCount = eulerian.oddDegreeNodes.length;

  // Si hay >2 impares, es imposible (Euler 1736). Devolvemos 'none'
  // con razón explícita para que la UI muestre el mensaje correcto.
  if (oddCount > 2) {
    return {
      kind: 'none',
      sequence: [],
      edgesUsed: 0,
      reason: 'too_many_odd_degree',
    };
  }

  // |odd|===1 es matemáticamente imposible (suma de grados es par).
  // Si llega aquí, hay datos sucios — preferimos fallar suave como
  // 'too_many_odd_degree' para no inducir caminos imposibles.
  if (oddCount === 1) {
    return {
      kind: 'none',
      sequence: [],
      edgesUsed: 0,
      reason: 'too_many_odd_degree',
    };
  }

  // Conectividad — sólo nos importa que los nodos QUE TIENEN ARISTAS
  // formen un solo componente. Nodos aislados no rompen el paseo.
  const conn = analyzeConnectivity(graph);
  const nodesWithEdges = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) {
      nodesWithEdges.add(edge.from);
    } else {
      nodesWithEdges.add(edge.from);
      nodesWithEdges.add(edge.to);
    }
  }

  // Construir sub-conectividad sólo sobre nodos con aristas.
  const subgraph: RiskGraph = {
    nodes: nodes.filter((n) => nodesWithEdges.has(n.id)),
    edges,
  };
  const subConn = analyzeConnectivity(subgraph);
  if (!subConn.isConnected && subgraph.nodes.length > 0) {
    return {
      kind: 'none',
      sequence: [],
      edgesUsed: 0,
      reason: 'disconnected',
    };
  }
  // (Si conn falla pero el sub-grafo sólo tiene un componente, está OK
  // — los nodos aislados sin aristas no participan del paseo.)
  void conn; // mantener referencia para el tipo / future-proof.

  // Construir adjacency list. Cada arista la representamos con un id
  // único (su índice en `edges`) para poder marcarla como "usada"
  // exactamente una vez incluso si hay multi-aristas paralelas
  // (Königsberg tiene aristas A-B duplicadas).
  type AdjEntry = { neighbor: string; edgeId: number };
  const adjacency = new Map<string, AdjEntry[]>();
  for (const node of nodes) adjacency.set(node.id, []);

  edges.forEach((edge, idx) => {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) return;
    if (edge.from === edge.to) {
      // Self-loop: añadimos UNA entrada (no dos), apuntando a sí mismo.
      // Hierholzer lo consumirá una sola vez.
      adjacency.get(edge.from)!.push({ neighbor: edge.to, edgeId: idx });
    } else {
      adjacency.get(edge.from)!.push({ neighbor: edge.to, edgeId: idx });
      adjacency.get(edge.to)!.push({ neighbor: edge.from, edgeId: idx });
    }
  });

  // Pick start: si hay 2 impares, empezamos en el primero (path); si
  // hay 0, cualquier nodo con aristas (circuit).
  let startNode: string;
  if (oddCount === 2) {
    startNode = eulerian.oddDegreeNodes[0]!;
  } else {
    // Buscar primer nodo con aristas (orden de `nodes`). Como ya
    // verificamos sub-conectividad, sabemos que existe.
    startNode = nodes.find((n) => nodesWithEdges.has(n.id))!.id;
  }

  // Hierholzer. Iterativo (sin recursion → seguro para grafos grandes).
  const usedEdges = new Set<number>();
  const stack: string[] = [startNode];
  const circuit: string[] = [];

  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const adjList = adjacency.get(top)!;

    // Encontrar siguiente arista no usada. Iteramos desde el final
    // (pop) para O(1) amortizado en remoción.
    let nextEntry: AdjEntry | undefined;
    while (adjList.length > 0) {
      const candidate = adjList[adjList.length - 1]!;
      if (usedEdges.has(candidate.edgeId)) {
        adjList.pop();
        continue;
      }
      nextEntry = candidate;
      adjList.pop();
      break;
    }

    if (nextEntry !== undefined) {
      usedEdges.add(nextEntry.edgeId);
      stack.push(nextEntry.neighbor);
    } else {
      // No hay más aristas desde este nodo → backtrack al circuito.
      circuit.push(stack.pop()!);
    }
  }

  // Hierholzer produce el circuito en reverso (porque hacemos pop al
  // backtrack). Lo invertimos.
  circuit.reverse();

  const edgesUsed = usedEdges.size;

  // Sanity check: si no consumimos todas las aristas, el grafo NO era
  // realmente conexo bajo nuestras suposiciones. Devolvemos 'none'.
  if (edgesUsed !== edges.length) {
    return {
      kind: 'none',
      sequence: [],
      edgesUsed: 0,
      reason: 'disconnected',
    };
  }

  // Determinar kind: circuit si primer === último nodo Y oddCount===0.
  const isCircuit = oddCount === 0 && circuit.length > 0 && circuit[0] === circuit[circuit.length - 1];

  return {
    kind: isCircuit ? 'circuit' : 'path',
    sequence: circuit,
    edgesUsed,
    startNode,
  };
}
