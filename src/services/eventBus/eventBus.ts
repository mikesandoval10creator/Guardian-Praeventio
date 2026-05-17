// Praeventio Guard — Fase C.4: Event Bus global in-process.
//
// Bus de eventos pub/sub liviano y determinístico para coordinar reacciones
// entre módulos (faena state, lone worker, fatigue, evacuation) sin que cada
// servicio tenga que conocer al consumidor. Cierra el wiring entre los
// motores SST que ya existen y la UI/automation que reacciona a ellos.
//
// Decisiones de diseño:
//
//   1. **In-process, sin Zustand**: el repo NO declara Zustand como
//      dependencia. Replicamos la API mental ("store con events[],
//      subscribe, emit, clear") con un módulo singleton + Map de
//      listeners, evitando inflar el bundle con una lib externa. Si en el
//      futuro se adopta Zustand a nivel global, este bus es trivialmente
//      portable (mismo contrato público).
//
//   2. **Separado del systemEngine eventLog**: `systemEngine/eventLog.ts`
//      ya persiste eventos a Firestore + audit_logs (immutable trail con
//      Zod, idempotency, offline outbox). Este bus es la capa **UI/runtime
//      reactiva**: latencia 0, sin red, sin persistencia. Un emisor puede
//      hacer ambos (persistir en systemEngine + emit local en eventBus)
//      cuando le convenga.
//
//   3. **Throttle/debounce por tipo**: faena_state_changed puede dispararse
//      cien veces por segundo si una zona se restringe en cascada; el bus
//      coalese eventos del mismo tipo según una tabla por-tipo. Default es
//      pass-through (no throttling).
//
//   4. **history opcional**: `events: Event[]` es un ring buffer en
//      memoria (capacidad fija, FIFO). Útil para tests, DevTools panel y
//      para que un suscriptor que llega tarde pueda consultar el último
//      estado emitido sin haber estado conectado.
//
//   5. **Errores aislados**: si un callback lanza, no rompe al resto. Se
//      loguea con `logger.warn` siguiendo el patrón de eventLog.ts.

import { logger } from '../../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Event taxonomy
// ────────────────────────────────────────────────────────────────────────

/**
 * Tipos de eventos del bus. Mantener exhaustivo — el discriminated union
 * obliga a TypeScript a validar todos los emisores y suscriptores. Si se
 * agrega un nuevo tipo, agregarlo aquí y a `THROTTLE_CONFIG`.
 */
export type EventType =
  | 'faena_state_changed'
  | 'lone_worker_check_in'
  | 'fatigue_threshold_crossed'
  | 'evacuation_started'
  | 'evacuation_ended'
  | 'critical_incident_opened'
  | 'work_permit_activated'
  | 'shift_started'
  | 'shift_ended';

/**
 * Envelope mínimo común a todos los eventos. `payload` es genérico por tipo;
 * los emisores fuertemente tipados se construyen vía `buildEvent<T>()` para
 * no perder safety.
 */
export interface BusEvent<TPayload = unknown> {
  type: EventType;
  ts: number;
  /** ID único del evento. */
  id: string;
  /** Datos específicos del tipo. */
  payload: TPayload;
  /** Origen del evento (servicio que lo emitió). Útil para debugging. */
  source?: string;
}

// Aliased re-export so callers can `import type { Event } from .../eventBus`
// matching the spec wording without colliding with DOM `Event`.
export type Event<TPayload = unknown> = BusEvent<TPayload>;

// ────────────────────────────────────────────────────────────────────────
// Throttle / debounce config
// ────────────────────────────────────────────────────────────────────────

/**
 * Política de coalescing por tipo de evento.
 *
 *   - `none`: cada emit propaga (default).
 *   - `throttle(ms)`: máximo 1 emit cada `ms`; descarta intermedios.
 *   - `debounce(ms)`: agrupa ráfagas; emite recién después de `ms` sin
 *     nuevos eventos del mismo tipo (con el último payload visto).
 */
export type ThrottlePolicy =
  | { kind: 'none' }
  | { kind: 'throttle'; ms: number }
  | { kind: 'debounce'; ms: number };

