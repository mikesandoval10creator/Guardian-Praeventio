// Praeventio Guard — Zettelkasten 3: Deterministic graph analytics (offline).
//
// Bridges the pure functions from graphConnectivity, centrality, and
// zettelkastenTopology into the HealthInsights shape that RiskNetworkHealth.tsx
// renders. Zero Gemini dependency — runs entirely on-device.
//
// Pure function. No Firestore, no side effects.

import type { RiskNode } from '../types';
import type { RiskGraph, RiskGraphNode, RiskGraphEdge } from './euler/graphConnectivity';
import { analyzeConnectivity } from './euler/graphConnectivity';
import { detectRiskAmplifications, type RiskAmplification } from './euler/zettelkastenTopology';

// ─── Types matching the Gemini response shape ──────────────────────────

export interface OfflineMissingSynapse {
  sourceId: string;
  targetId: string;
  sourceTitle: string;
  targetTitle: string;
  reason: string;
}

export interface OfflineKnowledgeGap {
  topic: string;
  priority: 'Alta' | 'Media' | 'Baja';
  suggestion: string;
}

export interface OfflineHealthInsights {
  healthScore: number;
  missingSynapses: OfflineMissingSynapse[];
  knowledgeGaps: OfflineKnowledgeGap[];
}

// ─── Conversion helper ─────────────────────────────────────────────────

/** Convert RiskNode[] (from UniversalKnowledgeContext) to RiskGraph for pure functions. */
export function nodesToRiskGraph(nodes: readonly RiskNode[]): RiskGraph {
  const riskNodes: RiskGraphNode[] = nodes.map((n) => ({
    id: n.id,
    label: n.title,
    severity: n.metadata?.severity as number | undefined,
  }));

  const edgeSet = new Set<string>();
  const riskEdges: RiskGraphEdge[] = [];

  for (const node of nodes) {
    for (const targetId of node.connections) {
      const key = [node.id, targetId].sort().join('--');
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        riskEdges.push({ from: node.id, to: targetId });
      }
    }
  }

  return { nodes: riskNodes, edges: riskEdges };
}

// ─── Health score computation ───────────────────────────────────────────

/**
 * Deterministic health score [0, 100] based on graph structure.
 *
 * Components:
 *   - 40 pts: connectivity (fully connected = 40, each extra component -5)
 *   - 30 pts: isolation penalty (proportion of isolated nodes)
 *   - 15 pts: blind-spot penalty (small disconnected clusters)
 *   - 15 pts: risk amplification penalty (dangerous combos present)
 */
function computeHealthScore(
  graph: RiskGraph,
  amplifications: readonly RiskAmplification[],
): number {
  if (graph.nodes.length === 0) return 100; // vacuously healthy

  const conn = analyzeConnectivity(graph);

  // Connectivity component (40 pts).
  // isConnected → 40; each extra component beyond 1 costs 5, min 0.
  const connectivityPenalty = Math.max(0, (conn.componentCount - 1) * 5);
  const connectivityScore = Math.max(0, 40 - connectivityPenalty);

  // Isolation component (30 pts).
  const isolationRatio = conn.isolatedNodes.length / graph.nodes.length;
  const isolationScore = Math.round(30 * (1 - isolationRatio));

  // Blind-spot component (15 pts).
  // Each blind-spot component costs 3, min 0.
  const blindSpotPenalty = conn.blindSpotComponentIds.length * 3;
  const blindSpotScore = Math.max(0, 15 - blindSpotPenalty);

  // Risk amplification component (15 pts).
  // 0 amplifications = 15; each detected combo costs 2, min 0.
  const ampPenalty = amplifications.length * 2;
  const ampScore = Math.max(0, 15 - ampPenalty);

  return connectivityScore + isolationScore + blindSpotScore + ampScore;
}

// ─── Missing synapses from isolated nodes ───────────────────────────────

/**
 * For each isolated node, suggest connecting it to the highest-degree hub
 * in the graph (most likely to be a relevant knowledge anchor).
 */
