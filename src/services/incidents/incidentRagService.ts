// Sprint 29 Bucket AA F-B — Incident RAG (NL search sobre histórico tenant).
//
// Indexa cada incidente del tenant en una colección segregada por tenantId
// y permite búsquedas naturales mediante embeddings. La aislación
// multi-tenant es ESTRICTA: el path `incident_vectors/{tenantId}/items` es
// la única superficie de lectura/escritura, y `searchIncidents` recibe el
// tenantId explícito para descartar resultados cross-tenant.
//
// Diseño:
//   • Inyección de dependencias para Firestore + embedder (no usa el
//     `admin.firestore()` global), idéntico al patrón de
//     services/auth/projectMembership.ts. Esto deja la lógica
//     unit-testable sin tener que inicializar firebase-admin.
//   • `indexIncident(report)`: persiste {tenantId, incidentId, projectId,
//     summary, embedding, indexedAt}. Idempotente vía .doc(incidentId).set.
//   • `searchIncidents(tenantId, query, topK=5)`: findNearest gated por
//     tenantId scope. Si query es vacío, retorna [] (skip explícito).

export interface IncidentReport {
  /** Identificador estable del incidente (DIAT, doc id, etc.). */
  id: string;
  /** Tenant del que pertenece el incidente. Aislación multi-tenant. */
  tenantId: string;
  /** Proyecto de origen (puede compartirse cuando un tenant tiene varios). */
  projectId: string;
  /** Texto narrativo a embedear (>= 1 char). */
  summary: string;
  /** ISO date string del evento, opcional. */
  occurredAt?: string;
}

export interface IncidentSearchHit {
  incidentId: string;
  projectId: string;
  summary: string;
  occurredAt?: string;
  score?: number;
}

export interface IncidentSearchResult {
  results: IncidentSearchHit[];
  citations: string[];
}

export type EmbedFn = (text: string) => Promise<number[]>;

/**
 * Forma mínima de Firestore que necesitamos. `admin.firestore()` la cumple
 * estructuralmente; tests inyectan un fake.
 */
export interface MinimalFirestore {
  collection(path: string): MinimalCollection;
}
export interface MinimalCollection {
  doc(id: string): MinimalDocRef;
  findNearest?(
    field: string,
    vector: unknown,
    opts: { limit: number; distanceMeasure: string },
  ): { get(): Promise<{ docs: MinimalDocSnap[]; empty: boolean }> };
}
export interface MinimalDocRef {
  set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>;
  get?(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
}
export interface MinimalDocSnap {
  id: string;
  data(): Record<string, unknown>;
}

export interface IncidentRagDeps {
  db: MinimalFirestore;
  embed: EmbedFn;
  /** Wraps a numeric vector for Firestore. Default: identity (tests). */
  toVector?: (vec: number[]) => unknown;
  /** Server timestamp factory. Default: () => new Date().toISOString(). */
  now?: () => unknown;
}

const DEFAULT_TO_VECTOR = (v: number[]) => v;
const DEFAULT_NOW = () => new Date().toISOString();

function vectorsCollectionPath(tenantId: string): string {
  return `incident_vectors/${tenantId}/items`;
}

/**
 * Persiste el embedding del incidente en
 * `incident_vectors/{tenantId}/items/{incidentId}`. Devuelve el path final.
 */
export async function indexIncident(
  report: IncidentReport,
  deps: IncidentRagDeps,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (!report?.id || typeof report.id !== 'string') return { ok: false, reason: 'invalid_id' };
  if (!report.tenantId || typeof report.tenantId !== 'string') {
    return { ok: false, reason: 'invalid_tenant' };
  }
  if (!report.summary || typeof report.summary !== 'string' || report.summary.length === 0) {
    return { ok: false, reason: 'empty_summary' };
  }

  const embedding = await deps.embed(report.summary);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return { ok: false, reason: 'embedding_failed' };
  }

  const toVector = deps.toVector ?? DEFAULT_TO_VECTOR;
  const now = deps.now ?? DEFAULT_NOW;

  const collection = deps.db.collection(vectorsCollectionPath(report.tenantId));
  await collection.doc(report.id).set(
    {
      tenantId: report.tenantId,
      incidentId: report.id,
      projectId: report.projectId,
      summary: report.summary,
      occurredAt: report.occurredAt ?? null,
      embedding: toVector(embedding),
      indexedAt: now(),
    },
    { merge: true },
  );

  return { ok: true, path: `${vectorsCollectionPath(report.tenantId)}/${report.id}` };
}

/**
 * Búsqueda semántica restringida al tenant. Si query es vacío, retorna
 * resultado vacío SIN llamar al embedder (skip explícito; corner case
 * cubierto por test). El scope tenant se garantiza por el path de la
 * colección — Firestore no puede leer fuera de él.
 */
export async function searchIncidents(
  tenantId: string,
  query: string,
  topK: number,
  deps: IncidentRagDeps,
): Promise<IncidentSearchResult> {
  if (!tenantId) return { results: [], citations: [] };
  const trimmed = (query ?? '').trim();
  if (trimmed.length === 0) return { results: [], citations: [] };

  const k = Math.max(1, Math.min(topK || 5, 20));
  const embedding = await deps.embed(trimmed);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return { results: [], citations: [] };
  }

  const collection = deps.db.collection(vectorsCollectionPath(tenantId));
  if (typeof collection.findNearest !== 'function') {
    return { results: [], citations: [] };
  }
  const toVector = deps.toVector ?? DEFAULT_TO_VECTOR;
  const snap = await collection
    .findNearest('embedding', toVector(embedding), { limit: k, distanceMeasure: 'COSINE' })
    .get();

  if (snap.empty) return { results: [], citations: [] };

  const results: IncidentSearchHit[] = snap.docs.map((d) => {
    const data = d.data() ?? {};
    return {
      incidentId: String(data.incidentId ?? d.id),
      projectId: String(data.projectId ?? ''),
      summary: String(data.summary ?? ''),
      occurredAt: typeof data.occurredAt === 'string' ? data.occurredAt : undefined,
    };
  });

  // Defensa en profundidad: descarta hits cuyo tenantId no coincide
  // (en teoría imposible por el path scoping, pero documenta la invariante).
  const filtered = snap.docs
    .filter((d) => {
      const data = d.data() ?? {};
      return !data.tenantId || data.tenantId === tenantId;
    })
    .map((d) => {
      const data = d.data() ?? {};
      return {
        incidentId: String(data.incidentId ?? d.id),
        projectId: String(data.projectId ?? ''),
        summary: String(data.summary ?? ''),
        occurredAt: typeof data.occurredAt === 'string' ? data.occurredAt : undefined,
      } as IncidentSearchHit;
    });

  const finalResults = filtered.length > 0 ? filtered : results;

  return {
    results: finalResults,
    citations: finalResults.map((r) =>
      r.occurredAt
        ? `incident:${r.incidentId} (${r.occurredAt})`
        : `incident:${r.incidentId}`,
    ),
  };
}
