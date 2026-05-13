// Praeventio Guard — Sprint 47 Fase C.10: RAG sobre Zettelkasten + citation policy.
//
// Cierra: Plan Fase C.10 "Contextual Assistant — RAG sobre el Zettelkasten
//         con citation policy obligatoria".
//
// Diferencia con `contextualAssistant.ts` (Sprint 39):
//   - Sprint 39 usa `ZkGraphAdapter` propio (interfaz custom, formato
//     de citas `(zk:id)`).
//   - Sprint 47 (este módulo) reusa el `ZkReadAdapter` del MCP server
//     (D.11) para uniformar el acceso al grafo desde IA y MCP. Formato
//     de citas canónico `[nodeId]` (más compacto, fácil de detectar via
//     regex en el validator).
//
// Motor PURO: no invoca LLM. Su contrato es:
//   - Input: query libre del usuario + tenant/proyecto.
//   - Output: contexto compacto + grounding set + system instructions
//     listas para inyectar como system prompt en Gemini/Vertex.
//
// La validación de la respuesta del LLM se hace en
// `zkRagResponseValidator.ts`.

import type { ZkReadAdapter, ZkNodeRef } from '../mcp/zettelkastenServer.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ZkRagQuery {
  /** Pregunta libre del usuario. */
  question: string;
  /** Tenant id obligatorio para enforce multi-tenant isolation. */
  tenantId: string;
  /** UID del nodo de contexto (worker, tarea, etc.) opcional. */
  contextUid?: string;
  /** Proyecto id para acotar el sub-grafo. */
  contextProjectId?: string;
  /** Tipos de nodos a buscar. Default lista canónica de seguridad. */
  relevantTypes?: ReadonlyArray<string>;
  /** Profundidad máxima de la expansión BFS desde nodos seed. Cap 2. */
  maxDepth?: number;
  /** Máximo de nodos a incluir en contexto. Cap 20. */
  maxNodes?: number;
}

export interface ZkRagContextNode {
  id: string;
  type: string;
  title: string;
  description: string;
  severity?: string;
}

export interface ZkRagContext {
  /** Nodos relevantes que estarán disponibles para el LLM. */
  relevantNodes: ZkRagContextNode[];
  /** Set de ids con los que el LLM puede citar. Validator cross-checks contra esto. */
  groundingNodeIds: Set<string>;
  /** Texto compacto del contexto, listo para inyectar como system prompt. */
  promptContext: string;
  /** Instrucciones canónicas (citation policy) para el system prompt. */
  systemInstructions: string;
  /** Si no se encontró ningún nodo relevante. */
  isEmpty: boolean;
  /** Keywords extraídas de la query (para debug + telemetría). */
  keywords: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Canonical system instructions (citation policy)
// ────────────────────────────────────────────────────────────────────────

export const ZK_RAG_SYSTEM_INSTRUCTIONS = `
Eres el asistente contextual de Praeventio Guard. Reglas estrictas para responder:

  1. RESPONDE SOLO con información de los nodos del Zettelkasten provistos.
     NUNCA inventes datos, conexiones, severidades o normativas que no
     aparezcan en los nodos.

  2. CITA los ids de los nodos en formato [nodeId] al final de cada
     afirmación derivada del grafo. Ejemplo: "La cuadrilla NE requiere
     casco clase E [a1b2c3d4e5f6a7b8]."

  3. Si no hay información suficiente en los nodos provistos, responde
     literalmente: "no tengo info en el grafo del tenant".

  4. No emitas diagnóstico médico, recetas, ni asesoría legal vinculante.

  5. No incluyas datos personales (RUT, email, teléfono) en la respuesta
     aunque aparezcan en los nodos — refiere por id de nodo si necesario.
` as const;

// ────────────────────────────────────────────────────────────────────────
// Defaults
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
  'Proyecto',
  'Cuadrilla',
];

const MAX_DEPTH_CAP = 2;
const MAX_NODES_CAP = 20;
const MAX_DESC_CHARS = 200;

// ────────────────────────────────────────────────────────────────────────
// Keyword extraction (deterministic — same scheme as Sprint 39 helper).
// ────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'por', 'para', 'con', 'sin', 'sobre', 'que', 'cual', 'cuales',
  'cuando', 'donde', 'como', 'y', 'o', 'u', 'pero', 'si', 'no', 'es', 'son',
  'esta', 'estan', 'estás', 'están', 'fue', 'fueron', 'ha', 'han', 'hay',
  'hace', 'hacer', 'tiene', 'tienen', 'tenia', 'tenía', 'que', 'quien',
  'quienes', 'qué', 'quién', 'quiénes', 'cuál', 'cuáles', 'cuándo',
  'dónde', 'cómo',
]);

export function extractRagKeywords(question: string, max = 8): string[] {
  const tokens = question
    .toLowerCase()
    .normalize('NFD')
    // strip combining diacritics (accents)
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Core builder
// ────────────────────────────────────────────────────────────────────────

function toContextNode(n: ZkNodeRef): ZkRagContextNode {
  const desc =
    n.description.length > MAX_DESC_CHARS
      ? n.description.slice(0, MAX_DESC_CHARS) + '…'
      : n.description;
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    description: desc,
    severity: n.severity,
  };
}

function nodeLine(n: ZkRagContextNode): string {
  const sev = n.severity ? ` (${n.severity})` : '';
  return `[${n.id}] ${n.type}${sev} · ${n.title} · ${n.description}`;
}

