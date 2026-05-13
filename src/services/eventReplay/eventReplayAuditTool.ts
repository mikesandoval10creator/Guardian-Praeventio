// Praeventio Guard — Sprint 53 §147-152: Event replay sourcing audit tool
//
// Construye una capa de **auditoría** encima de `domainEventStore.ts`
// (Sprint 45) que ya provee replay + snapshots. El audit tool adiciona:
//   - Selector de eventos por criterios (tipo, ventana temporal, actor)
//   - Reconstrucción punto-en-tiempo determinística
//   - Diff shallow entre dos estados reconstruidos
//   - Compliance trail export (markdown / CSV)
//   - Audit entry inmutable de quién ejecutó la auditoría y por qué
//
// El audit tool NO mutates events ni el store — solo lee + reduce. La
// "auditoría" en sí queda registrada como `ReplayResult.auditEntry`,
// que el caller persiste a su propio log inmutable (Firestore /
// append-only journal).
//
// Casos de uso:
//   1. Legal request: "estado del incidente al 2026-01-15 23:59" para
//      defensa judicial.
//   2. Compliance audit interno: reconstrucción de cómo evolucionó un
//      permiso en una ventana.
//   3. Data subject access request (GDPR / Ley 21.719): qué eventos
//      tocaron a un trabajador hasta una fecha.
//   4. Incident investigation: diff entre estado pre y post un cambio.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/** Subset mínimo de un evento de dominio que necesita el audit tool. */
export interface DomainEventLike {
  id: string;
  occurredAt: string;
  type: string;
  entityRef: string;
  tenantId: string;
  actorUid: string;
  payload: Record<string, unknown>;
  schemaVersion: number;
  correlationId?: string;
}

/** Subset del store que necesita el audit tool — facilita testing. */
export interface EventStoreLike {
  listByEntity(tenantId: string, entityRef: string): DomainEventLike[];
}

export type ReplayReason =
  | 'legal_request'
  | 'compliance_audit'
  | 'incident_investigation'
  | 'internal_review'
  | 'data_subject_access';

export interface ReplayQuery {
  /** Tenant — obligatorio para multi-tenant isolation. */
  tenantId: string;
  /** Entidad a reconstruir. Si se omite, falla (no soportamos cross-entity). */
  entityRef?: string;
  /** Filtrar por tipos de evento. Si vacío/undefined, aplica todos. */
  eventTypeIn?: string[];
  /** Reconstruir state hasta este momento (ISO-8601). */
  pointInTime: string;
  /** UID que ejecuta la auditoría (audit log). */
  auditorUid: string;
  /** Razón legal/contractual de la auditoría. */
  reason: ReplayReason;
}

export interface ReplayAuditEntry {
  /** ID del query — útil para correlación en logs. */
  queryId: string;
  auditorUid: string;
  reason: ReplayReason;
  /** Cuándo se ejecutó la query (ISO-8601). */
  executedAt: string;
  /** Cuántos eventos escaneó (pre-filter por tipo). */
  eventsScanned: number;
}

export interface ReplayResult<S> {
  entityRef: string;
  pointInTime: string;
  reconstructedState: S;
  eventsApplied: number;
  /** Eventos por tipo agregados (post-filter, pre-aplicación). */
  eventTypeBreakdown: Record<string, number>;
  /** Audit entry inmutable. */
  auditEntry: ReplayAuditEntry;
}

export interface StateDiffField {
  field: string;
  before: unknown;
  after: unknown;
}

export interface StateDiff<S> {
  beforeState: S;
  afterState: S;
  beforeAt: string;
  afterAt: string;
  changedFields: StateDiffField[];
}

export interface ComplianceExportInput {
  replays: ReplayResult<unknown>[];
  format: 'markdown' | 'csv';
}

export class ReplayAuditError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'ReplayAuditError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Determinístico — concat de campos críticos del query. NO usa Math.random
 * ni Date.now para que tests sean reproducibles.
 */