const DEFAULT_POLICY: ThrottlePolicy = { kind: 'none' };

/**
 * Tabla por defecto. Pensada para evitar "tormentas" de eventos repetitivos
 * sin penalizar a los eventos críticos (evacuation_started debe ser
 * inmediato siempre).
 */
const THROTTLE_CONFIG: Record<EventType, ThrottlePolicy> = {
  // El state engine puede recomputar muchas veces seguidas mientras se
  // refrescan inputs; sólo nos importa el último valor estable.
  faena_state_changed: { kind: 'debounce', ms: 250 },

  // Check-ins llegan agrupados cuando vuelve la red; throttle agresivo.
  lone_worker_check_in: { kind: 'throttle', ms: 500 },

  // Umbral cruzado: importante, pero podría reportarse en bursts si se
  // recalcula cada minuto; throttle suave.
  fatigue_threshold_crossed: { kind: 'throttle', ms: 1000 },

  // Eventos críticos: never coalesce.
  evacuation_started: { kind: 'none' },
  evacuation_ended: { kind: 'none' },
  critical_incident_opened: { kind: 'none' },

  // Eventos administrativos: baja frecuencia, no necesitan throttle.
  work_permit_activated: { kind: 'none' },
  shift_started: { kind: 'none' },
  shift_ended: { kind: 'none' },
};

// ────────────────────────────────────────────────────────────────────────
// Store interno
// ────────────────────────────────────────────────────────────────────────

type Listener<TPayload = unknown> = (event: BusEvent<TPayload>) => void;

/** Ring buffer cap del history. Suficiente para DevTools panel. */
const HISTORY_CAP = 200;

interface BusState {
  /** Ring buffer: los últimos N eventos emitidos (cualquier tipo). */
  events: BusEvent[];
  /** Listeners por tipo. */
  listeners: Map<EventType, Set<Listener>>;
  /** Estado de throttle por tipo. */
  throttleState: Map<
    EventType,
    {
      lastEmitTs: number;
      debounceTimer: ReturnType<typeof setTimeout> | null;
      pendingEvent: BusEvent | null;
    }
  >;
}

const state: BusState = {
  events: [],
  listeners: new Map(),
  throttleState: new Map(),
};

function getOrInitThrottleState(type: EventType) {
  let st = state.throttleState.get(type);
  if (!st) {
    st = { lastEmitTs: 0, debounceTimer: null, pendingEvent: null };
    state.throttleState.set(type, st);
  }
  return st;
}

