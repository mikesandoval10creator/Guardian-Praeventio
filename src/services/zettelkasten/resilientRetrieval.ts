/**
 * Resilient Zettelkasten Retrieval — multi-source fallback chain.
 *
 * Cualquier consulta al grafo (búsqueda por keyword, neighbors-of,
 * sub-graph traversal) puede fallar por:
 *   - Firestore listener interrumpido (red flaky)
 *   - IndexedDB lock o quota (private mode, dispositivo lleno)
 *   - Snapshot pendiente que aún no llega
 *   - Tenant ID temporalmente undefined durante login
 *
 * Este módulo expone un retrieval que SIEMPRE retorna algo útil
 * aunque las fuentes preferidas estén caídas. Pipeline:
 *
 * Source 1 — **In-memory snapshot** (React Context o store).
 *   Más rápido, sin I/O. Falla si el snapshot aún no está hidratado.
 *
 * Source 2 — **IndexedDB cache** (`idb-keyval` o equivalente).
 *   Persiste entre sesiones. Falla si la quota se llenó o el
 *   browser está en modo privado.
 *
 * Source 3 — **Firestore directo** (one-shot read, NO listener).
 *   Más lento pero autoritativo. Falla si no hay red o el tenant
 *   ID es inválido.
 *
 * Source 4 — **Seed bundle estático**. Subset hardcodeado para
 *   bootstrap mínimo. Garantiza que SIEMPRE hay un nodo de
 *   emergencia + normativas básicas, sin red, sin cache, sin nada.
 *
 * Los 4 son inyectados por el caller — el módulo no se acopla a
 * Firebase ni a IndexedDB directamente.
 */

/**
 * Nodo mínimo abstracto. El caller puede pasar cualquier shape que
 * extienda esto; el retrieval no toca campos opcionales.
 */
export interface ResilientNode {
  id: string;
  type: string;
  label?: string;
  /** Texto buscable. */
  searchText?: string;
  tags?: string[];
  /** Edges salientes (ids de nodos destino). */
  outgoing?: string[];
  /** Fuente que entregó este nodo (para audit). */
  __source?: RetrievalSource;
}

export type RetrievalSource =
  | 'memory'
  | 'indexeddb'
  | 'firestore'
  | 'seed';

/**
 * Adapter de fuente. Devuelve `null` si la fuente no puede responder
 * (falta de datos, no hidratada, etc.) o `ResilientNode[]` si tiene
 * algo que aportar. Si lanza, el orchestrator captura y cae al
 * siguiente source.
 */
export type SourceAdapter = (
  query: RetrievalQuery,
) => Promise<ResilientNode[] | null>;

export interface RetrievalSources {
  memory?: SourceAdapter;
  indexeddb?: SourceAdapter;
  firestore?: SourceAdapter;
  seed?: SourceAdapter;
}

export interface RetrievalQuery {
  /** Filtro por tipo de nodo. */
  type?: string;
  /** Keyword para `searchText`. Sin caracter de wildcard — substring. */
  keyword?: string;
  /** Tags requeridos (AND). */
  tags?: string[];
  /** Cap N resultados. */
  limit?: number;
  /** Tenant ID — algunas sources lo necesitan para scope. */
  tenantId?: string;
}

export interface RetrievalResult {
  nodes: ResilientNode[];
  /** Fuente que finalmente respondió. */
  source: RetrievalSource;
  /** Si se cayó a una fuente menos preferida. */
  degraded: boolean;
  /** Errores por fuente (debug + telemetría). */
  sourceErrors: Array<{ source: RetrievalSource; error: string }>;
  /** Latencia total ms. */
  latencyMs: number;
}

const DEFAULT_ORDER: RetrievalSource[] = [
  'memory',
  'indexeddb',
  'firestore',
  'seed',
];

interface SourceTryOpts {
  timeoutMs: number;
}

async function trySource(
  source: RetrievalSource,
  adapter: SourceAdapter | undefined,
  query: RetrievalQuery,
  opts: SourceTryOpts,
): Promise<
  | { nodes: ResilientNode[]; source: RetrievalSource }
  | { error: string; source: RetrievalSource }
