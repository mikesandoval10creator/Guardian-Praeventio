// Praeventio Guard — Sprint 11.
//
// Cliente del endpoint POST /api/zettelkasten/nodes (ver
// src/server/routes/zettelkasten.ts). Reemplaza los `logger.info('zettelkasten:â€¦')`
// que sembraron los 15 generadores Bernoulli (HazmatStorageDesigner,
// StructuralCalculator, VisionAnalyzer, BioAnalysis) por escrituras reales
// con identidad determinista, cola offline y dedupe por debounce.
//
// Contratos:
//   • `nodeIdFor(payload, projectId)`: id determinista. Mismos inputs â‡’ mismo
//     id (16 hex SHA-256 truncado). Mismo id â‡’ Firestore upsert idempotente.
//   • `writeNodes(nodes, ctx)`: POST â†’ 200/4xx. Si offline o el POST tira,
//     enrola via `saveForSync` y devuelve { queued: true }.
//   • `writeNodesDebounced(nodes, ctx)`: agrupa por (projectId+nodeKey) y
//     vacía la cola tras 2 s sin actividad. Closure-based, sin lodash.
//
// Why not lodash: el bundle del PWA ya sufre con MediaPipe; un Map<key, timer>
// es 12 LOC y suficiente para nuestro patrón.

import { auth } from '../../firebase';
import { saveForSync } from '../../../utils/pwa-offline';
import { logger } from '../../../utils/logger';
import { withSentryScope } from '../../observability/sentryInstrumentation';
import { analytics } from '../../analytics';
import type { ZkNodeKind } from '../../analytics';
import type { RiskNodePayload } from '../types';
import { apiAuthHeader } from '../../../lib/apiAuth';

// 13th wave analytics: domain `RiskNodePayload.type` strings â†’ analytics
// `ZkNodeKind` enum. Anything not mapped falls to `'other'` so a new
// generator type doesn't drop the event.
function toZkNodeKind(rawType: unknown): ZkNodeKind {
  const t = String(rawType ?? '').toLowerCase();
  if (t.includes('risk') || t === 'riesgo') return 'risk';
  if (t.includes('finding') || t === 'hallazgo') return 'finding';
  if (t.includes('incident')) return 'incident';
  if (t.includes('control')) return 'control';
  if (t.includes('normative') || t === 'norma') return 'normative';
  if (t.includes('task') || t === 'tarea') return 'task';
  if (t.includes('worker') || t === 'trabajador') return 'worker';
  if (t.includes('project') || t === 'proyecto') return 'project';
  if (t.includes('audit')) return 'audit';
  if (t.includes('epp')) return 'epp';
  if (t.includes('asset') || t === 'activo') return 'asset';
  return 'other';
}

export interface WriteContext {
  projectId: string;
}

export interface WriteResult {
  ok: boolean;
  queued?: boolean;
  ids?: string[];
  status?: number;
  error?: string;
}

/**
 * Canonicaliza un payload para hashing determinista. Recorre claves en
 * orden alfabético en cada nivel, así dos objetos con el mismo contenido
 * pero distinto orden de inserción producen exactamente el mismo string.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

/**
 * SHA-256 truncado a 16 hex chars (64 bits) sobre
 * `${type}|${projectId}|${canonical(metadata+connections+references+title)}`.
 *
 * 64 bits son suficientes contra colisiones accidentales para los volúmenes
 * esperados (â‰¤30 nodos / 15 min por uid; ver `zettelkastenWriteLimiter`). El
 * espacio de keys queda dentro del regex ID_REGEX del servidor.
 *
 * Uso de `globalThis.crypto.subtle` para correr igual en navegador (PWA) y
 * en Node 18+ (tests). NUNCA cae al RNG: si subtle no está disponible
 * tiramos en lugar de generar un id no determinista (rompe idempotencia).
 */