function deliver(event: BusEvent): void {
  // Push to ring buffer first so that listeners can observe the new event
  // already present in `events` if they choose to read history.
  state.events.push(event);
  if (state.events.length > HISTORY_CAP) {
    state.events.splice(0, state.events.length - HISTORY_CAP);
  }
  const subs = state.listeners.get(event.type);
  if (!subs || subs.size === 0) return;
  // Snapshot to avoid mutation-during-iteration if a listener unsubscribes.
  for (const fn of Array.from(subs)) {
    try {
      fn(event);
    } catch (err) {
      logger.warn('eventBus: listener threw', {
        type: event.type,
        err: String(err),
      });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Construye un evento con id+timestamp listos para emit. No emite — devuelve
 * el envelope. Útil para tests y para emisores que necesitan el id.
 */
export function buildEvent<TPayload>(input: {
  type: EventType;
  payload: TPayload;
  source?: string;
  /** Si se omite, usa `Date.now()`. */
  ts?: number;
  /** Si se omite, se genera `evt-${ts}-${rand}`. */
  id?: string;
}): BusEvent<TPayload> {
  const ts = input.ts ?? Date.now();
  const id =
    input.id ??
    `evt-${ts}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    type: input.type,
    ts,
    id,
    payload: input.payload,
    source: input.source,
  };
}

/**
 * Suscribe un callback a un tipo de evento. Devuelve la función de
 * desuscripción — el patrón habitual `useEffect`-friendly.
 *
 * El callback se invoca síncronamente cuando llega un evento (modulado por
 * el throttle/debounce policy del tipo). Si lanza, se loguea pero no
 * interrumpe a otros suscriptores.
 */
export function subscribe<TPayload = unknown>(
  type: EventType,
  callback: Listener<TPayload>,
): () => void {
  let subs = state.listeners.get(type);
  if (!subs) {
    subs = new Set();
    state.listeners.set(type, subs);
  }
  subs.add(callback as Listener);
  return () => {
    const current = state.listeners.get(type);
    if (!current) return;
    current.delete(callback as Listener);
    if (current.size === 0) {
      state.listeners.delete(type);
    }
  };
}

/**
 * Emite un evento. La entrega a suscriptores está sujeta a la policy de
 * throttle/debounce configurada para el tipo. Retorna inmediatamente; los
 * listeners se invocan síncronamente (excepto debounce, que difiere).
 */
export function emit<TPayload>(event: BusEvent<TPayload>): void {
  const policy = THROTTLE_CONFIG[event.type] ?? DEFAULT_POLICY;
  const now = event.ts || Date.now();

  switch (policy.kind) {
    case 'none':
      deliver(event as BusEvent);
      return;

    case 'throttle': {
      const st = getOrInitThrottleState(event.type);
      if (now - st.lastEmitTs >= policy.ms) {
        st.lastEmitTs = now;
        deliver(event as BusEvent);
      }
      // else: silently dropped within window — by design.
      return;
    }

    case 'debounce': {
      const st = getOrInitThrottleState(event.type);
      st.pendingEvent = event as BusEvent;
      if (st.debounceTimer !== null) {
        clearTimeout(st.debounceTimer);
      }
      st.debounceTimer = setTimeout(() => {
        const toEmit = st.pendingEvent;
        st.debounceTimer = null;
        st.pendingEvent = null;
        if (toEmit) {
          st.lastEmitTs = Date.now();
          deliver(toEmit);
        }
      }, policy.ms);
      return;
    }
  }
}

/**
 * Borra el ring buffer de eventos. Si se pasa `type`, sólo elimina del
 * history los del tipo dado (los listeners NO se desuscriben — `clear`
 * limpia history, no suscripciones).
 */
export function clear(type?: EventType): void {
  if (!type) {
    state.events.length = 0;
    return;
  }
  state.events = state.events.filter((e) => e.type !== type);
}

/**
 * Snapshot del ring buffer actual. Útil para DevTools, tests y para que
 * un suscriptor tardío revise el último estado conocido sin reemitir.
 */
export function getEvents(filterType?: EventType): readonly BusEvent[] {
  if (!filterType) return state.events.slice();
  return state.events.filter((e) => e.type === filterType);
}

/**
 * Devuelve el conteo actual de listeners por tipo (debug helper).
 */
export function getListenerCount(type: EventType): number {
  return state.listeners.get(type)?.size ?? 0;
}

/**
 * Override de policy en runtime (principal use: tests). NO use en código
 * productivo — la tabla `THROTTLE_CONFIG` debería ser la única fuente de
 * verdad estática.
 */
export function __setPolicyForTests(type: EventType, policy: ThrottlePolicy): void {
  THROTTLE_CONFIG[type] = policy;
}

/**
 * Test-only: limpia todo (history + listeners + estado de throttle).
 */
export function __resetForTests(): void {
  state.events.length = 0;
  state.listeners.clear();
  for (const st of state.throttleState.values()) {
    if (st.debounceTimer !== null) clearTimeout(st.debounceTimer);
  }
  state.throttleState.clear();
}

// ────────────────────────────────────────────────────────────────────────
// Façade compatible con la API mental "store" (subscribe/emit/clear/events)
// ────────────────────────────────────────────────────────────────────────

/**
 * Objeto de conveniencia que expone la API "store" pedida en el spec:
 * `eventBus.subscribe`, `eventBus.emit`, `eventBus.clear`, `eventBus.events`.
 * Los consumidores pueden preferir los named exports o este objeto según
 * gusto — ambos comparten el mismo singleton de estado.
 */
export const eventBus = {
  get events(): readonly BusEvent[] {
    return state.events.slice();
  },
  subscribe,
  emit,
  clear,
  buildEvent,
  getListenerCount,
} as const;
