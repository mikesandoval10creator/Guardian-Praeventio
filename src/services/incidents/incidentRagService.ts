// Sprint 29 Bucket AA F-B — Incident RAG (NL search sobre histórico tenant).
//
// Sprint 33 wire W4 (2026-05-17) — `reportIncident(uid, payload)` cierra el
// TODO original: ahora SÍ existe un punto canónico que persiste un incidente
// con el uid del reporter, dispara `awardXp('near_miss_reported', 10)` para
// near-misses e `awardXp('incident_post_mortem_completed', 50)` cuando el
// post-mortem se cierra en el mismo flujo, e indexa el resumen vía
// `indexIncident()` para que `searchIncidents()` lo encuentre. Fire-and-forget
// del XP: si gamificación falla, el incidente sigue persistido.
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
//   • `reportIncident(uid, payload)`: persiste el incidente bajo
//     `tenants/{tenantId}/projects/{projectId}/incidents/{incidentId}`,
//     auto-genera incidentId si el caller no lo aporta, ejecuta
//     `indexIncident()` para que el RAG lo vea, y emite XP positivo según
//     tipo (near_miss / incident / post_mortem). Por las directivas del
//     producto (gamificación SOLO positiva), no se castiga al reporter
//     bajo ninguna circunstancia.

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

// ─── reportIncident — Sprint 33 wire W4 ─────────────────────────────────────
//
// Punto canónico para registrar un incidente. Persiste en
// `tenants/{tenantId}/projects/{projectId}/incidents/{incidentId}`,
// dispara XP positivo según tipo, y delega a `indexIncident()` para que el
// resumen quede inmediatamente buscable vía RAG.
//
// Idempotencia: el caller puede pasar un `id` propio (recomendado para
// flujos offline-first / queue replay) — si no, generamos uno con shape
// `inc_{ts}_{rand6}` similar al patrón de commute.ts. La capa HTTP usa el
// header `Idempotency-Key` de Stripe-pattern (middleware idempotencyKey)
// para deduplicar el endpoint completo; este `id` interno garantiza que
// dos llamadas con MISMO id sobreescriban en lugar de duplicar (set merge
// indirecto vía `indexIncident`, doc.set en el principal).

/** Tipo de evento reportado. Drive del XP que se emite. */
export type IncidentEventType = 'near_miss' | 'incident' | 'post_mortem';

/** Severidad subjetiva del reporter (no usada para gating XP — positivo-only). */
export type IncidentSeverity = 'low' | 'med' | 'high' | 'critical';

/**
 * Forma del payload aceptada por `reportIncident`. Espejo del Zod schema
 * en el handler HTTP (`routes/incidents.ts`); mantener sincronizados.
 */
export interface ReportIncidentInput {
  /** tenantId que será dueño del incidente. Resuelto en el handler desde el project doc. */
  tenantId: string;
  /** projectId al que pertenece el incidente. */
  projectId: string;
  /** Opcional — si se omite, se autogenera. */
  id?: string;
  /** near_miss | incident | post_mortem. */
  incidentType: IncidentEventType;
  /** Severidad declarada por el reporter. */
  severity: IncidentSeverity;
  /** Texto narrativo (>= 1 char). Se embedea para búsqueda RAG. */
  description: string;
  /** Ubicación textual (opcional — geolocalización va aparte si llega). */
  location?: string;
  /** Lista de uids/nombres de testigos. */
  witnesses?: string[];
  /** ISO-8601 cuándo ocurrió el evento. Default: now. */
  ts?: string;
}

export interface ReportIncidentOk {
  ok: true;
  /** Path final del doc en Firestore. */
  path: string;
  incidentId: string;
  /** XP emitido al reporter (0 si no aplicó por tipo o si gamificación falló). */
  xpAwarded: number;
  /** True si el embedding se indexó OK; false si falló (no rompe el report). */
  indexed: boolean;
}

export interface ReportIncidentErr {
  ok: false;
  reason: string;
}

/** Dependencias del reportIncident: Firestore + embedder + opcional awardXp. */
export interface ReportIncidentDeps extends IncidentRagDeps {
  /**
   * Inyección opcional del awardXp. En producción se pasa el de
   * `services/gamification/positiveXp.ts`; en tests se inyecta un spy.
   * Cualquier excepción se swallows — gamificación NUNCA rompe el report.
   */
  awardXp?: (
    reason: 'near_miss_reported' | 'incident_post_mortem_completed',
    amount: number,
    context?: Record<string, unknown>,
  ) => unknown;
}

function generateIncidentId(now: () => unknown): string {
  // Match commute.ts shape: prefix + ts + 6 random b36 chars.
  const ts =
    typeof now === 'function'
      ? typeof now() === 'string'
        ? Date.now()
        : Date.now()
      : Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `inc_${ts}_${rand}`;
}

