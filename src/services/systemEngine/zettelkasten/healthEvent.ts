// SystemEngine — Zettelkasten health event helper.
//
// Connects the existing Eulerian primitives in `services/euler/*` to the
// SystemEngine bus. Computes a 0-100 health score from the topology
// metrics already implemented (clustering, connectivity, eulerian path)
// and emits a `zettelkasten_health_changed` event so policies can react.
//
// We do NOT recompute graph metrics here — that's `services/euler/`'s
// job. This module is glue: graph → metrics → score → emit.

import { analyzeConnectivity, analyzeEulerianStructure, type RiskGraph } from '../../euler/graphConnectivity';
import { degreeCentrality } from '../../euler/zettelkastenTopology';
import { buildEnvelope, emit } from '../eventLog';
import { logger } from '../../../utils/logger';

export interface HealthScoreInputs {
  graph: RiskGraph;
  /** "Sweet spot" for graph density. 0.05–0.20 is healthy by default. */
  densityRange?: [number, number];
  /** Penalty per disconnected component beyond the first. Default −15. */
  componentPenalty?: number;
  /** Penalty per node that hubs more than `hubMaxFraction` of the graph. Default −10. */
  hubPenalty?: number;
  /** Hub threshold: a node is considered a hub if its degree centrality > this. */
  hubMaxFraction?: number;
}

export interface HealthScoreResult {
  score: number;
  components: number;
  cycles: number;
  hasEulerianPath: boolean;
  hasEulerianCycle: boolean;
  density: number;
  hubCount: number;
}

const DEFAULTS = {
  densityRange: [0.05, 0.2] as [number, number],
  componentPenalty: 15,
  hubPenalty: 10,
  hubMaxFraction: 0.4,
};

export function computeHealthScore(inputs: HealthScoreInputs): HealthScoreResult {
  const {
    graph,
    densityRange = DEFAULTS.densityRange,
    componentPenalty = DEFAULTS.componentPenalty,
    hubPenalty = DEFAULTS.hubPenalty,
    hubMaxFraction = DEFAULTS.hubMaxFraction,
  } = inputs;

  const v = graph.nodes.length;
  const e = graph.edges.length;
  const maxEdges = (v * (v - 1)) / 2;
  const density = maxEdges === 0 ? 0 : e / maxEdges;

  const connectivity = analyzeConnectivity(graph);
  const eulerian = analyzeEulerianStructure(graph);

  // Empty / trivial graphs don't have meaningful health; treat as neutral.
  if (v < 2) {
    return {
      score: 50,
      components: connectivity.componentCount,
      cycles: 0,
      hasEulerianPath: false,
      hasEulerianCycle: false,
      density,
      hubCount: 0,
    };
  }

  let score = 100;

  // Component penalty: every extra disconnected component is dead weight.
  if (connectivity.componentCount > 1) {
    score -= componentPenalty * (connectivity.componentCount - 1);
  }

  // Density bonus / penalty: too sparse = under-explored model; too dense
  // = over-linked / noisy.
  const [minDensity, maxDensity] = densityRange;
  if (density < minDensity) {
    score -= 15 * (1 - density / minDensity);
  } else if (density > maxDensity) {
    score -= 10 * Math.min(1, (density - maxDensity) / (1 - maxDensity));
  }

  // Hub penalty: a knowledge graph where a single node dominates is
  // fragile (single point of failure for the cascade).
  let hubCount = 0;
  for (const node of graph.nodes) {
    if (degreeCentrality(graph, node.id) > hubMaxFraction) hubCount++;
  }
  if (hubCount > 0) score -= hubPenalty * hubCount;

  // Reward the existence of a clean Eulerian path: it means a single
  // audit run can cover every relation without backtracking.
  if (eulerian.hasEulerianCircuit) score += 5;
  else if (eulerian.hasEulerianPath) score += 3;

  // Cycles surfaced by analyzeEulerianStructure as oddDegreeNodes/2 is a
  // rough proxy; eulerian-path absence with many odd nodes => likely cycles.
  // We don't enumerate cycles here (Johnson's algorithm is O(N+E)·(c+1));
  // a follow-up integration with a cycle-counter can populate `cycles`.
  const cycles = 0;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    components: connectivity.componentCount,
    cycles,
    hasEulerianPath: eulerian.hasEulerianPath,
    hasEulerianCycle: eulerian.hasEulerianCircuit,
    density,
    hubCount,
  };
}

/**
 * Computes the health score and emits `zettelkasten_health_changed`. Useful
 * to call from a debounced graph-change observer or from a Cloud Scheduler
 * job that ticks once an hour to update the dashboard.
 */
export async function emitZettelkastenHealth(args: {
  tenantId: string;
  projectId: string;
  graph: RiskGraph;
  actorUid?: string | null;
}): Promise<void> {
  try {
    const result = computeHealthScore({ graph: args.graph });
    await emit({
      ...buildEnvelope({
        tenantId: args.tenantId,
        projectId: args.projectId,
        actorUid: args.actorUid,
        idempotencyKey: `zk_health:${args.projectId}:${result.score}:${Math.floor(Date.now() / 60000)}`,
      }),
      type: 'zettelkasten_health_changed',
      payload: {
        projectId: args.projectId,
        score: result.score,
        components: result.components,
        cycles: result.cycles,
        hasEulerianPath: result.hasEulerianPath,
        hasEulerianCycle: result.hasEulerianCycle,
      },
    });
  } catch (err) {
    logger.warn('emitZettelkastenHealth failed', { err: String(err) });
  }
}