function scoreNode(n: ZkNodeRef, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const blob = `${n.title} ${n.description} ${n.tags.join(' ')}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  let score = 0;
  for (const k of keywords) {
    if (blob.includes(k)) score += 1;
    // Bonus if hit appears in title.
    if (n.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(k)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Construye el contexto RAG desde el Zettelkasten.
 *
 * Pipeline:
 *   1. Extrae keywords de la query.
 *   2. Lista candidatos via `adapter.listNodes` filtrado por proyecto + tipos.
 *   3. Filtra por keyword match (al menos 1 hit) y rankea por score.
 *   4. Toma top-K como seed.
 *   5. Si hay `contextUid`, lo añade como seed obligatorio.
 *   6. Expande BFS limitado (`adapter.expandSubgraph`) desde seeds.
 *   7. Dedupe + cap maxNodes.
 *   8. Empaqueta como texto compacto + system instructions.
 */
export async function buildZkRagContext(
  query: ZkRagQuery,
  adapter: ZkReadAdapter,
): Promise<ZkRagContext> {
  if (!query.tenantId || query.tenantId.length === 0) {
    return emptyContext(query, [], 'tenantId requerido');
  }

  const keywords = extractRagKeywords(query.question);
  const relevantTypes = query.relevantTypes ?? DEFAULT_RELEVANT_TYPES;
  const maxDepth = Math.min(MAX_DEPTH_CAP, Math.max(1, query.maxDepth ?? 2));
  const maxNodes = Math.min(MAX_NODES_CAP, Math.max(1, query.maxNodes ?? 12));

  if (keywords.length === 0 && !query.contextUid) {
    return emptyContext(query, []);
  }

  // 1) Discover candidates across allowed types.
  const candidates: ZkNodeRef[] = [];
  const seenIds = new Set<string>();
  for (const t of relevantTypes) {
    let chunk: ZkNodeRef[];
    try {
      chunk = await adapter.listNodes(query.tenantId, {
        projectId: query.contextProjectId,
        type: t,
        limit: 50,
      });
    } catch {
      // Multi-tenant isolation: if adapter throws (e.g. tenant mismatch)
      // we return empty rather than leak across tenants.
      return emptyContext(query, keywords);
    }
    for (const n of chunk) {
      if (seenIds.has(n.id)) continue;
      seenIds.add(n.id);
      candidates.push(n);
    }
  }

  // 2) Filter + rank by keyword score.
  const scored = candidates
    .map((n) => ({ n, score: scoreNode(n, keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // 3) Seed set: top-K by score + optional contextUid.
  const seedTarget = Math.min(maxNodes, 6);
  const seeds = new Map<string, ZkNodeRef>();
  for (const { n } of scored.slice(0, seedTarget)) {
    seeds.set(n.id, n);
  }
  if (query.contextUid) {
    try {
      const seedNode = await adapter.getNode(query.tenantId, query.contextUid);
      if (seedNode) seeds.set(seedNode.id, seedNode);
    } catch {
      // Same isolation guard.
      return emptyContext(query, keywords);
    }
  }

  // 4) BFS expand from each seed (depth-limited).
  const collected = new Map<string, ZkNodeRef>();
  for (const [, seed] of seeds) {
    collected.set(seed.id, seed);
    if (collected.size >= maxNodes) break;
    try {
      const sub = await adapter.expandSubgraph(query.tenantId, seed.id, maxDepth);
      for (const n of sub) {
        if (collected.has(n.id)) continue;
        collected.set(n.id, n);
        if (collected.size >= maxNodes) break;
      }
    } catch {
      // Skip this seed's expansion; continue with the others.
      continue;
    }
  }

  if (collected.size === 0) {
    return emptyContext(query, keywords);
  }

  // 5) Materialize.
  const relevantNodes: ZkRagContextNode[] = [];
  const groundingNodeIds = new Set<string>();
  for (const [, n] of collected) {
    if (relevantNodes.length >= maxNodes) break;
    relevantNodes.push(toContextNode(n));
    groundingNodeIds.add(n.id);
  }

  const promptContext = renderPromptContext(query, relevantNodes, keywords);
  return {
    relevantNodes,
    groundingNodeIds,
    promptContext,
    systemInstructions: ZK_RAG_SYSTEM_INSTRUCTIONS.trim(),
    isEmpty: false,
    keywords,
  };
}

function renderPromptContext(
  query: ZkRagQuery,
  nodes: ZkRagContextNode[],
  keywords: string[],
): string {
  const header = ZK_RAG_SYSTEM_INSTRUCTIONS.trim();
  const meta =
    `[TENANT: ${query.tenantId}` +
    (query.contextProjectId ? ` | PROYECTO: ${query.contextProjectId}` : '') +
    (query.contextUid ? ` | UID: ${query.contextUid}` : '') +
    `]`;
  const kwLine = keywords.length > 0 ? `[KEYWORDS: ${keywords.join(', ')}]` : '[KEYWORDS: -]';
  const lines = nodes.map(nodeLine).join('\n');
  return `${header}\n\n${meta}\n${kwLine}\n\n[NODOS RELEVANTES (${nodes.length})]\n${lines}`;
}

function emptyContext(
  query: ZkRagQuery,
  keywords: string[],
  reason?: string,
): ZkRagContext {
  const header = ZK_RAG_SYSTEM_INSTRUCTIONS.trim();
  const meta =
    `[TENANT: ${query.tenantId ?? '-'}` +
    (query.contextProjectId ? ` | PROYECTO: ${query.contextProjectId}` : '') +
    `]`;
  const note = reason
    ? `[SIN CONTEXTO — ${reason}]`
    : `[SIN CONTEXTO — no se encontraron nodos relevantes en el grafo del tenant]`;
  return {
    relevantNodes: [],
    groundingNodeIds: new Set<string>(),
    promptContext: `${header}\n\n${meta}\n\n${note}\n\nResponde literalmente: "no tengo info en el grafo del tenant".`,
    systemInstructions: header,
    isEmpty: true,
    keywords,
  };
}
