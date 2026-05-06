// SPDX-License-Identifier: MIT
//
// Sprint 34 — Incident → Zettelkasten post-mortem auto-write.
//
// Flow Infinito Fase 3 (Consolidación de Conocimiento): cada vez que un
// incidente se cierra con una causa raíz declarada, generamos un nodo
// derivado `incident_postmortem` anclado a la normativa más probable y
// lo escribimos en `tenants/{tenantId}/zettelkasten_nodes`. El nodo lleva
// el embedding del rootCause para búsqueda semántica posterior por el
// coach y el knowledge graph.
//
// REGLA: este servicio es 100% interno. No emite hacia SUSESO, SII ni
// ningún organismo externo. Solo escribe en Firestore propio + corre el
// embedder propio (Gemini / fallback determinista).
//
// Diseño:
//   • Inyección de dependencias para Firestore + embedder + ragSearch +
//     sentry capture (todos overrideables en tests).
//   • Fire-and-forget: si el embedding falla, log + Sentry capture y se
//     retorna `{ ok: false, reason }` SIN tirar — el caller (trigger
//     Firestore) NUNCA debe romper el cierre del incidente por esto.
//   • Anchor fallback: si `ragSearch` no encuentra normativa, mapeamos el
//     `incident.type` (string libre) a un nodo del catálogo estático
//     `ohsNormativaNodeRegistry`. Si ningún match → DS-594 genérico.
//   • Edge: una sola arista `(postmortemNode) → (anchorNode)` con label
//     'derives_from_norm'. Mantiene el grafo simple y idempotente.

import type { FamilyNodeSpec } from './families/climateNodeRegistry';

// ── Types ────────────────────────────────────────────────────────────

export interface IncidentDoc {
  /** Doc id (incident id). */
  id: string;
  /** Tenant del que pertenece el incidente. */
  tenantId: string;
  /** Proyecto de origen. */
  projectId: string;
  /** Estado actual — solo procesamos si transitó a 'closed' / 'resolved'. */
  status?: string;
  /** Tipo de incidente (free-text o catálogo: 'fall', 'struck-by', etc.). */
  type?: string;
  /** Causa raíz declarada por el investigador. Sin esto, skip. */
  rootCause?: string;
  /** uid del trabajador afectado (opcional, telemetría). */
  workerUid?: string;
  /** ISO timestamp del evento. */
  occurredAt?: string;
  /** Severidad informada. */
  severity?: string;
}

export interface PostmortemNode {
  id: string;
  type: 'incident_postmortem';
  title: string;
  /** Anchor: el id del nodo normativo del catálogo estático. */
  anchorNodeId: string;
  /** Vector embedding del rootCause. */
  embedding: number[];
  metadata: {
    projectId: string;
    incidentId: string;
    occurredAt?: string;
    workerUid?: string;
    severity?: string;
    rootCausePreview: string;
  };
}

export interface PostmortemEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label: 'derives_from_norm';
  tenantId: string;
}

export interface MinimalDocRef {
  set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>;
}
export interface MinimalCollection {
  doc(id: string): MinimalDocRef;
}
export interface MinimalFirestore {
  collection(path: string): MinimalCollection;
}

export type EmbedFn = (text: string) => Promise<number[]>;

export type RagSearchFn = (query: string, topK: number) => Promise<
  ReadonlyArray<{ id: string; citation: string; source: string }>
>;

export interface PostmortemDeps {
  /** Firestore-ish store. Tests inject a fake. */
  store: MinimalFirestore;
  /** Embedder. Default debe ser inyectado por el caller (no se hardcodea
   *  un import de geminiBackend para mantener este service hermético en tests). */
  genEmbedding: EmbedFn;
  /** Optional rag search to find the best anchor norm. */
  ragSearch?: RagSearchFn;
  /** Sentry/error capture hook. Defaults to no-op. */
  captureError?: (err: unknown, ctx: Record<string, unknown>) => void;
  /** Logger. Defaults to console. */
  logger?: { warn: (msg: string, ctx?: unknown) => void; info: (msg: string, ctx?: unknown) => void };
  /** Server timestamp factory. */
  now?: () => string;
}

