/**
 * Factory que construye los `OrchestratorAdapters` para el asesor IA
 * a partir del entorno real (contexts React + Firebase + Gemini server
 * endpoint). Pensado para usarse desde un componente cliente que
 * tenga acceso a los hooks de contexto.
 *
 * Cada adapter:
 *   - Es lazy en imports (no arrastra deps al cold-start)
 *   - Maneja errores localmente devolviendo `null` para que el
 *     orchestrator caiga al siguiente tier
 *   - Respeta los timeouts del orchestrator (default 8s)
 *
 * Diseñado para ser puro: el caller pasa las dependencias, el factory
 * devuelve adapters. Esto facilita testing — un test puede pasar
 * mocks puros sin tocar Firebase ni el SLM real.
 */

import type {
  OrchestratorAdapters,
  TierAdapter,
} from './resilientAiOrchestrator';
import {
  makeFirestoreTierAdapter,
  makeGeminiTierAdapter,
  makeSlmTierAdapter,
  makeZettelkastenTierAdapter,
} from './resilientAiAdapters';
import {
  makeSeedAdapter,
  SEED_NODES,
  type ResilientNode,
  type SourceAdapter,
} from '../zettelkasten/resilientRetrieval';

export interface AsesorContext {
  /** Nodos del Zettelkasten en memoria (React Context). */
  zkNodes?: ReadonlyArray<{
    id: string;
    type: string;
    title?: string;
    description?: string;
    tags?: string[];
    connections?: string[];
  }>;
  /**
   * Función que busca FAQ/procedimientos en Firestore. El caller la
   * implementa con su instancia firestore + colección de su tenant.
   * Devuelve `null` para indicar "no implementado".
   */
  searchFirestoreKnowledge?: (
    keyword: string,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      content: string;
    }>
  >;
  /**
   * Función IDB para offline fallback de knowledge base.
   */
  searchOfflineKnowledge?: (
    keyword: string,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      content: string;
    }>
  >;
  /**
   * Endpoint server-side Gemini. El caller decide el path
   * (`/api/ai/gemini`) y headers (auth token).
   */
  callGeminiServer?: (
    prompt: string,
    context?: Record<string, unknown>,
  ) => Promise<{
    text: string;
    citations?: Array<{ uri: string; title?: string }>;
  }>;
}

/**
 * Construye los adapters tier-by-tier. Cualquier dependencia faltante
 * se traduce en "tier no disponible" — el orchestrator cae al siguiente
 * limpiamente.
 *
 * Por contrato, SLM siempre está presente (usa el runtime importado
 * dinámicamente). El seed adapter del Zettelkasten también está
 * SIEMPRE presente como red de seguridad — devuelve los nodos chilenos
 * básicos (SAMU, normativas, procedimientos) aunque memory/IDB/
 * firestore estén caídos.
 */
export function buildAsesorAdapters(ctx: AsesorContext): OrchestratorAdapters {
  const adapters: OrchestratorAdapters = {};

  // Tier 1: SLM offline (siempre disponible — dynamic import).
  adapters.slm = makeSlmTierAdapter();

  // Tier 2: Zettelkasten con memory adapter + seed fallback.
  const memorySource = ctx.zkNodes
    ? makeMemoryZkSource(ctx.zkNodes)
    : undefined;
  adapters.zettelkasten = makeZettelkastenTierAdapter({
    memory: memorySource,
    // El seed (SEED_NODES chileno) se usa por default si no hay nada más.
  });

  // Tier 3: Firestore knowledge base (si caller lo provee).
  if (ctx.searchFirestoreKnowledge) {
    adapters.firestore = makeFirestoreTierAdapter({
      searchKnowledge: async (q) =>
        ctx.searchFirestoreKnowledge!(q.prompt),
      searchOffline: ctx.searchOfflineKnowledge
        ? async (q) => ctx.searchOfflineKnowledge!(q.prompt)
        : undefined,
    });
  }

  // Tier 4: Gemini server (si caller lo provee).
  if (ctx.callGeminiServer) {
    adapters.gemini = makeGeminiTierAdapter({
      callGemini: ctx.callGeminiServer,
    });
  }

  return adapters;
}

/**
 * Convierte una lista de nodos del contexto React en un
 * `SourceAdapter` consumible por el ZK retrieval. Substring matching
 * sobre title + description + tags (case-insensitive).
 */
function makeMemoryZkSource(
  nodes: AsesorContext['zkNodes'],
): SourceAdapter {
  const adapter = makeSeedAdapter(
    (nodes ?? []).map(
      (n): ResilientNode => ({
        id: n.id,
        type: n.type,
        label: n.title ?? n.id,
        searchText: [n.title ?? '', n.description ?? '', ...(n.tags ?? [])]
          .filter(Boolean)
          .join(' '),
        tags: n.tags,
        outgoing: n.connections,
      }),
    ),
  );
  return adapter;
}

/**
 * Conveniencia: combina los seed nodes chilenos con los nodos
 * provistos en memoria. Útil cuando el tenant tiene poco contenido
 * propio y queremos que la respuesta también pueda venir del seed
 * de emergencias. Order matters: nodos del tenant primero (más
 * específicos), seed como fallback.
 */
export function buildHybridSeedNodes(
  tenantNodes: ResilientNode[],
): ReadonlyArray<ResilientNode> {
  return [...tenantNodes, ...SEED_NODES];
}

/**
 * Helper para tests: build un OrchestratorAdapters con solo el seed
 * como tier (todo lo demás `null`). Garantiza que las respuestas
 * vengan del seed bundle de emergencias chilenas.
 */
export function buildSeedOnlyAdapters(): OrchestratorAdapters {
  const seedOnly: TierAdapter = async (query) => {
    const seedAdapter = makeZettelkastenTierAdapter({});
    return seedAdapter(query);
  };
  return { zettelkasten: seedOnly };
}