export async function nodeIdFor(node: RiskNodePayload, projectId: string): Promise<string> {
  const inputs = canonical({
    type: node.type,
    title: node.title,
    description: node.description,
    severity: node.severity,
    metadata: node.metadata,
    connections: node.connections,
    references: node.references,
  });
  const material = `${node.type}|${projectId}|${inputs}`;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('crypto.subtle unavailable — refusing to generate non-deterministic id');
  }
  const data = new TextEncoder().encode(material);
  const digest = await subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * POST `/api/zettelkasten/nodes`. Si offline o el POST falla, encola via
 * `saveForSync` (PWA) — el sync worker reintentará cuando vuelva la red.
 *
 * Idempotencia: cada nodo lleva su propio `idempotencyKey = nodeIdFor(...)`.
 * Re-ejecutar la misma llamada NO duplica filas (el servidor hace
 * `.doc(idempotencyKey).set({...}, {merge: true})`).
 */
export async function writeNodes(
  nodes: RiskNodePayload[],
  ctx: WriteContext,
): Promise<WriteResult> {
  // Sprint 20 Bucket Mu — Sentry scope tags `module=zettelkasten`. We
  // count nodes by type (low cardinality) so an issue with the IPER
  // generator vs. the HazmatStorageDesigner is easy to disambiguate
  // from the Sentry issue page. We DO NOT pass the raw nodes (they
  // contain the `description` text the user typed).
  return withSentryScope(
    'zettelkasten',
    {
      action: 'writeNodes',
      projectId: ctx?.projectId ?? '(missing)',
      nodeCount: Array.isArray(nodes) ? nodes.length : 0,
      nodeTypes: Array.isArray(nodes)
        ? Array.from(new Set(nodes.map((n) => n?.type).filter(Boolean)))
        : [],
    },
    async () => writeNodesImpl(nodes, ctx),
  );
}

async function writeNodesImpl(
  nodes: RiskNodePayload[],
  ctx: WriteContext,
): Promise<WriteResult> {
  if (!Array.isArray(nodes) || nodes.length === 0) return { ok: true, ids: [] };
  if (typeof ctx?.projectId !== 'string' || ctx.projectId.length === 0) {
    return { ok: false, error: 'missing projectId' };
  }

  const ids = await Promise.all(nodes.map((n) => nodeIdFor(n, ctx.projectId)));
  const enriched = nodes.map((n, i) => ({ ...n, idempotencyKey: ids[i] }));

  // Online + autenticado: POST directo.
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (online) {
    try {
      // §2.20 fix (2026-05-21) — usa apiAuthHeader() helper que prefiere
      // E2E header (MODE=test) sobre Bearer ${authHeader}. Antes este call-site
      // tiraba 401 silencioso en E2E full-stack offline-resilience spec
      // (el spec hace fetch /api/zettelkasten/nodes para sync post-offline).
      const { apiAuthHeader } = await import('../../../lib/apiAuth');
      const authHeader = await apiAuthHeader();
      if (!authHeader) {
        // Sin sesión, encolamos para que el flujo offline lo recupere.
        await saveForSync({
          type: 'create',
          collection: 'zettelkasten_nodes',
          data: { projectId: ctx.projectId, nodes: enriched },
        });
        return { ok: true, queued: true, ids };
      }
      const res = await fetch('/api/zettelkasten/nodes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({ projectId: ctx.projectId, nodes: enriched }),
      });
      if (!res.ok) {
        // 4xx â†’ no reintentar silenciosamente; logueamos. 5xx/red caen al catch.
        const text = await res.text().catch(() => '');
        logger.error('zettelkasten_write_http_error', { status: res.status, text });
        return { ok: false, status: res.status, error: text };
      }
      // 13th wave analytics: emit `knowledge.zk.node.created` per node only
      // on the success path (online + 2xx). Offline / queued writes do NOT
      // fire here — the catalog defines this as "post-reconciliation"; a
      // future enhancement can fire from the sync worker once a queued
      // write lands on Firestore. Fire-and-forget; never block the POST.
      try {
        for (let i = 0; i < enriched.length; i += 1) {
          const node = enriched[i];
          void analytics.track('knowledge.zk.node.created', {
            zk_node_id: ids[i],
            zk_node_kind: toZkNodeKind(node.type),
          });
        }
      } catch { /* analytics must never break user flow */ }
      return { ok: true, ids };
    } catch (err) {
      // Red caída entre el check `navigator.onLine` y el fetch. Encolamos.
      logger.warn('zettelkasten_write_falling_back_to_offline_queue', { err: String(err) });
      await saveForSync({
        type: 'create',
        collection: 'zettelkasten_nodes',
        data: { projectId: ctx.projectId, nodes: enriched },
      });
      return { ok: true, queued: true, ids };
    }
  }

  // Offline puro.
  await saveForSync({
    type: 'create',
    collection: 'zettelkasten_nodes',
    data: { projectId: ctx.projectId, nodes: enriched },
  });
  return { ok: true, queued: true, ids };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Debounce wrapper (2s) — un Map<key, timer> en clausura, sin lodash.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DEBOUNCE_MS = 2000;

