// SPDX-License-Identifier: MIT
//
// Sprint 47 — Fase C.5: SOS Orchestrator (engine puro).
//
// CONTEXTO
// ════════
// Cuando el trabajador dispara el botón SOS (o un detector automático
// como `fallDetected` o `manDownTimeout`), tenemos que coordinar
// varios sistemas que ya existen como engines puros pero NO están
// cableados entre sí:
//
//   1. `meshPacket.buildPacket()`           → emitir packet SOS al mesh
//   2. `sosOutbox.SosOutbox.enqueue()`      → cola IndexedDB para retry HTTP
//   3. `gpsBreadcrumbTracker`               → trayecto reciente
//   4. `emergencyNumbers.getEmergencyNumbersByCoords()` → mostrar números país
//
// Este módulo NO ejecuta side-effects. Construye un `SosOrchestrationPlan`
// que el caller (EmergencyContext / capacitor plugin) materializa:
//   - persiste outboxEntry vía IndexedDB
//   - emite meshPacket vía TransportFacade.sendLocal
//   - emite breadcrumbs vía TransportFacade.sendLocal (uno a uno, bajo TTL)
//   - muestra emergencyNumbers + disclaimer en pantalla
//
// La separación es deliberada: el orchestrator es testeable sin mockear
// IndexedDB / BLE / GPS, y un canary loop o un Tauri desktop client
// puede reusarlo sin cambios.
//
// DIRECTIVAS (memoria del usuario)
// ════════════════════════════════
// - Directiva 2: NUNCA bloquear maquinaria. El disclaimer lo deja claro.
// - Directiva 3: NUNCA push automático a APIs SUSESO/MINSAL — solo
//   generamos el documento + lo mostramos al supervisor, que lo entrega.
// - Directiva 4: si añadimos data externa (NASA EONET, USGS), va como
//   recomendación discreta con cita, no como autoridad. (Fuera de scope
//   de este módulo — el orchestrator no consulta APIs externas.)

import {
  buildPacket,
  type MeshPacket,
} from '../mesh/meshPacket.js';
import {
  getEmergencyNumbersByCoords,
  getEmergencyNumbersByRegion,
  type EmergencyNumbers,
} from './emergencyNumbers.js';
import {
  buildMeshBreadcrumbPacket,
  getRecentBreadcrumbs,
  type BreadcrumbState,
  type GpsBreadcrumb,
} from './gpsBreadcrumbTracker.js';
import type { SosEvent, SosEventReason } from './sosOutbox.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SosReasonCode =
  | 'fall'
  | 'medical'
  | 'fire'
  | 'gas'
  | 'manual'
  | 'unknown';

export interface SosContext {
  workerUid: string;
  projectId: string;
  /** Coordenadas del trabajador en el momento del SOS, si están disponibles. */
  coords?: { lat: number; lng: number; accuracyMeters?: number };
  /** ISO-8601 — cuándo se disparó el SOS. */
  reportedAt: string;
  reasonCode?: SosReasonCode;
  /** Notas opcionales del trabajador (manual). */
  notes?: string;
  /** UUID único del evento (idempotency). */
  clientEventId: string;
  /** Código de región ISO 3166 alpha-2 del proyecto (override de GPS). */
  regionCode?: string;
}

export interface SosOrchestratorOptions {
  /** Estado actual de la rolling window de breadcrumbs. */
  breadcrumbState?: BreadcrumbState;
  /** Reloj para tests determinísticos. Default `() => Date.now()`. */
  now?: () => number;
  /** Ventana de breadcrumbs a anexar (default 60min). */
  breadcrumbWindowMinutes?: number;
  /** Máximo de breadcrumbs a anexar al SOS. Default 30. */
  maxBreadcrumbs?: number;
}

export interface SosOrchestrationPlan {
  /** Packet SOS principal a emitir via mesh (priority sos). */
  meshPacket: MeshPacket;
  /** Entry para persistir en outbox IndexedDB para retry HTTP. */
  outboxEntry: { event: SosEvent };
  /** Packets adicionales de breadcrumbs (TTL bajo, priority low). */
  breadcrumbPackets: MeshPacket[];
  /** Migas crudas (para UI supervisor + persistencia). */
  breadcrumbs: GpsBreadcrumb[];
  /** Números de emergencia país-aware a mostrar en pantalla. */
  emergencyNumbers: EmergencyNumbers;
  /** Disclaimer obligatorio (Directiva 2 — no bloquear). */
  disclaimer: string;
}

// ────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_BREADCRUMBS = 30;

const DISCLAIMER_ES =
  'Guardian Praeventio recomienda evacuar y contactar servicios de ' +
  'emergencia. No detenemos maquinaria automáticamente — la decisión ' +
  'final es del supervisor / trabajador en el sitio.';

