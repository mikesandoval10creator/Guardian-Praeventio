// Praeventio Guard — ZK knowledge graph → learning skill tree projection.
//
// This is a read-only, deterministic projection. It turns the project-scoped
// canonical node graph plus a worker's own learning cards into a navigable
// learning view. It is deliberately NOT a certification engine and MUST NOT
// gate SOS, emergency response, controls, reporting, or any safety capability.

export interface KnowledgeSkillNodeInput {
  id: string;
  title: string;
  description: string;
  connections: readonly string[];
}

export interface KnowledgeSkillTypedEdge {
  source: string;
  target: string;
  type: string;
}

export interface KnowledgeLearningCard {
  id: string;
  topic: string;
  reviewCount: number;
  intervalDays: number;
  nextReviewAt: string;
}

export type KnowledgeLearningState = "not_started" | "learning" | "review_due";

export interface KnowledgeSkill {
  nodeId: string;
  title: string;
  description: string;
  connectionCount: number;
  relationTypes: string[];
  isHub: boolean;
  /** Always true: this is guidance, never a safety-access gate. */
  available: true;
  recommended: boolean;
  learningState: KnowledgeLearningState;
}

export interface KnowledgeSkillTree {
  skills: KnowledgeSkill[];
  availableCount: number;
}

function normalizeTopic(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isReviewDue(card: KnowledgeLearningCard, nowIso: string): boolean {
  const due = Date.parse(card.nextReviewAt);
  const now = Date.parse(nowIso);
  return Number.isFinite(due) && Number.isFinite(now) && due <= now;
}

/**
 * Builds a project-local knowledge-skill tree. Topic evidence is deliberately
 * exact after normalization (case, accents, punctuation and spacing only): a
 * partial word match must never pretend that a worker learned another topic.
 */
export function buildKnowledgeSkillTree(input: {
  nodes: readonly KnowledgeSkillNodeInput[];
  edges: readonly KnowledgeSkillTypedEdge[];
  learningCards: readonly KnowledgeLearningCard[];
  nowIso: string;
}): KnowledgeSkillTree {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const neighborsById = new Map<string, Set<string>>();
  const relationTypesById = new Map<string, Set<string>>();
  const ensureNeighbors = (nodeId: string) => {
    let neighbors = neighborsById.get(nodeId);
    if (!neighbors) {
      neighbors = new Set<string>();
      neighborsById.set(nodeId, neighbors);
    }
    return neighbors;
  };
  const ensureRelations = (nodeId: string) => {
    let types = relationTypesById.get(nodeId);
    if (!types) {
      types = new Set<string>();
      relationTypesById.set(nodeId, types);
    }
    return types;
  };

  // Canonical node connections provide a truthful fallback when typed edges
  // have not yet materialized. Unknown endpoints are ignored fail-closed.
  for (const node of input.nodes) {
    for (const targetId of node.connections) {
      if (!nodeById.has(targetId) || targetId === node.id) continue;
      ensureNeighbors(node.id).add(targetId);
      ensureNeighbors(targetId).add(node.id);
    }
  }

  // Typed edges enrich the same local topology. An endpoint outside the active
  // project node set is discarded; it must never surface in this projection.
  for (const edge of input.edges) {
    if (
      !nodeById.has(edge.source) ||
      !nodeById.has(edge.target) ||
      edge.source === edge.target
    )
      continue;
    ensureNeighbors(edge.source).add(edge.target);
    ensureNeighbors(edge.target).add(edge.source);
    if (typeof edge.type === "string" && edge.type.length > 0) {
      ensureRelations(edge.source).add(edge.type);
      ensureRelations(edge.target).add(edge.type);
    }
  }

  const matchingCardsByTopic = new Map<string, KnowledgeLearningCard[]>();
  for (const card of input.learningCards) {
    const topic = normalizeTopic(card.topic);
    if (!topic) continue;
    const cards = matchingCardsByTopic.get(topic) ?? [];
    cards.push(card);
    matchingCardsByTopic.set(topic, cards);
  }

  const connectionCounts = input.nodes.map(
    (node) => ensureNeighbors(node.id).size,
  );
  const highestConnectionCount = Math.max(0, ...connectionCounts);
  const learningStateById = new Map<string, KnowledgeLearningState>();

  for (const node of input.nodes) {
    const cards = matchingCardsByTopic.get(normalizeTopic(node.title)) ?? [];
    if (cards.length === 0) {
      learningStateById.set(node.id, "not_started");
    } else if (cards.some((card) => isReviewDue(card, input.nowIso))) {
      learningStateById.set(node.id, "review_due");
    } else {
      learningStateById.set(node.id, "learning");
    }
  }

  const skills = input.nodes
    .map((node) => {
      const neighbors = ensureNeighbors(node.id);
      const learningState = learningStateById.get(node.id) ?? "not_started";
      const recommended = Array.from(neighbors).some(
        (neighborId) => learningStateById.get(neighborId) === "review_due",
      );
      const connectionCount = neighbors.size;
      return {
        nodeId: node.id,
        title: node.title,
        description: node.description,
        connectionCount,
        relationTypes: Array.from(ensureRelations(node.id)).sort((a, b) =>
          a.localeCompare(b),
        ),
        isHub:
          highestConnectionCount > 0 &&
          connectionCount === highestConnectionCount,
        available: true as const,
        recommended,
        learningState,
      };
    })
    .sort((a, b) =>
      b.connectionCount !== a.connectionCount
        ? b.connectionCount - a.connectionCount
        : a.title.localeCompare(b.title, "es-CL"),
    );

  return { skills, availableCount: skills.length };
}