> {
  if (!adapter) return { error: 'no adapter', source };
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutP = new Promise<never>((_, rej) => {
      timeoutHandle = setTimeout(
        () => rej(new Error(`${source}: timeout ${opts.timeoutMs}ms`)),
        opts.timeoutMs,
      );
    });
    const result = await Promise.race([adapter(query), timeoutP]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!result) return { error: 'returned null', source };
    if (result.length === 0) return { error: 'empty result', source };
    // Stamp source for audit traceability.
    const stamped = result.map((n) => ({ ...n, __source: source }));
    return { nodes: stamped, source };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return {
      error: err instanceof Error ? err.message : String(err),
      source,
    };
  }
}

export interface RetrievalOptions {
  /** Override el orden de sources. */
  sourceOrder?: RetrievalSource[];
  /** Timeout per source en ms. Default 2000. */
  perSourceTimeoutMs?: number;
  /** Override `Date.now()` para tests. */
  nowMs?: () => number;
  /**
   * Si `true`, retorna los resultados de TODAS las sources que
   * respondieron (no solo la primera), mergeando por id. Útil para
   * casos donde una source tiene metadata fresca y otra tiene los
   * campos completos. Default false.
   */
  mergeAllSources?: boolean;
}

export async function retrieveResilient(
  query: RetrievalQuery,
  sources: RetrievalSources,
  opts: RetrievalOptions = {},
): Promise<RetrievalResult> {
  const now = opts.nowMs ?? Date.now;
  const startedAt = now();
  const order = opts.sourceOrder ?? DEFAULT_ORDER;
  const timeoutMs = opts.perSourceTimeoutMs ?? 2000;
  const sourceErrors: RetrievalResult['sourceErrors'] = [];

  if (!opts.mergeAllSources) {
    // Fast-path: short-circuit on first non-empty source.
    for (const source of order) {
      const adapter = sources[source];
      const r = await trySource(source, adapter, query, { timeoutMs });
      if ('nodes' in r) {
        return {
          nodes: r.nodes,
          source: r.source,
          degraded: r.source !== order[0],
          sourceErrors,
          latencyMs: now() - startedAt,
        };
      }
      sourceErrors.push({ source: r.source, error: r.error });
    }
    // All sources failed.
    return {
      nodes: [],
      source: 'seed',
      degraded: true,
      sourceErrors,
      latencyMs: now() - startedAt,
    };
  }

  // Merge mode — gather from all sources, dedupe by id, prefer earlier
  // (higher-priority) sources for the field values.
  const byId = new Map<string, ResilientNode>();
  let primarySource: RetrievalSource | null = null;
  for (const source of order) {
    const adapter = sources[source];
    const r = await trySource(source, adapter, query, { timeoutMs });
    if ('nodes' in r) {
      if (!primarySource) primarySource = r.source;
      for (const node of r.nodes) {
        if (!byId.has(node.id)) byId.set(node.id, node);
      }
    } else {
      sourceErrors.push({ source: r.source, error: r.error });
    }
  }
  return {
    nodes: Array.from(byId.values()),
    source: primarySource ?? 'seed',
    degraded: primarySource !== order[0],
    sourceErrors,
    latencyMs: now() - startedAt,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Built-in seed bundle — last-resort minimal knowledge graph
// ────────────────────────────────────────────────────────────────────────

/**
 * Subset hardcodeado de nodos esenciales que SIEMPRE están disponibles
 * para que la app pueda responder a emergencias incluso sin cache ni
 * red. Calibrado para Chile (normativa local + números emergencia).
 *
 * El caller monta este array como el adapter `seed` del retrieval —
 * pure-data, sin side effects, importable desde cualquier worker o
 * service worker.
 */
export const SEED_NODES: ReadonlyArray<ResilientNode> = Object.freeze([
  {
    id: 'seed:emergency:samu',
    type: 'EMERGENCY_CONTACT',
    label: 'SAMU (urgencia médica)',
    searchText:
      'samu ambulancia urgencia médica emergencia paramédico hospital herido accidente',
    tags: ['chile', 'emergency', 'medical', '131'],
  },
  {
    id: 'seed:emergency:bomberos',
    type: 'EMERGENCY_CONTACT',
    label: 'Bomberos',
    searchText: 'bomberos incendio fuego rescate emergencia 132',
    tags: ['chile', 'emergency', 'fire', '132'],
  },
  {
    id: 'seed:emergency:carabineros',
    type: 'EMERGENCY_CONTACT',
    label: 'Carabineros',
    searchText: 'carabineros policía robo emergencia 133',
    tags: ['chile', 'emergency', 'police', '133'],
  },
  {
    id: 'seed:normative:ley-16744',
    type: 'NORMATIVE',
    label: 'Ley 16.744 — Accidentes del Trabajo',
    searchText:
      'ley 16744 accidentes trabajo enfermedad profesional mutualidad diat diep',
    tags: ['chile', 'normative', 'core'],
  },
  {
    id: 'seed:normative:ds-594',
    type: 'NORMATIVE',
    label: 'DS 594 — Condiciones Sanitarias y Ambientales',
    searchText:
      'ds 594 condiciones sanitarias ambientales lugar trabajo iluminación ventilación ruido',
    tags: ['chile', 'normative', 'workplace'],
  },
  {
    id: 'seed:normative:ds-132',
    type: 'NORMATIVE',
    label: 'DS 132 — Seguridad Minera',
    searchText: 'ds 132 minería seguridad sernageomin',
    tags: ['chile', 'normative', 'mining'],
  },
  {
    id: 'seed:procedure:sos',
    type: 'PROCEDURE',
    label: 'Activar SOS desde la app',
    searchText:
      'sos botón rojo emergencia activar enviar alerta supervisor ubicación gps',
    tags: ['chile', 'procedure', 'emergency', 'app'],
  },
  {
    id: 'seed:procedure:rcp',
    type: 'PROCEDURE',
    label: 'RCP básico (30 compresiones / 2 ventilaciones)',
    searchText:
      'rcp resucitación cardio pulmonar paro cardiaco compresiones ventilaciones',
    tags: ['chile', 'procedure', 'medical', 'first-aid'],
  },
  {
    id: 'seed:procedure:evacuation',
    type: 'PROCEDURE',
    label: 'Evacuación: dirígete al punto de encuentro',
    searchText:
      'evacuación evacuar punto encuentro alarma sismo incendio emergencia',
    tags: ['chile', 'procedure', 'emergency'],
  },
  {
    id: 'seed:epp:fall',
    type: 'EPP',
    label: 'Arnés + línea de vida para altura',
    searchText:
      'arnés línea vida altura caída trabajo elevación protección anticaídas',
    tags: ['chile', 'epp', 'fall-protection'],
  },
]);

/**
 * Crea un adapter `seed` listo para usar con `retrieveResilient`.
 * Filtra los SEED_NODES por type/keyword/tags. Sin red, sin I/O.
 */
export function makeSeedAdapter(
  seed: ReadonlyArray<ResilientNode> = SEED_NODES,
): SourceAdapter {
  return async (query: RetrievalQuery) => {
    const keyword = query.keyword?.toLowerCase().trim() ?? '';
    const tagsFilter = query.tags ?? [];
    const out: ResilientNode[] = [];
    for (const n of seed) {
      if (query.type && n.type !== query.type) continue;
      if (
        keyword.length > 0 &&
        !(n.searchText ?? '').toLowerCase().includes(keyword) &&
        !(n.label ?? '').toLowerCase().includes(keyword)
      )
        continue;
      if (
        tagsFilter.length > 0 &&
        !tagsFilter.every((t) => (n.tags ?? []).includes(t))
      )
        continue;
      out.push({ ...n });
      if (query.limit && out.length >= query.limit) break;
    }
    if (out.length === 0) return null;
    return out;
  };
}
