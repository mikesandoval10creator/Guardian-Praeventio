// SPDX-License-Identifier: MIT
//
// Sprint 47 — Fase C.5: GPS breadcrumb tracker (engine puro).
//
// Mantiene una rolling window de migas GPS del trabajador para anexarlas
// a un SOS cuando el botón se dispara. Esto NO reemplaza al packet `sos`
// (que va con priority crítica + TTL alto): los breadcrumbs van como
// packets `gps_breadcrumb` separados con TTL bajo (3) para no saturar
// la mesh, y sirven para que rescatistas puedan reconstruir el trayecto
// reciente del trabajador caído.
//
// DISEÑO
// ──────
// - PURO. No toca geolocation API ni IndexedDB. El caller (capacitor
//   plugin de GPS o web Geolocation) invoca `addBreadcrumb` con cada
//   ping. La persistencia en disco vive en otra capa.
// - Rolling window por tiempo (default 60min) + cap por count (default
//   120 puntos ≈ 1 ping/30s). Cualquier punto fuera de la ventana se
//   descarta determinísticamente al insertar.
// - Inmutable: cada operación retorna un BreadcrumbState nuevo. El
//   caller lo guarda en su store (Redux/Zustand/IndexedDB).
//
// FORMATO PACKET
// ──────────────
// Los breadcrumbs SOLO se emiten al mesh cuando se construye un SOS
// (función `buildMeshBreadcrumbPacket`). No queremos broadcast pasivo —
// eso violaría la privacidad de tracking del trabajador.

import {
  buildPacket,
  type GpsBreadcrumbPayload,
  type MeshPacket,
} from '../mesh/meshPacket.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface GpsBreadcrumb {
  lat: number;
  lng: number;
  /** Precisión reportada por el GPS en metros. -1 si desconocido. */
  accuracyMeters: number;
  /** ISO-8601 — cuándo capturó el GPS este fix. */
  capturedAt: string;
}

export interface BreadcrumbState {
  /** Lista ordenada cronológicamente ascendente (más viejo primero). */
  readonly breadcrumbs: readonly GpsBreadcrumb[];
}

export interface BreadcrumbWindowOptions {
  /** Tamaño de la ventana en minutos. Default 60. */
  windowMinutes?: number;
  /** Máximo de puntos a retener. Default 120. */
  maxPoints?: number;
}

const DEFAULT_WINDOW_MIN = 60;
const DEFAULT_MAX_POINTS = 120;

// ────────────────────────────────────────────────────────────────────────
// Helpers (puros)
// ────────────────────────────────────────────────────────────────────────

export function emptyBreadcrumbState(): BreadcrumbState {
  return { breadcrumbs: [] };
}

function parseIso(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Agrega un breadcrumb al estado, recortando la ventana. Determinístico:
 * el caller pasa `now` (típicamente `new Date(capturedAt)`), no leemos
 * el reloj nosotros.
 *
 * Si el nuevo breadcrumb es más viejo que `now - windowMinutes`, se
 * descarta (el GPS reportó un fix viejo en cache — no nos interesa).
 *
 * El resultado SIEMPRE queda ordenado ascendente por capturedAt.
 */
export function addBreadcrumb(
  state: BreadcrumbState,
  next: GpsBreadcrumb,
  now: Date,
  options: BreadcrumbWindowOptions = {},
): BreadcrumbState {
  const windowMs = (options.windowMinutes ?? DEFAULT_WINDOW_MIN) * 60_000;
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  const horizon = now.getTime() - windowMs;

  const incomingMs = parseIso(next.capturedAt);
  if (incomingMs < horizon) {
    // Fix demasiado viejo — descartar.
    return state;
  }

  const merged = [...state.breadcrumbs, next]
    .filter((b) => parseIso(b.capturedAt) >= horizon)
    .sort((a, b) => parseIso(a.capturedAt) - parseIso(b.capturedAt));

  const trimmed =
    merged.length > maxPoints
      ? merged.slice(merged.length - maxPoints)
      : merged;

  return { breadcrumbs: trimmed };
}

/**
 * Lista los breadcrumbs vigentes en la ventana, sorted asc. Útil para
 * pasarlos al SOS orchestrator o renderizar trayecto en supervisor UI.
 */
export function getRecentBreadcrumbs(
  state: BreadcrumbState,
  now: Date,
  options: BreadcrumbWindowOptions = {},
): GpsBreadcrumb[] {
  const windowMs = (options.windowMinutes ?? DEFAULT_WINDOW_MIN) * 60_000;
  const horizon = now.getTime() - windowMs;
  return state.breadcrumbs
    .filter((b) => parseIso(b.capturedAt) >= horizon)
    .slice()
    .sort((a, b) => parseIso(a.capturedAt) - parseIso(b.capturedAt));
}

/**
 * Construye un MeshPacket de tipo `gps_breadcrumb` con TTL bajo (3) y
 * priority `low` para no competir con SOS / file_chunk. El caller lo
 * encola via `TransportFacade.sendLocal` igual que cualquier otro
 * packet. Firma queda como `unsigned-dev` — el wire de firma real lo
 * añade el provider en runtime (Sprint 26+).
 */
export function buildMeshBreadcrumbPacket(opts: {
  breadcrumb: GpsBreadcrumb;
  workerUid: string;
  projectId: string;
  /** Override para tests determinísticos. Default `Date.now()`. */
  nowMs?: number;
}): MeshPacket {
  const payload: GpsBreadcrumbPayload = {
    workerUid: opts.workerUid,
    lat: opts.breadcrumb.lat,
    lng: opts.breadcrumb.lng,
    accuracyM: opts.breadcrumb.accuracyMeters,
    capturedAtMs: parseIso(opts.breadcrumb.capturedAt),
    projectId: opts.projectId,
  };
  return buildPacket({
    type: 'gps_breadcrumb',
    fromUid: opts.workerUid,
    toUid: 'supervisors',
    payload,
    bornAtMs: opts.nowMs ?? Date.now(),
    ttl: 3, // TTL bajo — no saturar la mesh con tracking pasivo.
    priority: 'low',
    projectId: opts.projectId,
  });
}