/**
 * Persiste un incidente con uid del reporter, dispara XP positivo, e indexa
 * el embedding. NUNCA penaliza al reporter (directiva del producto: solo
 * gamificación positiva — reportar es siempre un acto deseable).
 *
 * Path: `tenants/{tenantId}/projects/{projectId}/incidents/{incidentId}`.
 *
 * XP:
 *   • `near_miss`     → awardXp('near_miss_reported', 10, ctx)
 *   • `incident`      → awardXp('near_miss_reported', 10, ctx)  (mismo reason — el reporter no se castiga)
 *   • `post_mortem`   → awardXp('incident_post_mortem_completed', 50, ctx)
 *
 * Errores parciales:
 *   • Si el embedding falla, el incidente igual se persiste (campo
 *     `indexed: false` en el resultado). El RAG no lo encontrará pero el
 *     audit/Firestore sí.
 *   • Si awardXp throws, se swallows y `xpAwarded: 0`. El reporte no falla.
 */
export async function reportIncident(
  uid: string,
  payload: ReportIncidentInput,
  deps: ReportIncidentDeps,
): Promise<ReportIncidentOk | ReportIncidentErr> {
  if (!uid || typeof uid !== 'string') return { ok: false, reason: 'invalid_uid' };
  if (!payload?.tenantId || typeof payload.tenantId !== 'string') {
    return { ok: false, reason: 'invalid_tenant' };
  }
  if (!payload.projectId || typeof payload.projectId !== 'string') {
    return { ok: false, reason: 'invalid_project' };
  }
  if (
    payload.incidentType !== 'near_miss' &&
    payload.incidentType !== 'incident' &&
    payload.incidentType !== 'post_mortem'
  ) {
    return { ok: false, reason: 'invalid_incident_type' };
  }
  if (
    payload.severity !== 'low' &&
    payload.severity !== 'med' &&
    payload.severity !== 'high' &&
    payload.severity !== 'critical'
  ) {
    return { ok: false, reason: 'invalid_severity' };
  }
  if (
    !payload.description ||
    typeof payload.description !== 'string' ||
    payload.description.trim().length === 0
  ) {
    return { ok: false, reason: 'empty_description' };
  }

  const now = deps.now ?? DEFAULT_NOW;
  const incidentId = payload.id?.trim() || generateIncidentId(now);
  const occurredAt = payload.ts ?? (typeof now() === 'string' ? (now() as string) : new Date().toISOString());

  // ── 1. Persist al doc principal bajo tenants/{tid}/projects/{pid}/incidents/{id}
  const incidentPath = `tenants/${payload.tenantId}/projects/${payload.projectId}/incidents`;
  const docRef = deps.db.collection(incidentPath).doc(incidentId);
  await docRef.set(
    {
      id: incidentId,
      tenantId: payload.tenantId,
      projectId: payload.projectId,
      reporterUid: uid,
      incidentType: payload.incidentType,
      severity: payload.severity,
      description: payload.description.trim(),
      location: payload.location ?? null,
      witnesses: Array.isArray(payload.witnesses) ? payload.witnesses : [],
      ts: occurredAt,
      createdAt: now(),
    },
    { merge: true },
  );

  // ── 2. Index para RAG (best-effort)
  let indexed = false;
  try {
    const idxResult = await indexIncident(
      {
        id: incidentId,
        tenantId: payload.tenantId,
        projectId: payload.projectId,
        summary: payload.description.trim(),
        occurredAt,
      },
      deps,
    );
    indexed = idxResult.ok === true;
  } catch {
    // Indexing failure must NOT block report write — RAG es enhancement,
    // no es contrato del reporte.
    indexed = false;
  }

  // ── 3. XP positivo (fire-and-forget)
  let xpAwarded = 0;
  if (typeof deps.awardXp === 'function') {
    try {
      if (payload.incidentType === 'post_mortem') {
        deps.awardXp('incident_post_mortem_completed', 50, {
          incidentId,
          tenantId: payload.tenantId,
          projectId: payload.projectId,
          reporterUid: uid,
        });
        xpAwarded = 50;
      } else {
        // near_miss + incident: reportar SIEMPRE suma XP (positivo-only).
        deps.awardXp('near_miss_reported', 10, {
          incidentId,
          tenantId: payload.tenantId,
          projectId: payload.projectId,
          reporterUid: uid,
          incidentType: payload.incidentType,
        });
        xpAwarded = 10;
      }
    } catch {
      xpAwarded = 0;
    }
  }

  return {
    ok: true,
    path: `${incidentPath}/${incidentId}`,
    incidentId,
    xpAwarded,
    indexed,
  };
}