function synapsesFromIsolated(
  graph: RiskGraph,
  conn: ReturnType<typeof analyzeConnectivity>,
): OfflineMissingSynapse[] {
  if (conn.isolatedNodes.length === 0 || graph.edges.length === 0) return [];

  // Find the hub with the most edges.
  const degreeMap = new Map<string, number>();
  for (const edge of graph.edges) {
    degreeMap.set(edge.from, (degreeMap.get(edge.from) ?? 0) + 1);
    degreeMap.set(edge.to, (degreeMap.get(edge.to) ?? 0) + 1);
  }

  const labelById = new Map<string, string>();
  for (const n of graph.nodes) labelById.set(n.id, n.label);

  // Sort hubs by degree descending.
  const hubs = Array.from(degreeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3); // top 3 hubs

  const synapses: OfflineMissingSynapse[] = [];
  for (const isolatedId of conn.isolatedNodes) {
    // Pick the best hub for this isolated node.
    const hub = hubs[0];
    if (!hub) continue;
    const [hubId] = hub;
    if (hubId === isolatedId) continue;

    synapses.push({
      sourceId: isolatedId,
      targetId: hubId,
      sourceTitle: labelById.get(isolatedId) ?? isolatedId,
      targetTitle: labelById.get(hubId) ?? hubId,
      reason: 'Nodo aislado sin conexiones — requiere vínculo con la red principal.',
    });
  }

  return synapses.slice(0, 10); // cap to avoid overwhelming the UI
}

// ─── Knowledge gaps from risk amplifications ────────────────────────────

function gapsFromAmplifications(
  amplifications: readonly RiskAmplification[],
): OfflineKnowledgeGap[] {
  return amplifications.map((amp) => ({
    topic: `Combinación de riesgo: ${amp.source[0]} + ${amp.source[1]}`,
    priority: amp.amplification >= 10 ? 'Alta' : amp.amplification >= 5 ? 'Media' : 'Baja',
    suggestion: `Riesgo emergente "${amp.derivedRisk}" (factor ×${amp.amplification}). Verificar controles y barreras entre ambos nodos.`,
  }));
}

// ─── Knowledge gaps from disconnected components ────────────────────────

function gapsFromDisconnected(
  _graph: RiskGraph,
  conn: ReturnType<typeof analyzeConnectivity>,
): OfflineKnowledgeGap[] {
  if (conn.componentCount <= 1) return [];

  // Each disconnected component beyond the main one is a gap.
  const gaps: OfflineKnowledgeGap[] = [];
  const sizes = conn.componentSizes;

  for (let i = 1; i < sizes.length; i++) {
    const size = sizes[i];
    gaps.push({
      topic: `Componente desconectado #${i + 1} (${size} nodo${size > 1 ? 's' : ''})`,
      priority: size >= 3 ? 'Alta' : 'Media',
      suggestion: `Este sub-grafo está aislado del componente principal. Conectar nodos puente para integrar la información de seguridad.`,
    });
  }

  return gaps;
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Compute deterministic offline health insights from RiskNode[].
 *
 * Replaces the Gemini-based analyzeRiskNetworkHealth for offline use.
 * Same output shape so RiskNetworkHealth.tsx can render either.
 */
export function computeOfflineNetworkHealth(nodes: readonly RiskNode[]): OfflineHealthInsights {
  const graph = nodesToRiskGraph(nodes);

  if (graph.nodes.length === 0) {
    return { healthScore: 100, missingSynapses: [], knowledgeGaps: [] };
  }

  const conn = analyzeConnectivity(graph);
  const amplifications = detectRiskAmplifications(graph);

  const healthScore = computeHealthScore(graph, amplifications);
  const missingSynapses = synapsesFromIsolated(graph, conn);
  const knowledgeGaps = [
    ...gapsFromAmplifications(amplifications),
    ...gapsFromDisconnected(graph, conn),
  ];

  return { healthScore, missingSynapses, knowledgeGaps };
}
