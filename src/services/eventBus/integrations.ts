// Praeventio Guard — Fase C.4: Integraciones eventBus ↔ services SST.
//
// Los services determinísticos (`faenaStateEngine`, `loneWorkerService`,
// `fatigueMonitor`) son **funciones puras** sin side effects — esa pureza
// es valiosa (testabilidad, no requieren mock de firebase, etc.) y se
// mantiene intacta.
//
// Esta capa es la "frontera" reactiva: helpers que orquestan
//
//   compute pure result  →  emit bus event si cambió de estado
//
// El llamador (hook React, cloud function, etc.) usa el wrapper en vez de
// la función pura cuando además del cómputo quiere notificar al bus.
//
// Decisión: NO modificar los services puros para que continúen
// importables desde código sin React/sin eventBus (cloud functions, tests
// aislados). Si un caller quiere emit, importa este helper.

import {
  computeFaenaState,
  type FaenaStateInput,
  type FaenaStateResult,
  type FaenaOperationalState,
} from '../operationalState/faenaStateEngine.js';
import {
  recordCheckIn,
  type LoneWorkerSession,
} from '../loneWorker/loneWorkerService.js';
import {
  assessFatigue,
  type FatigueAssessment,
  type FatigueRisk,
  type WorkSession,
} from '../fatigue/fatigueMonitor.js';
import { buildEvent, emit, type BusEvent } from './eventBus.js';

// ────────────────────────────────────────────────────────────────────────
// Payload types (re-exportados para los suscriptores)
// ────────────────────────────────────────────────────────────────────────

export interface FaenaStateChangedPayload {
  previousState: FaenaOperationalState | null;
  newState: FaenaOperationalState;
  reason: string;
  affectedModules: string[];
}

export interface LoneWorkerCheckInPayload {
  sessionId: string;
  workerUid: string;
  status: 'ok' | 'help';
  at: string;
  hasLocation: boolean;
}

export interface FatigueThresholdCrossedPayload {
  workerUid: string;
  previousRisk: FatigueRisk | null;
  newRisk: FatigueRisk;
  totalHoursLast24h: number;
  shouldRestrictCritical: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// faena_state_changed — wrapper sobre computeFaenaState
// ────────────────────────────────────────────────────────────────────────

/**
 * Calcula el estado de la faena y emite `faena_state_changed` si el estado
 * cambió respecto al previo conocido.
 *
 * El caller pasa `previousState` (típicamente del Firestore doc o de un
 * cache local). Si es null, se emite siempre (boot inicial). Si coincide
 * con el nuevo state, NO se emite — evita ruido.
 *
 * Devuelve el resultado completo del engine para que el caller pueda
 * persistirlo / mostrarlo sin recomputar.
 */
export function computeFaenaStateAndEmit(
  input: FaenaStateInput,
  previousState: FaenaOperationalState | null,
  options: { now?: Date; source?: string } = {},
): FaenaStateResult {
  const result = computeFaenaState(input, options.now ?? new Date());
  if (previousState === result.state) {
    return result; // No transition → no emit.
  }
  const event: BusEvent<FaenaStateChangedPayload> = buildEvent({
    type: 'faena_state_changed',
    payload: {
      previousState,
      newState: result.state,
      reason: result.reason,
      affectedModules: result.affectedModules,
    },
    source: options.source ?? 'faenaStateEngine',
    ts: options.now ? options.now.getTime() : undefined,
  });
  emit(event);
  return result;
}

// ────────────────────────────────────────────────────────────────────────
// lone_worker_check_in — wrapper sobre recordCheckIn
// ────────────────────────────────────────────────────────────────────────

/**
 * Wrapper de `recordCheckIn` que además emite `lone_worker_check_in`. La
 * función pura sigue siendo importable directamente desde
 * `loneWorkerService` si el caller no quiere notificar al bus (por ej.
 * importaciones masivas en sync diferido).
 */
export function recordCheckInAndEmit(
  session: LoneWorkerSession,
  checkIn: { at?: string; lat?: number; lng?: number; status?: 'ok' | 'help' },
  options: { source?: string } = {},
): LoneWorkerSession {
  const updated = recordCheckIn(session, checkIn);
  // El último check-in registrado en el array es el recién agregado por
  // `recordCheckIn`. Lo usamos para construir el payload con el `at` real
  // (puede haber sido autogenerado por la función pura si no se pasó).
  const justRecorded = updated.checkIns[updated.checkIns.length - 1];
  const payload: LoneWorkerCheckInPayload = {
    sessionId: updated.id,
    workerUid: updated.workerUid,
    status: justRecorded.status,
    at: justRecorded.at,
    hasLocation:
      justRecorded.lat !== undefined && justRecorded.lng !== undefined,
  };
  const event: BusEvent<LoneWorkerCheckInPayload> = buildEvent({
    type: 'lone_worker_check_in',
    payload,
    source: options.source ?? 'loneWorkerService',
    ts: Date.parse(justRecorded.at) || Date.now(),
  });
  emit(event);
  return updated;
}

// ────────────────────────────────────────────────────────────────────────
// fatigue_threshold_crossed — wrapper sobre assessFatigue
// ────────────────────────────────────────────────────────────────────────

const RISK_ORDER: FatigueRisk[] = ['low', 'moderate', 'high', 'critical'];

function isCrossingUp(prev: FatigueRisk | null, next: FatigueRisk): boolean {
  if (prev === null) {
    // Boot: sólo notificamos si el primer assessment ya es ≥ moderate.
    return RISK_ORDER.indexOf(next) >= 1;
  }
  return RISK_ORDER.indexOf(next) > RISK_ORDER.indexOf(prev);
}

/**
 * Calcula la evaluación de fatiga y emite `fatigue_threshold_crossed`
 * **sólo cuando el riesgo escala** (cross-up). Bajadas de riesgo NO emiten
 * por defecto — el caller que quiera registrar "se normalizó" puede leer
 * el resultado y emitir manualmente.
 *
 * Esto evita notificaciones repetitivas cuando un worker oscila entre
 * `moderate` y `low` por márgenes pequeños.
 */
export function assessFatigueAndEmit(
  workerUid: string,
  sessions: WorkSession[],
  previousRisk: FatigueRisk | null,
  options: { now?: Date; source?: string } = {},
): FatigueAssessment {
  const result = assessFatigue(workerUid, sessions, options.now ?? new Date());
  if (!isCrossingUp(previousRisk, result.risk)) {
    return result;
  }
  const event: BusEvent<FatigueThresholdCrossedPayload> = buildEvent({
    type: 'fatigue_threshold_crossed',
    payload: {
      workerUid: result.workerUid,
      previousRisk,
      newRisk: result.risk,
      totalHoursLast24h: result.totalHoursLast24h,
      shouldRestrictCritical: result.shouldRestrictCritical,
    },
    source: options.source ?? 'fatigueMonitor',
    ts: options.now ? options.now.getTime() : Date.parse(result.assessedAt),
  });
  emit(event);
  return result;
}
