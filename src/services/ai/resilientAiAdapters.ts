/**
 * Adapters concretos para conectar el `resilientAiOrchestrator` con
 * el SLM runtime, el Zettelkasten retrieval, el Firestore reader,
 * y Gemini.
 *
 * Cada adapter es un closure que captura sus dependencias y expone
 * la firma `TierAdapter`. El orchestrator los invoca uniformemente.
 *
 * Los adapters de SLM y Gemini hacen dynamic imports — su código real
 * solo se carga cuando el tier se invoca, manteniendo el cold-start
 * chunk liviano.
 */

import {
  detectDomain,
  type AiQuery,
  type TierAdapter,
  type TierAdapterResult,
} from './resilientAiOrchestrator';
import type { LoadedModel } from '../slm/slmRuntime';
import {
  makeSeedAdapter,
  retrieveResilient,
  SEED_NODES,
  type ResilientNode,
  type SourceAdapter,
} from '../zettelkasten/resilientRetrieval';

// ────────────────────────────────────────────────────────────────────────
// Tier 1 — SLM offline
// ────────────────────────────────────────────────────────────────────────

export interface SlmAdapterDeps {
  /** Override del runtime factory (tests). */
  runtimeFactory?: () => Promise<{
    loadModel: (
      id: string,
    ) => Promise<{
      modelId: string;
      session: unknown;
      release?: () => Promise<void>;
    }>;
    infer: (
      model: unknown,
      prompt: string,
    ) => Promise<string>;
    /**
     * Codex P2 fix (PR #250): SLM streaming. Optional para que los
     * mocks de tests no tengan que implementarlo; el adapter chequea
     * `typeof runtime.inferStream === 'function'` antes de invocarlo.
     */
    inferStream?: (
      model: unknown,
      prompt: string,
      opts?: { onToken?: (token: string) => void; signal?: AbortSignal },
    ) => Promise<string>;
    release: (model: unknown) => Promise<void>;
  }>;
  /** Override del id del modelo. Default DEFAULT_MODEL_ID. */
  modelId?: string;
}

/**
 * Tier 1: invoca el SLM local. Carga el runtime + modelo on-demand;
 * cachea el handle entre llamadas para amortizar el costo de
 * `loadModel` (que incluye fetch + integrity + ORT session create).
 */
export function makeSlmTierAdapter(deps: SlmAdapterDeps = {}): TierAdapter {
  let cachedModel: LoadedModel | null = null;
  let cachedModelId: string | null = null;

  return async (query: AiQuery): Promise<TierAdapterResult | null> => {
    const factory =
      deps.runtimeFactory ??
      (async () => {
        const mod = await import('../slm/slmRuntime');
        return mod.createSlmRuntime();
      });
    const targetId = deps.modelId ?? (await getDefaultModelId());

    const runtime = await factory();
    if (!cachedModel || cachedModelId !== targetId) {
      // Inject helper devuelve un shape minimal; el contract real del
      // adapter es LoadedModel. Tratamos el handle returnado como
      // LoadedModel — los tests pueden inyectar mocks ligeros.
      cachedModel = (await runtime.loadModel(targetId)) as unknown as LoadedModel;
      cachedModelId = targetId;
    }

    // Codex P2 fix (PR #250, 2026-05-15): si el caller pasó onStreamToken,
    // usar inferStream para emitir tokens incrementales — antes solo se
    // llamaba runtime.infer() (no-streaming) → la UI mostraba caret vacío
    // hasta el final, sin streaming real.
    let text: string;
    if (query.onStreamToken && typeof runtime.inferStream === 'function') {
      text = await runtime.inferStream(cachedModel, query.prompt, {
        onToken: query.onStreamToken,
      });
    } else {
      text = await runtime.infer(cachedModel, query.prompt);
    }
    if (!text || text.trim().length === 0) return null;

    return {
      text: text.trim(),
      confidence: 0.85, // SLM local: alta confianza, sub-óptimo solo vs Gemini
      citations: [],
    };
  };
}

async function getDefaultModelId(): Promise<string> {
  const { DEFAULT_MODEL_ID } = await import('../slm/registry');
  return DEFAULT_MODEL_ID;
}

// ────────────────────────────────────────────────────────────────────────
// Tier 2 — Zettelkasten retrieval con seed fallback
// ────────────────────────────────────────────────────────────────────────