function mapReasonToOutbox(reason: SosReasonCode | undefined): SosEventReason {
  switch (reason) {
    case 'fall':
      return 'fall_detected';
    case 'medical':
      return 'manual_button';
    case 'fire':
      return 'manual_button';
    case 'gas':
      return 'gas_alert';
    case 'manual':
      return 'manual_button';
    case 'unknown':
    case undefined:
    default:
      return 'manual_button';
  }
}

function mapReasonToMeshTrigger(
  reason: SosReasonCode | undefined,
): 'fall_detected' | 'manual' | 'man_down_timeout' | 'no_response' {
  if (reason === 'fall') return 'fall_detected';
  // Resto se mapea a manual — la diferencia fina vive en `reasonCode` del
  // payload (lo agregamos como campo extra abajo).
  return 'manual';
}

function resolveEmergencyNumbers(ctx: SosContext): EmergencyNumbers {
  if (ctx.regionCode && ctx.regionCode.trim().length > 0) {
    return getEmergencyNumbersByRegion(ctx.regionCode);
  }
  if (ctx.coords) {
    return getEmergencyNumbersByCoords({
      lat: ctx.coords.lat,
      lng: ctx.coords.lng,
    });
  }
  // Fallback Chile (mercado primario) via lookup con código bogus.
  return getEmergencyNumbersByRegion('CL');
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Construye el plan completo de respuesta SOS. Función PURA: no toca
 * IndexedDB ni emite por BLE — solo arma el plan. El caller lo
 * materializa.
 *
 * Garantías:
 *   - `meshPacket.priority` siempre `'sos'`.
 *   - `outboxEntry.event.clientEventId` idéntico al `ctx.clientEventId`
 *     (idempotency end-to-end).
 *   - `breadcrumbPackets` ordenados ascendente por capturedAt.
 *   - `emergencyNumbers` jamás null (fallback Chile siempre).
 *   - `disclaimer` jamás vacío.
 */
export function buildSosOrchestration(
  ctx: SosContext,
  options: SosOrchestratorOptions = {},
): SosOrchestrationPlan {
  const now = options.now ?? (() => Date.now());
  const nowMs = now();

  // 1) Mesh packet (priority sos, TTL alto)
  const meshLocation = ctx.coords
    ? {
        lat: ctx.coords.lat,
        lng: ctx.coords.lng,
        accuracyM: ctx.coords.accuracyMeters ?? -1,
      }
    : { lat: 0, lng: 0, accuracyM: -1 };

  const meshPacket = buildPacket({
    type: 'sos',
    fromUid: ctx.workerUid,
    toUid: 'broadcast',
    bornAtMs: nowMs,
    payload: {
      workerUid: ctx.workerUid,
      location: meshLocation,
      capturedAtMs: Date.parse(ctx.reportedAt) || nowMs,
      triggerReason: mapReasonToMeshTrigger(ctx.reasonCode),
      reasonCode: ctx.reasonCode ?? 'manual',
      projectId: ctx.projectId,
      notes: ctx.notes,
    },
    projectId: ctx.projectId,
  });

  // 2) Outbox entry (idempotency clave)
  const outboxEvent: SosEvent = {
    clientEventId: ctx.clientEventId,
    workerUid: ctx.workerUid,
    reason: mapReasonToOutbox(ctx.reasonCode),
    occurredAt: ctx.reportedAt,
    coords: ctx.coords
      ? {
          lat: ctx.coords.lat,
          lng: ctx.coords.lng,
          accuracyMeters: ctx.coords.accuracyMeters,
        }
      : undefined,
    notes: ctx.notes,
  };

  // 3) Breadcrumbs (si hay)
  let breadcrumbs: GpsBreadcrumb[] = [];
  let breadcrumbPackets: MeshPacket[] = [];
  if (options.breadcrumbState) {
    const recent = getRecentBreadcrumbs(
      options.breadcrumbState,
      new Date(nowMs),
      {
        windowMinutes: options.breadcrumbWindowMinutes,
      },
    );
    const maxN = options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS;
    breadcrumbs =
      recent.length > maxN ? recent.slice(recent.length - maxN) : recent;
    breadcrumbPackets = breadcrumbs.map((b) =>
      buildMeshBreadcrumbPacket({
        breadcrumb: b,
        workerUid: ctx.workerUid,
        projectId: ctx.projectId,
        nowMs,
      }),
    );
  }

  // 4) Emergency numbers
  const emergencyNumbers = resolveEmergencyNumbers(ctx);

  return {
    meshPacket,
    outboxEntry: { event: outboxEvent },
    breadcrumbPackets,
    breadcrumbs,
    emergencyNumbers,
    disclaimer: DISCLAIMER_ES,
  };
}