export type WriteResult =
  | { ok: true; nodeId: string; edgeId: string; anchorNodeId: string }
  | { ok: false; reason: string };

// ── Anchor mapping (incident type → norma id) ───────────────────────
//
// Fallback table when ragSearch no retorna match. Conservador: cualquier
// incidente sin mapping cae a DS-594 (norma chilena base de condiciones
// sanitarias y ambientales). Mantener sincronizado con
// `ohsNormativaNodeRegistry.ts`.
const INCIDENT_TYPE_TO_NORM: Record<string, string> = {
  fall: 'norma-DS-594',
  'fall-from-height': 'norma-DS-594',
  'struck-by': 'norma-DS-594',
  'caught-in-between': 'norma-DS-594',
  'crush-event': 'norma-DS-594',
  'electric-arc-event': 'norma-DS-594',
  'fire-event': 'norma-DS-594',
  'explosion-event': 'norma-DS-594',
  'gas-release-event': 'norma-DS-66',
  'environmental-spill': 'norma-DS-43',
  'noise-overexposure-event': 'norma-DS-594',
  'exposure-acute': 'norma-DS-594',
  'exposure-chronic-flag': 'norma-DS-594',
  fatality: 'norma-Ley-16744',
  'lost-time-injury': 'norma-Ley-16744',
  'medical-treatment-injury': 'norma-Ley-16744',
  'first-aid-event': 'norma-Ley-16744',
  'audit-finding': 'norma-ISO-45001',
  'audit-non-conformity': 'norma-ISO-45001',
  'iper-finding': 'norma-ISO-45001',
};

const FALLBACK_ANCHOR = 'norma-DS-594';