export interface ZkAdapterDeps {
  memory?: SourceAdapter;
  indexeddb?: SourceAdapter;
  firestore?: SourceAdapter;
  /** Override del seed bundle. Default usa SEED_NODES (Chile). */
  seed?: ReadonlyArray<ResilientNode>;
  /** Cuántos nodos como max para la respuesta. Default 5. */
  maxNodes?: number;
}

/**
 * Tier 2: retrieval determinístico del grafo. NO usa LLM. Construye
 * una respuesta textual citando los nodos encontrados, con un disclaimer
 * explícito de que es información del grafo del tenant.
 *
 * Pure-text rendering — el caller puede pasar un renderer custom para
 * cambiar el estilo (markdown, JSON, etc.).
 */
export function makeZettelkastenTierAdapter(
  deps: ZkAdapterDeps = {},
): TierAdapter {
  const sources = {
    memory: deps.memory,
    indexeddb: deps.indexeddb,
    firestore: deps.firestore,
    seed: makeSeedAdapter(deps.seed ?? SEED_NODES),
  };
  const maxNodes = deps.maxNodes ?? 5;

  return async (query: AiQuery): Promise<TierAdapterResult | null> => {
    // Tokenize: a full sentence rarely matches as a substring of any
    // single node's searchText. Try the most-distinctive content word
    // (longest non-stopword) as the keyword, falling back to the
    // full prompt if no tokenization succeeds.
    const keyword = extractKeyword(query.prompt) ?? query.prompt;

    const r = await retrieveResilient(
      {
        keyword,
        limit: maxNodes,
        tenantId: query.tenantId,
      },
      sources,
      { perSourceTimeoutMs: 1500 },
    );

    if (r.nodes.length === 0) return null;

    // Compose human-readable summary citing the nodes.
    const lines: string[] = [];
    const domain = query.domain ?? detectDomain(query.prompt);
    lines.push(headerForDomain(domain));
    lines.push('');
    for (const n of r.nodes) {
      lines.push(`• ${n.label ?? n.id}`);
      if (n.searchText) {
        // First sentence of the searchText as a quick descriptor.
        const firstSentence = n.searchText.split(/[.!?]/)[0]!.trim();
        if (firstSentence && firstSentence.length < 200) {
          lines.push(`  ${firstSentence}.`);
        }
      }
    }
    lines.push('');
    lines.push(
      r.source === 'seed'
        ? '(Información base del sistema — consulta a tu prevencionista para detalles del proyecto.)'
        : '(Información del grafo de conocimiento de tu proyecto.)',
    );

    return {
      text: lines.join('\n'),
      // Confidence más baja que SLM porque es retrieval, no síntesis;
      // pero más alta que canned porque cita datos reales.
      confidence: r.source === 'seed' ? 0.45 : 0.7,
      citations: r.nodes.map((n) => ({
        kind: 'node' as const,
        ref: n.id,
        label: n.label,
      })),
    };
  };
}

/**
 * Stopwords español frecuentes que NO aportan poder discriminante
 * para retrieval. Lista corta — basta para extraer la keyword
 * más distintiva de una pregunta tipo "cómo activo el sos".
 */
const STOPWORDS_ES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'a', 'y', 'o', 'pero', 'si', 'no',
  'que', 'qué', 'como', 'cómo', 'cuando', 'cuándo', 'donde', 'dónde',
  'cual', 'cuál', 'cuales', 'cuáles', 'quien', 'quién',
  'es', 'son', 'soy', 'está', 'están', 'hay',
  'mi', 'tu', 'su', 'me', 'te', 'se', 'le', 'nos', 'les',
  'por', 'para', 'con', 'sin', 'sobre', 'entre',
  'esto', 'esta', 'este', 'eso', 'esa', 'ese',
  'ya', 'muy', 'más', 'menos', 'tan',
  'puedo', 'puede', 'pueden', 'debo', 'debe', 'deben',
  'activo', 'activa', 'activar',
  'llamo', 'llamar', 'llama',
  'hago', 'hacer',
]);

/**
 * Extrae la "keyword" más distintiva de un prompt en español:
 *   1. Tokeniza por whitespace + punctuation
 *   2. Lowercase
 *   3. Filtra stopwords
 *   4. Devuelve el token más largo (heurística para
 *      "concepto principal de la pregunta")
 *
 * Si después del filtro no queda ningún token, devuelve null y el
 * caller usa el prompt completo (fallback conservador).
 */
