// Praeventio Guard — Sprint 39 Fase C.4: Event Bus global.
//
// El "sistema nervioso central" del que habla el plan integral: los 54
// hooks dispersos hoy no se escuchan entre sí. Esta es la capa que
// permite escenarios como:
//   - useBluetoothMesh detecta CO → Gemelo Digital tiñe túnel naranja
//     + Asistente Voz da instrucciones + sync motor pre-descarga manual
//   - SOS dispara auto-relay → mesh; REBA/RULA → folio SUSESO;
//     climate → DS 76; CPHS → claims.
//
// Diseño:
//   - Pure TS (sin deps): el plan recomendaba zustand pero está en
//     package-lock como transitiva — para no agregar dep direct sin
//     aprobación explícita, mantenemos la superficie API compatible
//     con zustand (`getState/setState/subscribe`) y un `useStore` hook
//     que sí pasa por React. Migrar a zustand más adelante es un PR
//     de ~20 líneas si fuera necesario.
//   - Tipos discriminados por `type` (string literal). El bus NO
//     interpreta payloads — solo los enruta. Quien escucha decide.
//   - Snapshot del último evento por tipo (subscribers tardíos lo ven).
//   - Wildcard `*` para auditoría / logging.

import { useSyncExternalStore } from 'react';

// ────────────────────────────────────────────────────────────────────────
// Canonical event catalog (extensible — agregar entries libremente)
// ────────────────────────────────────────────────────────────────────────

/**
 * Tipos canónicos. Cada nuevo dominio agrega su `type` aquí + el shape
 * del payload. La lista se mantiene corta a propósito: la idea es que
 * sea inventario de qué cosas importantes pasan en la app, no
 * cualquier estado interno.
 */
export type GuardianEvent =
  // ── Sensores físicos ──
  | { type: 'sensor.fall'; severity: 'low' | 'medium' | 'high'; gForce: number; at: string }
  | { type: 'sensor.heartrate.high'; bpm: number; workerUid: string; at: string }
  | { type: 'sensor.proximity.pocket'; inPocket: boolean; at: string }
  // ── Mesh BLE ──
  | { type: 'mesh.ble.connected'; peerCount: number; at: string }
  | { type: 'mesh.ble.disconnected'; at: string }
  | { type: 'mesh.packet.received'; kind: string; fromUid: string; at: string }
  // ── Ambiente ──
  | { type: 'weather.alert'; severity: 'advisory' | 'watch' | 'warning'; kind: string; at: string }
  | { type: 'air.quality.bad'; pollutant: string; ppm: number; at: string }
  // ── Emergencia ──
  | { type: 'emergency.sos.triggered'; workerUid: string; reason: string; at: string }
  | { type: 'emergency.evacuation.started'; drillId: string; meetingPointId: string; at: string }
  // ── Dominio ──
  | { type: 'incident.created'; incidentId: string; severity: string; at: string }
  | { type: 'workpermit.issued'; permitId: string; kind: string; at: string }
  | { type: 'stoppage.declared'; stoppageId: string; reason: string; at: string }
  | { type: 'consistency.detected'; ruleId: string; severity: string; at: string }
  // ── Sync ──
  | { type: 'sync.queue.changed'; pending: number; at: string }
  | { type: 'sync.online'; at: string }
  | { type: 'sync.offline'; at: string };

export type GuardianEventType = GuardianEvent['type'];

/** Subscriber recibe el evento tipado o, si subscribe('*'), cualquiera. */
export type EventSubscriber<E extends GuardianEvent = GuardianEvent> = (event: E) => void;

// ────────────────────────────────────────────────────────────────────────
// Store implementation (singleton)
// ────────────────────────────────────────────────────────────────────────

interface EventBusState {
  /** Último evento emitido por tipo. Útil para subscribers tardíos. */
  lastByType: Partial<Record<GuardianEventType, GuardianEvent>>;
  /** Contador acumulado por tipo (telemetría barata). */
  countByType: Partial<Record<GuardianEventType, number>>;
}

const subscribersByType = new Map<GuardianEventType | '*', Set<EventSubscriber>>();
const stateSubscribers = new Set<() => void>();

let state: EventBusState = { lastByType: {}, countByType: {} };

function notifyStateSubscribers(): void {
  for (const cb of stateSubscribers) cb();
}

/**
 * Suscribir a un tipo específico (o `'*'` para todos). Devuelve la
 * función para desuscribir. Si el subscriber se registra después de
 * emitir, recibe el último evento de su tipo de forma síncrona.
 */
export function subscribe<T extends GuardianEventType>(
  type: T | '*',
  fn: EventSubscriber<Extract<GuardianEvent, { type: T }>>,
): () => void;
export function subscribe(type: GuardianEventType | '*', fn: EventSubscriber): () => void {
  let set = subscribersByType.get(type);
  if (!set) {
    set = new Set();
    subscribersByType.set(type, set);
  }
  set.add(fn);

  // Replay del último evento si existe (solo para tipos específicos).
  if (type !== '*') {
    const last = state.lastByType[type];
    if (last) {
      // Async para que el subscriber pueda terminar de configurarse.
      queueMicrotask(() => fn(last));
    }
  }

  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribersByType.delete(type);
  };
}

/**
 * Emite un evento al bus. Todos los subscribers (tipo específico +
 * comodín) lo reciben sincrónicamente. Los errores en un subscriber
 * NO impiden que los demás lo reciban — se loggean al console.error.
 */
export function emit<E extends GuardianEvent>(event: E): void {
  state = {
    lastByType: { ...state.lastByType, [event.type]: event },
    countByType: {
      ...state.countByType,
      [event.type]: (state.countByType[event.type] ?? 0) + 1,
    },
  };
  notifyStateSubscribers();

  const targets = subscribersByType.get(event.type);
  const wildcard = subscribersByType.get('*');
  for (const fn of targets ?? []) {
    try {
      fn(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[eventBus] subscriber threw', event.type, err);
    }
  }
  for (const fn of wildcard ?? []) {
    try {
      fn(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[eventBus] wildcard subscriber threw', event.type, err);
    }
  }
}

/** Snapshot inmutable del estado del bus (lastByType + countByType). */
export function getState(): EventBusState {
  return state;
}

/** Para tests: reset full del bus. NO usar en producción. */
export function __resetForTests(): void {
  subscribersByType.clear();
  stateSubscribers.clear();
  state = { lastByType: {}, countByType: {} };
}

// ────────────────────────────────────────────────────────────────────────
// React integration (useSyncExternalStore — sin deps externas)
// ────────────────────────────────────────────────────────────────────────

function subscribeToState(cb: () => void): () => void {
  stateSubscribers.add(cb);
  return () => stateSubscribers.delete(cb);
}

/** Hook para leer el estado completo del bus (con re-render reactivo). */
export function useEventBusState(): EventBusState {
  return useSyncExternalStore(subscribeToState, getState, getState);
}

/** Hook conveniente: re-render cuando se emite un evento del tipo dado. */
export function useLastEvent<T extends GuardianEventType>(
  type: T,
): Extract<GuardianEvent, { type: T }> | undefined {
  const s = useEventBusState();
  return s.lastByType[type] as Extract<GuardianEvent, { type: T }> | undefined;
}