function pickAnchorFromType(type: string | undefined): string {
  if (!type) return FALLBACK_ANCHOR;
  const key = type.toLowerCase().trim();
  return INCIDENT_TYPE_TO_NORM[key] ?? FALLBACK_ANCHOR;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/**
 * Determina si un incidente está en estado válido para post-mortem.
 * Solo `'closed'` o `'resolved'` con rootCause no-vacío disparan escritura.
 */
export function shouldWritePostmortem(incident: IncidentDoc): boolean {
  if (!incident || typeof incident !== 'object') return false;
  const status = String(incident.status ?? '').toLowerCase();
  if (status !== 'closed' && status !== 'resolved') return false;
  const rc = (incident.rootCause ?? '').trim();
  if (rc.length === 0) return false;
  if (!incident.id || !incident.tenantId || !incident.projectId) return false;
  return true;
}

/**
 * Path helper. Mantiene la convención `tenants/{tenantId}/zettelkasten_nodes`
 * que ya usa `RiskNodeMarkers.tsx`.
 */
function nodesPath(tenantId: string): string {
  return `tenants/${tenantId}/zettelkasten_nodes`;
}
function edgesPath(tenantId: string): string {
  return `tenants/${tenantId}/zettelkasten_edges`;
}
function auditPath(tenantId: string): string {
  return `tenants/${tenantId}/audit_log`;
}

/**
 * Auto-genera un nodo de post-mortem y su edge al anchor normativo.
 *
 * Fire-and-forget: ningún throw escapa. Si embedding o store fallan,
 * captura via `captureError` y retorna `{ ok: false, reason }`.
 *
 * Idempotente: el nodeId es determinista (`incident-${incidentId}-postmortem`),
 * así re-cerrar el mismo incidente no duplica filas (set merge:true).
 */
export async function writeIncidentPostmortemNode(
  incident: IncidentDoc,
  deps: PostmortemDeps,
): Promise<WriteResult> {
  const log = deps.logger ?? console;
  const capture = deps.captureError ?? (() => {});
  const now = deps.now ?? (() => new Date().toISOString());

  if (!shouldWritePostmortem(incident)) {
    return { ok: false, reason: 'precondition_not_met' };
  }

  const rootCause = incident.rootCause!.trim();
  const nodeId = `incident-${incident.id}-postmortem`;

  // 1. Embedding (puede fallar).
  let embedding: number[] = [];
  try {
    embedding = await deps.genEmbedding(rootCause);
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('empty_embedding');
    }
  } catch (err) {
    log.warn?.('zettelkasten_postmortem_embedding_failed', {
      incidentId: incident.id,
      err: String(err),
    });
    capture(err, {
      module: 'zettelkasten',
      action: 'incident_postmortem_embedding',
      incidentId: incident.id,
      tenantId: incident.tenantId,
    });
    return { ok: false, reason: 'embedding_failed' };
  }

  // 2. Anchor: ragSearch primero, fallback a la tabla por type.
  let anchorNodeId = pickAnchorFromType(incident.type);
  if (deps.ragSearch) {
    try {
      const hits = await deps.ragSearch(rootCause, 1);
      if (hits.length > 0 && typeof hits[0]?.id === 'string' && hits[0].id.startsWith('norma-')) {
        anchorNodeId = hits[0].id;
      }
    } catch (err) {
      // ragSearch fail no bloquea — caemos al mapping por type.
      log.warn?.('zettelkasten_postmortem_rag_search_failed', {
        incidentId: incident.id,
        err: String(err),
      });
      capture(err, {
        module: 'zettelkasten',
        action: 'incident_postmortem_rag_search',
        incidentId: incident.id,
      });
    }
  }

  // 3. Build node + edge.
  const node: PostmortemNode = {
    id: nodeId,
    type: 'incident_postmortem',
    title: truncate(rootCause, 120),
    anchorNodeId,
    embedding,
    metadata: {
      projectId: incident.projectId,
      incidentId: incident.id,
      occurredAt: incident.occurredAt,
      workerUid: incident.workerUid,
      severity: incident.severity,
      rootCausePreview: truncate(rootCause, 240),
    },
  };

  const edgeId = `${nodeId}__to__${anchorNodeId}`;
  const edge: PostmortemEdge = {
    id: edgeId,
    fromNodeId: nodeId,
    toNodeId: anchorNodeId,
    label: 'derives_from_norm',
    tenantId: incident.tenantId,
  };

  // 4. Persist (todo o nada — pero capturamos errores granulares).
  try {
    await deps.store
      .collection(nodesPath(incident.tenantId))
      .doc(nodeId)
      .set(
        {
          ...node,
          createdAt: now(),
          updatedAt: now(),
        },
        { merge: true },
      );

    await deps.store
      .collection(edgesPath(incident.tenantId))
      .doc(edgeId)
      .set(
        {
          ...edge,
          createdAt: now(),
        },
        { merge: true },
      );

    // Audit log row.
    await deps.store
      .collection(auditPath(incident.tenantId))
      .doc(`${edgeId}-${Date.now()}`)
      .set({
        action: 'zettelkasten.incident_postmortem_written',
        tenantId: incident.tenantId,
        projectId: incident.projectId,
        incidentId: incident.id,
        nodeId,
        anchorNodeId,
        at: now(),
      });

    log.info?.('zettelkasten_postmortem_written', {
      incidentId: incident.id,
      nodeId,
      anchorNodeId,
    });

    return { ok: true, nodeId, edgeId, anchorNodeId };
  } catch (err) {
    log.warn?.('zettelkasten_postmortem_write_failed', {
      incidentId: incident.id,
      err: String(err),
    });
    capture(err, {
      module: 'zettelkasten',
      action: 'incident_postmortem_write',
      incidentId: incident.id,
      tenantId: incident.tenantId,
    });
    return { ok: false, reason: 'store_write_failed' };
  }
}

/**
 * Test-only helper: expone el anchor mapping para que los tests verifiquen
 * la cobertura sin tener que hacer llamadas reales.
 */
export function __testOnly_pickAnchorFromType(type: string | undefined): string {
  return pickAnchorFromType(type);
}

// Re-export para callers que quieran tipar specs derivados.
export type { FamilyNodeSpec };
