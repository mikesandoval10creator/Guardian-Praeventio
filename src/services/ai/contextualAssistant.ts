// Praeventio Guard — Sprint 39 Fase C.10: Asistente contextual con citas Zettelkasten.
//
// Cierra: Plan Fase C.10 "Asistente contextual con citas del Zettelkasten
//         (Gemini RAG sobre grafo)".
//
// Cuando el usuario pregunta a AsesorChat ("¿qué EPP necesita este
// trabajador para esta tarea?"), este builder:
//
//   1. Recorre el grafo: worker → assigned_to → task → has_risk →
//      risk → requires → epp
//   2. Cosecha los nodos relevantes (BFS limitado por depth)
//   3. Construye un contexto-string con citation IDs (zk:abc123) para
//      pasarlo como `system context` a Gemini
//   4. Enforza la citation policy: "responde SOLO con info de los
//      nodos provistos, cita los IDs entre paréntesis"
//   5. Si la query no devuelve nodos relevantes → responde
//      determinísticamente "no tengo info en el grafo de tu tenant"
//
// 100% determinístico — sin LLM en este motor. El LLM consume el
// output como prompt suplementario.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ZkContextNode {
  id: string;
  type: string;
  title: string;
  description: string;
  connections: string[];
  severity?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextQuery {
  /** Pregunta libre del usuario. */
  query: string;
  /** UID del trabajador / proyecto contexto, si aplica. */
  currentUid?: string;
  projectId: string;
  tenantId?: string;
  /** Tipos de nodos a buscar (filtrado pre-BFS). Default: ['Trabajador','Tarea','Riesgo','EPP','Capacitación','Control']. */
  relevantTypes?: string[];
  /** Profundidad máxima BFS. Default 2 (cap 3). */
  maxDepth?: number;
  /** Máximo de nodos a incluir en contexto (cap 25). */
  maxNodes?: number;
}

export interface AssembledContext {
  /** Texto formateado para inyectar como system prompt. */
  contextString: string;
  /** Nodos seleccionados. */
  selectedNodes: ZkContextNode[];
  /** Citas en formato (zk:id) listas para que el LLM cite. */
  citations: string[];
  /** Si NO se encontraron nodos relevantes. */
  isEmpty: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Citation policy — política CRÍTICA
// ────────────────────────────────────────────────────────────────────────

export const CONTEXTUAL_ASSISTANT_POLICY = `
Eres el asistente contextual de Praeventio Guard. Reglas estrictas:

  1. RESPONDE ÚNICAMENTE con información presente en los nodos del
     Zettelkasten provistos abajo. NUNCA inventes datos, conexiones
     ni severidades que no aparezcan ahí.

  2. CITA el id del nodo entre paréntesis al final de cada afirmación
     derivada del grafo. Formato: "(zk:abc123)".

  3. Si la query del usuario NO encuentra nodos relevantes, responde
     literalmente: "No tengo información en el grafo de tu tenant
     para responder esa pregunta."

  4. NO recomiendes acciones operacionales no respaldadas por un
     nodo de tipo 'Control' o 'Normativa' citable.

  5. Si la pregunta involucra normativa, cita la referencia legal
     (DS, Ley) que aparece en el nodo, no inventes artículos.
` as const;

// ────────────────────────────────────────────────────────────────────────
// Adapter — caller inyecta el read-only grafo
// ────────────────────────────────────────────────────────────────────────

export interface ZkGraphAdapter {
  /** Busca nodos por keywords + filtros tenant/proyecto/tipo. */
  searchByKeywords(
    keywords: string[],
    filter: { projectId: string; tenantId?: string; types?: string[]; limit: number },
  ): Promise<ZkContextNode[]>;
  /** Obtiene nodos conectados a un set de ids dado. */
  expandConnected(
    ids: string[],
    filter: { projectId: string; tenantId?: string; depth: number },
  ): Promise<ZkContextNode[]>;
}

// ────────────────────────────────────────────────────────────────────────
// Keyword extraction (deterministic — no stemming/embedding)
// ────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'por', 'para', 'con', 'sin', 'sobre', 'que', 'cual', 'cuales',
  'cuando', 'donde', 'como', 'y', 'o', 'u', 'pero', 'si', 'no', 'es', 'son',
  'está', 'están', 'fue', 'fueron', 'ha', 'han', 'hay', 'hace', 'hacer',
  'tiene', 'tienen', 'tenía', 'qué', 'quién', 'quiénes',
]);

export function extractKeywords(query: string, maxKeywords = 8): string[] {
  const tokens = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  // Dedupe preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxKeywords) break;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Context assembly
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_RELEVANT_TYPES = [
  'Trabajador',
  'Tarea',
  'Riesgo',
  'EPP',
  'Capacitación',
  'Control',
  'Normativa',
  'Hallazgo',
  'Incidente',
];

function nodeAsContextLine(node: ZkContextNode): string {
  const sev = node.severity ? ` [${node.severity}]` : '';
  const desc = node.description.length > 220
    ? node.description.slice(0, 220) + '…'
    : node.description;
  return `- (zk:${node.id}) ${node.type}${sev}: ${node.title} — ${desc}`;
}

export async function buildContextFromGraph(
  query: ContextQuery,
  adapter: ZkGraphAdapter,
): Promise<AssembledContext> {
  const keywords = extractKeywords(query.query);
  const relevantTypes = query.relevantTypes ?? DEFAULT_RELEVANT_TYPES;
  const maxNodes = Math.min(25, Math.max(1, query.maxNodes ?? 12));
  const maxDepth = Math.min(3, Math.max(1, query.maxDepth ?? 2));

  if (keywords.length === 0) {
    return emptyContext();
  }

  // 1) Search by keywords first
  const initial = await adapter.searchByKeywords(keywords, {
    projectId: query.projectId,
    tenantId: query.tenantId,
    types: relevantTypes,
    limit: Math.min(maxNodes, 10),
  });

  // 2) Expand connections from initial set
  let expanded: ZkContextNode[] = [];
  if (initial.length > 0 && maxDepth > 0) {
    expanded = await adapter.expandConnected(
      initial.map((n) => n.id),
      { projectId: query.projectId, tenantId: query.tenantId, depth: maxDepth },
    );
  }

  // 3) Merge + dedupe by id
  const byId = new Map<string, ZkContextNode>();
  for (const n of initial) byId.set(n.id, n);
  for (const n of expanded) {
    if (!byId.has(n.id) && byId.size < maxNodes) byId.set(n.id, n);
  }

  const selected = [...byId.values()].slice(0, maxNodes);

  if (selected.length === 0) {
    return emptyContext();
  }

  const contextString = buildContextString(query, selected);
  return {
    contextString,
    selectedNodes: selected,
    citations: selected.map((n) => `(zk:${n.id})`),
    isEmpty: false,
  };
}

function emptyContext(): AssembledContext {
  return {
    contextString: `${CONTEXTUAL_ASSISTANT_POLICY}\n\n[NO NODES FOUND]\n\nResponde literalmente: "No tengo información en el grafo de tu tenant para responder esa pregunta."`,
    selectedNodes: [],
    citations: [],
    isEmpty: true,
  };
}

function buildContextString(query: ContextQuery, nodes: ZkContextNode[]): string {
  const header = CONTEXTUAL_ASSISTANT_POLICY.trim();
  const meta = `[CONTEXTO TENANT: ${query.tenantId ?? 'default'} | PROYECTO: ${query.projectId}]`;
  const lines = nodes.map(nodeAsContextLine).join('\n');
  return `${header}\n\n${meta}\n\n[NODOS RELEVANTES (${nodes.length})]\n${lines}`;
}