function buildQueryId(q: ReplayQuery, eventsScanned: number, now: string): string {
  return [
    'audit',
    q.tenantId,
    q.entityRef ?? 'no-entity',
    q.pointInTime,
    q.auditorUid,
    q.reason,
    eventsScanned,
    now,
  ]
    .join('|')
    .replace(/[^a-zA-Z0-9_|:.-]/g, '_');
}

function validateQuery(q: ReplayQuery): void {
  if (!q.tenantId) {
    throw new ReplayAuditError('missing_tenant', 'query.tenantId required');
  }
  if (!q.entityRef) {
    throw new ReplayAuditError('missing_entity', 'query.entityRef required (no cross-entity replay)');
  }
  if (!q.auditorUid) {
    throw new ReplayAuditError('missing_auditor', 'query.auditorUid required for audit log');
  }
  if (!q.pointInTime || Number.isNaN(Date.parse(q.pointInTime))) {
    throw new ReplayAuditError('bad_point_in_time', `query.pointInTime inválido: ${q.pointInTime}`);
  }
  const validReasons: ReplayReason[] = [
    'legal_request',
    'compliance_audit',
    'incident_investigation',
    'internal_review',
    'data_subject_access',
  ];
  if (!validReasons.includes(q.reason)) {
    throw new ReplayAuditError('bad_reason', `query.reason inválido: ${q.reason}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Core: executeAuditReplay
// ────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta una reconstrucción punto-en-tiempo con audit trail.
 *
 * - NO muta el store (solo lee).
 * - Devuelve audit entry inmutable que el caller persiste a su log
 *   append-only externo.
 * - Determinístico: mismo input → mismo output (incluido queryId si
 *   `nowOverride` se fija).
 *
 * @param store  Lectura-only del event store (típicamente InMemoryEventStore o un wrapper Firestore).
 * @param query  Criterios + audit metadata.
 * @param initialState  State inicial (típicamente `{}` o un default object).
 * @param reducer  Función pura `(state, event) => state` que aplica un evento.
 * @param nowOverride  Para tests deterministas. En prod se omite (usa Date.now).
 */
export function executeAuditReplay<S>(
  store: EventStoreLike,
  query: ReplayQuery,
  initialState: S,
  reducer: (state: S, event: DomainEventLike) => S,
  nowOverride?: string,
): ReplayResult<S> {
  validateQuery(query);

  const now = nowOverride ?? new Date().toISOString();
  const cutoffMs = Date.parse(query.pointInTime);

  const allEvents = store.listByEntity(query.tenantId, query.entityRef as string);

  // Filtro 1: ventana temporal (≤ pointInTime).
  const eventsInWindow = allEvents.filter((e) => Date.parse(e.occurredAt) <= cutoffMs);

  // Filtro 2: tipos solicitados (si vacío → todos).
  const typeFilter = query.eventTypeIn && query.eventTypeIn.length > 0
    ? new Set(query.eventTypeIn)
    : null;
  const eventsToApply = typeFilter
    ? eventsInWindow.filter((e) => typeFilter.has(e.type))
    : eventsInWindow;

  // Breakdown por tipo.
  const eventTypeBreakdown: Record<string, number> = {};
  for (const e of eventsToApply) {
    eventTypeBreakdown[e.type] = (eventTypeBreakdown[e.type] ?? 0) + 1;
  }

  // Reduce (en orden cronológico — listByEntity ya garantiza orden).
  let state: S = initialState;
  for (const e of eventsToApply) {
    state = reducer(state, e);
  }

  const queryId = buildQueryId(query, eventsInWindow.length, now);

  return {
    entityRef: query.entityRef as string,
    pointInTime: query.pointInTime,
    reconstructedState: state,
    eventsApplied: eventsToApply.length,
    eventTypeBreakdown,
    auditEntry: {
      queryId,
      auditorUid: query.auditorUid,
      reason: query.reason,
      executedAt: now,
      eventsScanned: eventsInWindow.length,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Diff shallow entre dos estados
// ────────────────────────────────────────────────────────────────────────

/**
 * Diff shallow (un nivel) entre dos estados. Detecta:
 *   - Campos que existen en `after` y no en `before` (added).
 *   - Campos que existen en `before` y no en `after` (removed).
 *   - Campos cuyo valor cambió (comparación con `===` para primitivos,
 *     `JSON.stringify` para objetos/arrays).
 *
 * NO hace deep diff — un objeto anidado se reporta como un solo cambio
 * si cualquier subcampo difiere. Esto es intencional: el audit tool no
 * debe leakear PII a través de paths profundos.
 */
export function diffStates<S>(
  before: S,
  after: S,
  meta: { beforeAt: string; afterAt: string },
): StateDiff<S> {
  const changedFields: StateDiffField[] = [];

  const beforeObj = (before ?? {}) as Record<string, unknown>;
  const afterObj = (after ?? {}) as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  for (const k of allKeys) {
    const b = beforeObj[k];
    const a = afterObj[k];
    if (!shallowEqual(b, a)) {
      changedFields.push({ field: k, before: b, after: a });
    }
  }

  // Orden alfabético para outputs deterministas.
  changedFields.sort((x, y) => x.field.localeCompare(y.field));

  return {
    beforeState: before,
    afterState: after,
    beforeAt: meta.beforeAt,
    afterAt: meta.afterAt,
    changedFields,
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    // Para objetos/arrays usamos JSON serialization estable.
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// Compliance trail export
// ────────────────────────────────────────────────────────────────────────

/**
 * Genera un trail exportable (markdown o CSV) de múltiples replays.
 * Útil para anexar a una respuesta legal / data subject access request.
 *
 * Markdown: tabla legible + sección por replay con breakdown.
 * CSV: una fila por replay, columnas planas — sin breakdown nested.
 *
 * NO incluye `reconstructedState` (puede ser arbitrariamente grande y
 * contener PII no destinada al destinatario del trail). El caller
 * decide si adjuntar el state por separado.
 */
export function exportComplianceTrail(input: ComplianceExportInput): string {
  if (!input.replays || input.replays.length === 0) {
    throw new ReplayAuditError('empty_export', 'No hay replays para exportar');
  }
  if (input.format === 'markdown') {
    return exportMarkdown(input.replays);
  }
  if (input.format === 'csv') {
    return exportCsv(input.replays);
  }
  throw new ReplayAuditError('bad_format', `format desconocido: ${input.format as string}`);
}

function exportMarkdown(replays: ReplayResult<unknown>[]): string {
  const lines: string[] = [];
  lines.push('# Compliance Replay Trail');
  lines.push('');
  lines.push(`Total replays: ${replays.length}`);
  lines.push('');
  lines.push('| Query ID | Entity | Point in Time | Auditor | Reason | Events Applied | Executed At |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of replays) {
    lines.push(
      `| ${escapeMd(r.auditEntry.queryId)} | ${escapeMd(r.entityRef)} | ${r.pointInTime} | ${escapeMd(
        r.auditEntry.auditorUid,
      )} | ${r.auditEntry.reason} | ${r.eventsApplied} | ${r.auditEntry.executedAt} |`,
    );
  }
  lines.push('');
  lines.push('## Event Type Breakdown');
  lines.push('');
  for (const r of replays) {
    lines.push(`### ${r.auditEntry.queryId}`);
    const types = Object.keys(r.eventTypeBreakdown).sort();
    if (types.length === 0) {
      lines.push('- (no events applied)');
    } else {
      for (const t of types) {
        lines.push(`- ${t}: ${r.eventTypeBreakdown[t]}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function exportCsv(replays: ReplayResult<unknown>[]): string {
  const rows: string[] = [];
  rows.push('query_id,entity_ref,point_in_time,auditor_uid,reason,events_applied,events_scanned,executed_at');
  for (const r of replays) {
    rows.push(
      [
        csvCell(r.auditEntry.queryId),
        csvCell(r.entityRef),
        csvCell(r.pointInTime),
        csvCell(r.auditEntry.auditorUid),
        csvCell(r.auditEntry.reason),
        String(r.eventsApplied),
        String(r.auditEntry.eventsScanned),
        csvCell(r.auditEntry.executedAt),
      ].join(','),
    );
  }
  return rows.join('\n');
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function csvCell(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
