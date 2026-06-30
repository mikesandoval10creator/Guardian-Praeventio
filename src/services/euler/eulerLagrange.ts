// SPDX-License-Identifier: MIT
//
// Cálculo variacional Euler-Lagrange — Fase 8 del plan Euler-Matrix.
//
// Para un funcional J[γ] = ∫ L(t, γ, γ') dt, la trayectoria γ(t) que
// minimiza (o maximiza) J satisface la ecuación:
//
//   ∂L/∂γ - d/dt(∂L/∂γ') = 0
//
// Aplicación a prevención: optimizar la ruta de inspección del
// prevencionista. El "Lagrangiano" discreto es:
//
//   L = α·distancia + β·tiempo + γ·elevación − δ·prioridad_riesgo
//
// El "camino de mínima acción" minimiza fatiga + tiempo + costo
// cubriendo todas las áreas críticas. Vinculado al concepto Flow
// Infinito: el prevencionista fluye sin retrocesos innecesarios, con
// presencia donde el riesgo lo amerita.
//
// NOTA: la ecuación analítica de Euler-Lagrange aplica a sistemas
// continuos. Aquí discretizamos: el problema se vuelve un Traveling
// Salesman variant con weights. Usamos un greedy nearest-neighbor +
// 2-opt local search inspirado por la heurística variacional (preferir
// nodos donde el lagrangiano local es bajo).
//
// Este NO es TSP exacto — es heurístico O(N²) — para N pequeños
// (≤200 nodos típico de inspección) la solución es near-óptima en
// fracciones de segundo.
//
// Origen: Euler 1744 ("Methodus inveniendi"). Lagrange formalizó en
// 1755 — de ahí el nombre conjunto Euler-Lagrange.

export interface InspectionNode {
  id: string;
  /** Position in arbitrary plane coordinate (m). */
  x: number;
  y: number;
  /** Elevation gain to reach this node from baseline (m). 0 = ground level. */
  elevation?: number;
  /** Risk priority weight. Higher = more important to visit. */
  priority: number;
  /** Time required to inspect this node (min). */
  inspectionTime?: number;
}

export interface LagrangianWeights {
  /** Coefficient for distance cost (per meter). Default 1. */
  distance: number;
  /** Coefficient for time cost (per minute of inspection). Default 1. */
  time: number;
  /** Coefficient for elevation gain cost (per meter climbed). Default 5 — climbing is harder than walking flat. */
  elevation: number;
  /** Coefficient for priority benefit (subtracted from cost). Default −10 — higher priority lowers cost. */
  priority: number;
}

export const DEFAULT_LAGRANGIAN: LagrangianWeights = {
  distance: 1,
  time: 1,
  elevation: 5,
  priority: -10,
};

function euclidean(a: InspectionNode, b: InspectionNode): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Cost of traversing from a → b under the given lagrangian weights.
 * Pure function of the two endpoints + weights.
 *
 *   cost = w.distance · d(a,b)
 *        + w.time     · inspectionTime(b)
 *        + w.elevation · max(0, elev(b) − elev(a))
 *        + w.priority · priority(b)
 *
 * Note priority weight is typically negative so higher-priority targets
 * appear cheaper.
 */
export function edgeCost(
  a: InspectionNode,
  b: InspectionNode,
  weights: LagrangianWeights = DEFAULT_LAGRANGIAN,
): number {
  const distance = euclidean(a, b);
  const elevA = a.elevation ?? 0;
  const elevB = b.elevation ?? 0;
  const elevGain = Math.max(0, elevB - elevA);
  const inspect = b.inspectionTime ?? 0;
  return (
    weights.distance * distance +
    weights.time * inspect +
    weights.elevation * elevGain +
    weights.priority * b.priority
  );
}

/**
 * Total action (sum of edge costs) of a sequence of nodes.
 * Empty / single-node sequences have action 0.
 */
export function pathAction(
  sequence: InspectionNode[],
  weights: LagrangianWeights = DEFAULT_LAGRANGIAN,
): number {
  if (sequence.length < 2) return 0;
  let total = 0;
  for (let i = 0; i + 1 < sequence.length; i++) {
    total += edgeCost(sequence[i], sequence[i + 1], weights);
  }
  return total;
}

export interface OptimizedRoute {
  /** Sequence of node IDs in visit order. Starts at startNodeId. */
  order: string[];
  /** Total action (lower is better). */
  totalAction: number;
  /** Per-edge breakdown for UI / explainability. */
  legs: { from: string; to: string; cost: number }[];
}