export function extractKeyword(prompt: string): string | null {
  const tokens = prompt
    .toLowerCase()
    .replace(/[¿?¡!.,;:()"']/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS_ES.has(t));
  if (tokens.length === 0) return null;
  // Heurística: el token más largo suele ser el más específico.
  tokens.sort((a, b) => b.length - a.length);
  return tokens[0]!;
}

function headerForDomain(domain: string): string {
  switch (domain) {
    case 'emergency':
      return 'En tu grafo de emergencia tengo:';
    case 'epp':
      return 'Sobre EPP, tu grafo registra:';
    case 'medical':
      return 'Información médica disponible:';
    case 'normative':
      return 'Normativa relevante:';
    case 'training':
      return 'Capacitaciones relacionadas:';
    case 'maintenance':
      return 'Sobre mantenimiento:';
    default:
      return 'Encontré estos elementos en tu grafo:';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tier 3 — Firestore knowledge base
// ────────────────────────────────────────────────────────────────────────

export interface FirestoreKnowledgeDeps {
  /**
   * Función del caller que recibe la query y devuelve docs textuales.
   * Típicamente envuelve un getDocs() sobre la colección de FAQs /
   * procedimientos del tenant.
   */
  searchKnowledge: (query: AiQuery) => Promise<
    Array<{
      id: string;
      title: string;
      content: string;
      collection?: string;
    }>
  >;
  /** Función fallback IDB para offline. */
  searchOffline?: (query: AiQuery) => Promise<
    Array<{
      id: string;
      title: string;
      content: string;
    }>
  >;
  /** Cap docs en la respuesta. Default 3. */
  maxDocs?: number;
}

/**
 * Tier 3: busca en la knowledge base de Firestore. Concatena los
 * docs encontrados como respuesta + citation refs.
 *
 * Usa `resilientRead` debajo para que el Firestore call tenga retry +
 * fallback IDB automático.
 */
export function makeFirestoreTierAdapter(
  deps: FirestoreKnowledgeDeps,
): TierAdapter {
  const maxDocs = deps.maxDocs ?? 3;

  return async (query: AiQuery): Promise<TierAdapterResult | null> => {
    const { resilientRead, isUnretriableFirebaseError } = await import(
      '../firestore/resilientReader'
    );

    const r = await resilientRead(() => deps.searchKnowledge(query), {
      perAttemptTimeoutMs: 4000,
      maxAttempts: 2,
      isUnretriable: isUnretriableFirebaseError,
      fallback: deps.searchOffline
        ? () => deps.searchOffline!(query)
        : undefined,
    }).catch(() => null);

    if (!r || !r.value || r.value.length === 0) return null;

    const docs = r.value.slice(0, maxDocs);
    const lines: string[] = [];
    for (const doc of docs) {
      lines.push(`**${doc.title}**`);
      lines.push(doc.content);
      lines.push('');
    }
    if (r.fromFallback) {
      lines.push('(Información del cache local — puede estar desactualizada.)');
    } else {
      lines.push('(Información del knowledge base del proyecto.)');
    }

    return {
      text: lines.join('\n').trim(),
      confidence: r.fromFallback ? 0.5 : 0.65,
      citations: docs.map((d) => ({
        kind: 'procedure' as const,
        ref: d.id,
        label: d.title,
      })),
    };
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tier 4 — Gemini server
// ────────────────────────────────────────────────────────────────────────

export interface GeminiAdapterDeps {
  /**
   * Función del caller que llama al endpoint Gemini server-side. NO
   * usamos el SDK directamente aquí para que el bundle de cold-start
   * no arrastre `@google/genai`.
   */
  callGemini: (prompt: string, context?: Record<string, unknown>) => Promise<{
    text: string;
    citations?: Array<{ uri: string; title?: string }>;
  }>;
}

/**
 * Tier 4: invoca Gemini server-side. Solo cae aquí si SLM y los
 * tiers locales (ZK, Firestore) fallaron — Gemini consume cuota y
 * tiene latencia, así que es última opción before canned.
 */
export function makeGeminiTierAdapter(deps: GeminiAdapterDeps): TierAdapter {
  return async (query: AiQuery): Promise<TierAdapterResult | null> => {
    const result = await deps.callGemini(query.prompt, query.context);
    if (!result?.text || result.text.trim().length === 0) return null;
    return {
      text: result.text.trim(),
      confidence: 0.9,
      citations: (result.citations ?? []).map((c) => ({
        kind: 'faq' as const,
        ref: c.uri,
        label: c.title,
      })),
    };
  };
}
