// Praeventio Guard — Sprint 39 Fase C.11: sync con revisiones monotónicas.
//
// Cambia el protocolo de sync de "timestamps" (que sufren clock skew y
// race conditions) a "revisiones monotónicas" (enteros incrementales
// asignados por el servidor). Cada cliente mantiene un `watermark` —
// la última revisión que ya tiene. Para sincronizar:
//
//   1. Cliente pide `pull(watermark)` → servidor devuelve todos los
//      docs con `rev > watermark` + nuevo watermark.
//   2. Para escribir, cliente envía `{ uuid, expectedRev?, ... }`. Si
//      `expectedRev` se provee y NO matchea la revisión actual del
//      servidor, devolvemos `conflict` y el cliente debe re-pullear.
//
// Sin Firebase Functions ni triggers: la asignación de rev se hace
// dentro de transactions del servidor (atomicidad garantizada).
//
// El módulo es puro — lógica de protocolo. El adapter Firestore que lo
// implementa vive en `monotonicSync.firestoreAdapter.ts` (Fase C.11 parte 2).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface VersionedDoc<T> {
  /** UUID estable del documento (del cliente o del servidor). */
  uuid: string;
  /** Revisión monotónica asignada por el servidor. */
  rev: number;
  /** Payload. */
  data: T;
  /** ISO-8601 — momento del último write server-side. */
  updatedAt: string;
}

export interface PullRequest {
  /** Última revisión vista por el cliente (0 si nunca pulleó). */
  watermark: number;
  /** Hard cap de docs por respuesta. */
  limit?: number;
}

export interface PullResponse<T> {
  docs: VersionedDoc<T>[];
  /** Nuevo watermark del cliente — la mayor rev de la respuesta. */
  nextWatermark: number;
  /** True si hay más docs para pullear (cliente debería re-llamar). */
  hasMore: boolean;
}

export type PushResult<T> =
  | { kind: 'ok'; doc: VersionedDoc<T> }
  | { kind: 'conflict'; serverRev: number; serverDoc: VersionedDoc<T> }
  | { kind: 'rejected'; reason: string };

export interface PushRequest<T> {
  uuid: string;
  /** Si presente, el servidor solo escribe si `serverRev === expectedRev`. */
  expectedRev?: number;
  data: T;
}

// ────────────────────────────────────────────────────────────────────────
// Pure conflict detector (sin I/O — se llama dentro de transaction)
// ────────────────────────────────────────────────────────────────────────

/**
 * Decide si un push se puede aplicar dado el estado actual del servidor.
 * - Si el doc no existe: ok (será un create, nueva rev).
 * - Si existe y NO se pasó `expectedRev`: ok (last-write-wins).
 * - Si existe y `expectedRev` matchea: ok (será update, nueva rev).
 * - Si existe y `expectedRev` NO matchea: conflict.
 */
export function decidePush<T>(
  request: PushRequest<T>,
  existing: VersionedDoc<T> | null,
): { kind: 'apply'; isCreate: boolean } | { kind: 'conflict'; serverDoc: VersionedDoc<T> } {
  if (!existing) {
    return { kind: 'apply', isCreate: true };
  }
  if (request.expectedRev === undefined) {
    return { kind: 'apply', isCreate: false };
  }
  if (request.expectedRev === existing.rev) {
    return { kind: 'apply', isCreate: false };
  }
  return { kind: 'conflict', serverDoc: existing };
}

/**
 * Filtra docs por watermark (rev > watermark) y los ordena ascendente.
 * Aplica un limit. Devuelve `hasMore = true` si el cliente debe pullear
 * de nuevo para alcanzar el head.
 */
export function buildPullResponse<T>(
  allDocs: VersionedDoc<T>[],
  request: PullRequest,
): PullResponse<T> {
  const limit = request.limit ?? 500;
  const filtered = allDocs
    .filter((d) => d.rev > request.watermark)
    .sort((a, b) => a.rev - b.rev);
  const slice = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const nextWatermark =
    slice.length > 0 ? slice[slice.length - 1].rev : request.watermark;
  return { docs: slice, nextWatermark, hasMore };
}

// ────────────────────────────────────────────────────────────────────────
// Predictive prefetching
// ────────────────────────────────────────────────────────────────────────

/**
 * Dado el contexto del trabajador (turno + tareas + zona), retorna los
 * "predicados" de subcolecciones a precachear. La idea es no pullear
 * el universo: solo lo que ese trabajador va a usar en su turno.
 *
 * El caller usa estos predicados para hacer pulls dirigidos contra
 * Firestore antes de que se necesiten en pantalla.
 */
export interface PrefetchContext {
  /** Trabajador. */
  workerUid: string;
  /** Tareas programadas en las próximas N horas. */
  upcomingTaskCategories: string[];
  /** Zona/sector donde estará trabajando. */
  workZoneId?: string;
  /** Si está en una cuadrilla, los uids de los compañeros. */
  crewmateUids?: string[];
}

export interface PrefetchPlan {
  /** Sub-grafo del Zettelkasten a precachear (riesgos + controles). */
  zettelkastenRoots: string[];
  /** Documentos legales/procedimientos asociados a las tareas. */
  documentCategories: string[];
  /** Capacitaciones críticas a cachear como evidencia local. */
  trainingCategories: string[];
  /** Historiales relevantes de la cuadrilla. */
  crewHistoryUids: string[];
}

export function buildPrefetchPlan(ctx: PrefetchContext): PrefetchPlan {
  return {
    zettelkastenRoots: ctx.upcomingTaskCategories.map((cat) => `risk:${cat}`),
    documentCategories: ctx.upcomingTaskCategories.flatMap((cat) => [
      `procedure:${cat}`,
      `riskmatrix:${cat}`,
    ]),
    trainingCategories: ctx.upcomingTaskCategories,
    crewHistoryUids: ctx.crewmateUids ?? [],
  };
}