function buildResult(
  sequence: InspectionNode[],
  weights: LagrangianWeights,
): OptimizedRoute {
  const legs: { from: string; to: string; cost: number }[] = [];
  for (let i = 0; i + 1 < sequence.length; i++) {
    legs.push({
      from: sequence[i].id,
      to: sequence[i + 1].id,
      cost: edgeCost(sequence[i], sequence[i + 1], weights),
    });
  }
  return {
    order: sequence.map((n) => n.id),
    totalAction: pathAction(sequence, weights),
    legs,
  };
}

/**
 * Greedy nearest-neighbor seed: from each step pick the unvisited node
 * with the lowest edge cost from the current position.
 */
function greedySeed(
  nodes: InspectionNode[],
  startIdx: number,
  weights: LagrangianWeights,
): InspectionNode[] {
  const N = nodes.length;
  const visited = new Array(N).fill(false);
  visited[startIdx] = true;
  const order: InspectionNode[] = [nodes[startIdx]];
  let current = startIdx;
  while (order.length < N) {
    let bestIdx = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let j = 0; j < N; j++) {
      if (visited[j]) continue;
      const cost = edgeCost(nodes[current], nodes[j], weights);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = j;
      }
    }
    if (bestIdx < 0) break; // disconnected (shouldn't happen with all-pairs costs)
    visited[bestIdx] = true;
    order.push(nodes[bestIdx]);
    current = bestIdx;
  }
  return order;
}

/**
 * 2-opt local search: try every pair of non-adjacent edges, swap if
 * total action improves. Loops until a full pass makes no improvement.
 * Preserves the start node at index 0.
 */
function twoOpt(
  sequence: InspectionNode[],
  weights: LagrangianWeights,
): InspectionNode[] {
  const N = sequence.length;
  if (N < 4) return sequence; // 2-opt needs ≥4 nodes
  const route = sequence.slice();
  // Convergence guard: a correct 2-opt local search converges within a bounded
  // number of full passes. Require a strict improvement margin (EPS) so
  // floating-point cost ties cannot trigger an oscillating zero-gain swap that
  // keeps `improved` true forever, and cap total passes at N² (far above the
  // O(N) expected) as a hard backstop against NaN/Infinity-tainted costs.
  // Without this the loop could spin indefinitely (it hung the test suite).
  const EPS = 1e-9;
  const maxPasses = N * N;
  let passes = 0;
  let improved = true;
  while (improved && passes < maxPasses) {
    passes++;
    improved = false;
    for (let i = 1; i < N - 2; i++) {
      for (let k = i + 1; k < N - 1; k++) {
        // Reverse segment route[i..k]; cheaper if the new pair of edges
        // (i-1 → i') + (k' → k+1) costs less than the old.
        const a = route[i - 1];
        const b = route[i];
        const c = route[k];
        const d = route[k + 1];
        const oldCost = edgeCost(a, b, weights) + edgeCost(c, d, weights);
        const newCost = edgeCost(a, c, weights) + edgeCost(b, d, weights);
        if (newCost < oldCost - EPS) {
          // Reverse i..k in place.
          const reversed = route.slice(i, k + 1).reverse();
          route.splice(i, k - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }
  return route;
}

/**
 * Find a near-optimal inspection route starting from `startNodeId` and
 * visiting all other nodes exactly once. Greedy + 2-opt heuristic,
 * O(N²) construction + iterative 2-opt refinement.
 *
 * @throws if startNodeId is not in nodes or nodes is empty.
 */
export function optimizeInspectionRoute(
  nodes: InspectionNode[],
  startNodeId: string,
  weightsOverride: Partial<LagrangianWeights> = {},
): OptimizedRoute {
  if (nodes.length === 0) {
    throw new Error('optimizeInspectionRoute: nodes array is empty');
  }
  const startIdx = nodes.findIndex((n) => n.id === startNodeId);
  if (startIdx < 0) {
    throw new Error(`optimizeInspectionRoute: startNodeId "${startNodeId}" not in nodes`);
  }
  const weights: LagrangianWeights = { ...DEFAULT_LAGRANGIAN, ...weightsOverride };

  if (nodes.length === 1) {
    return { order: [nodes[0].id], totalAction: 0, legs: [] };
  }

  const seeded = greedySeed(nodes, startIdx, weights);
  const refined = twoOpt(seeded, weights);
  return buildResult(refined, weights);
}