interface PendingEntry {
  timer: ReturnType<typeof setTimeout>;
  nodes: Map<string, RiskNodePayload>; // key = nodeIdFor â†’ último payload gana
  ctx: WriteContext;
}

const pending = new Map<string, PendingEntry>();

function debounceKey(ctx: WriteContext, node: RiskNodePayload): string {
  return `${ctx.projectId}:${node.type}`;
}

/**
 * Debounce por (projectId, nodeType). Si el usuario tira el slider que
 * recalcula el `scaffold-uplift` 50 veces en 2 s, solo el último estado
 * vuela al servidor. Cada call resetea el timer (trailing edge).
 *
 * Devuelve void: el resultado del POST no es observable desde la UI; los
 * errores se reportan via `logger`. Para await del resultado real, usá
 * `writeNodes(...)` directamente.
 */
export function writeNodesDebounced(
  nodes: RiskNodePayload[],
  ctx: WriteContext,
): void {
  if (!Array.isArray(nodes) || nodes.length === 0) return;
  if (typeof ctx?.projectId !== 'string' || ctx.projectId.length === 0) return;

  for (const node of nodes) {
    const key = debounceKey(ctx, node);
    const cur = pending.get(key);
    if (cur) {
      clearTimeout(cur.timer);
      cur.nodes.set(node.type, node); // último estado para ese type gana
      cur.timer = setTimeout(() => flush(key), DEBOUNCE_MS);
    } else {
      const map = new Map<string, RiskNodePayload>();
      map.set(node.type, node);
      const timer = setTimeout(() => flush(key), DEBOUNCE_MS);
      pending.set(key, { timer, nodes: map, ctx });
    }
  }
}

function flush(key: string): void {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  const batch = Array.from(entry.nodes.values());
  void writeNodes(batch, entry.ctx).catch((err) => {
    logger.error('zettelkasten_debounced_flush_failed', { err: String(err) });
  });
}

/**
 * Flush ALL pending debounced writes immediately. Called on pagehide /
 * visibilitychange(hidden) so that critical risk nodes calculated by
 * StructuralCalculator / scaffold-uplift are never lost if the user
 * navigates or closes within the 2 s debounce window.
 *
 * Delegates to `writeNodes` (fire-and-forget). On offline the PWA
 * sync-worker retries via `saveForSync`; on network errors the same
 * fallback applies.
 */
function flushAll(): void {
  const entries = Array.from(pending.entries());
  if (entries.length === 0) return;
  // Clear timers first so a racing setTimeout doesn't double-flush.
  for (const [, entry] of entries) {
    clearTimeout(entry.timer);
  }
  pending.clear();

  for (const [, entry] of entries) {
    const batch = Array.from(entry.nodes.values());
    if (batch.length === 0) continue;
    // Fire-and-forget: on pagehide we can't await. sendBeacon is
    // the only API guaranteed to survive page unload in all browsers.
    void writeNodes(batch, entry.ctx).catch((err) => {
      logger.error('zettelkasten_pagehide_flush_failed', { err: String(err) });
    });
  }
}

// ── Lifecycle listeners (browser only) ──────────────────────────────

function onPageHide(): void {
  flushAll();
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    flushAll();
  }
}

let listenersAttached = false;

function ensureListeners(): void {
  if (listenersAttached) return;
  if (typeof window === 'undefined') return; // SSR / Node — no-op
  if (typeof document === 'undefined') return;
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);
  listenersAttached = true;
}

// Attach eagerly on module load (browser). The listeners are passive
// until there is actually something in `pending`.
ensureListeners();

/** Test-only: vacía el estado del debounce y remueve listeners. NO usar en producción. */
export function __resetDebounceForTests(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
  }
  pending.clear();
  if (listenersAttached && typeof window !== 'undefined') {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    listenersAttached = false;
  }
}
