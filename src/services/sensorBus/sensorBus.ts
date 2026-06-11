// Praeventio Guard — TODO.md §12.2.1: sensorBus central (Zustand).
//
// Los 54 hooks de sensor (BLE/HR/Fall/Gas/WBGT/Noise/GPS/Pressure...)
// hasta ahora eran islas: cada uno disparaba su propio toast/alert sin
// correlación. Resultado: falsos positivos masivos (un único bip de
// frecuencia cardíaca por mal contacto BLE generaba alerta cardíaca
// completa). El plan integrado §12.2.1 (IMPLEMENTATION_ROADMAP:645-737)
// exige un bus central que correlacione señales antes de escalar.
//
// Modelo:
//   1. Cada sensor publica `SensorReading` al bus vía `publishReading`.
//   2. El bus mantiene la ÚLTIMA lectura por (sensor, projectId,
//      workerUid). Stale después de `STALE_THRESHOLD_MS` (default 60s).
//   3. Reglas declarativas (`CorrelationRule[]`) escanean el estado
//      en cada nuevo reading y emiten `CorrelatedAlert` cuando ≥2
//      señales coinciden en ventana temporal.
//   4. Consumidores se suscriben con `subscribeToAlerts` (callback).
//   5. Política: NUNCA bloquear maquinaria (directiva #2). Solo
//      recomendar al supervisor.
//
// Pure data + Zustand store. Tests: 100% puros sin React.

import { create } from 'zustand';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type SensorKind =
  | 'fall'
  | 'inactivity'
  | 'heart_rate'
  | 'ble_proximity'
  | 'gas'
  | 'wbgt'
  | 'noise'
  | 'gps'
  | 'pressure'
  | 'battery'
  | 'oxygen'
  | 'temperature'
  | 'lone_worker_panic'
  // Device carry-mode transitions (normal/in_pocket/near_head/in_helmet_mount/
  // face_down) classified by proximityModeDetector via useProximityMode.
  // face_down publishes as 'warning' (possible unconscious worker).
  | 'device_mode';

export type SensorSeverity = 'info' | 'warning' | 'critical';

export interface SensorReading {
  /** Identificador único del reading (sha256-style hex o uuid). */
  readingId: string;
  kind: SensorKind;
  /** UID del trabajador asociado. */
  workerUid: string;
  /** Project context. */
  projectId: string;
  /** Severidad evaluada por el sensor mismo. */
  severity: SensorSeverity;
  /** Valor escalar (depende del sensor — ej. ppm para gas, dB para noise). */
  value?: number;
  /** Unidades para auditoría. */
  unit?: string;
  /** ISO-8601 cuando se capturó. */
  at: string;
  /** Metadata adicional (deviceId, location, etc.). */
  meta?: Record<string, unknown>;
}

export type AlertEscalation = 'recommend' | 'urgent';

export interface CorrelatedAlert {
  alertId: string;
  /** Regla que disparó el alert. */
  ruleId: string;
  /** Lecturas correlacionadas que justifican el alert. */
  triggeringReadings: SensorReading[];
  /** UID del trabajador afectado. */
  workerUid: string;
  projectId: string;
  /** Recomendación humana en ES. */
  recommendation: string;
  /** "recommend" (notificación pasiva) vs "urgent" (interrumpe supervisor). */
  escalation: AlertEscalation;
  emittedAt: string;
}

/**
 * Regla de correlación. `match` recibe el estado actual indexado por
 * (workerUid, kind) → SensorReading y decide si dispara un alert.
 */
export interface CorrelationRule {
  id: string;
  description: string;
  /**
   * Predicado evaluado en cada nuevo reading. Devuelve `null` para no
   * disparar, o el alert sin `alertId`/`emittedAt` (lo añade el bus).
   */
  match: (
    readings: ReadonlyMap<string, SensorReading>,
    newReading: SensorReading,
    now: Date,
  ) => Omit<CorrelatedAlert, 'alertId' | 'emittedAt'> | null;
}

export interface SensorBusState {
  /** Map key: `${workerUid}::${kind}` → latest SensorReading. */
  readings: Map<string, SensorReading>;
  /** Alerts correlacionadas que aún no se acknowledged (max LIMIT). */
  pendingAlerts: CorrelatedAlert[];
  /** Total alerts emitidos desde el bootstrap (counter, para metrics). */
  totalAlertsEmitted: number;
}

export interface SensorBusActions {
  publishReading: (r: SensorReading, now?: Date) => CorrelatedAlert[];
  acknowledgeAlert: (alertId: string) => void;
  clearStaleReadings: (now?: Date) => number;
  reset: () => void;
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

export const STALE_THRESHOLD_MS = 60_000; // 1 minuto
const PENDING_ALERTS_LIMIT = 100;

// ────────────────────────────────────────────────────────────────────────
// Default correlation rules
// ────────────────────────────────────────────────────────────────────────

function getRecent(
  readings: ReadonlyMap<string, SensorReading>,
  workerUid: string,
  kind: SensorKind,
  now: Date,
  withinMs: number = STALE_THRESHOLD_MS,
): SensorReading | undefined {
  const r = readings.get(`${workerUid}::${kind}`);
  if (!r) return undefined;
  const age = now.getTime() - new Date(r.at).getTime();
  return age <= withinMs ? r : undefined;
}

/**
 * Reglas iniciales (curadas a partir del plan integrado IMPLEMENTATION_ROADMAP).
 * Cada regla SOLO recomienda — nunca bloquea (directiva #2).
 */
export const DEFAULT_CORRELATION_RULES: CorrelationRule[] = [
  {
    id: 'fall+inactivity+ble-off',
    description:
      'Caída + inactividad sostenida + BLE desconectado en ventana 60s → urgent',
    match: (readings, neu, now) => {
      // Trigger solo en eventos clave (no en cada inactivity report).
      if (neu.kind !== 'fall' && neu.kind !== 'inactivity' && neu.kind !== 'ble_proximity') {
        return null;
      }
      const fall = getRecent(readings, neu.workerUid, 'fall', now);
      const inactivity = getRecent(readings, neu.workerUid, 'inactivity', now);
      const ble = getRecent(readings, neu.workerUid, 'ble_proximity', now);
      if (!fall || !inactivity || !ble) return null;
      // BLE explícitamente desconectado (warning/critical). Si BLE
      // reciente está 'info' (conectado OK), la regla NO dispara.
      if (ble.severity === 'info') return null;
      return {
        ruleId: 'fall+inactivity+ble-off',
        triggeringReadings: [fall, inactivity, ble],
        workerUid: neu.workerUid,
        projectId: neu.projectId,
        recommendation:
          'Trabajador con caída reciente, sin movimiento y BLE perdido. ' +
          'Iniciar protocolo de búsqueda y enviar pareja al último GPS.',
        escalation: 'urgent',
      };
    },
  },
  {
    id: 'hr-anomaly+gas-high',
    description: 'Frecuencia cardíaca anómala + gas elevado → urgent (intoxicación)',
    match: (readings, neu, now) => {
      if (neu.kind !== 'heart_rate' && neu.kind !== 'gas') return null;
      const hr = getRecent(readings, neu.workerUid, 'heart_rate', now);
      const gas = getRecent(readings, neu.workerUid, 'gas', now);
      if (!hr || !gas) return null;
      if (hr.severity === 'info' && gas.severity === 'info') return null;
      // Al menos uno warning + el otro warning o critical.
      const anomaly =
        (hr.severity !== 'info' && gas.severity !== 'info') ||
        hr.severity === 'critical' ||
        gas.severity === 'critical';
      if (!anomaly) return null;
      return {
        ruleId: 'hr-anomaly+gas-high',
        triggeringReadings: [hr, gas],
        workerUid: neu.workerUid,
        projectId: neu.projectId,
        recommendation:
          'Frecuencia cardíaca anómala con concentración de gas elevada. ' +
          'Posible intoxicación — evacuar zona y evaluar médicamente.',
        escalation: 'urgent',
      };
    },
  },
  {
    id: 'wbgt-high+inactivity',
    description:
      'WBGT alto + inactividad ≥10min → recommend (riesgo golpe de calor)',
    match: (readings, neu, now) => {
      if (neu.kind !== 'wbgt' && neu.kind !== 'inactivity') return null;
      const wbgt = getRecent(readings, neu.workerUid, 'wbgt', now);
      const inact = getRecent(readings, neu.workerUid, 'inactivity', now, 10 * 60_000);
      if (!wbgt || !inact) return null;
      if (wbgt.severity === 'info') return null;
      return {
        ruleId: 'wbgt-high+inactivity',
        triggeringReadings: [wbgt, inact],
        workerUid: neu.workerUid,
        projectId: neu.projectId,
        recommendation:
          'Estrés térmico (WBGT alto) + sin movimiento sostenido. ' +
          'Recomendado: pausa fresca, hidratación y monitoreo signos vitales.',
        escalation: 'recommend',
      };
    },
  },
  {
    id: 'noise-sustained+hr-elevated',
    description: 'Ruido sostenido + HR elevada → recommend (estrés acústico)',
    match: (readings, neu, now) => {
      if (neu.kind !== 'noise' && neu.kind !== 'heart_rate') return null;
      const noise = getRecent(readings, neu.workerUid, 'noise', now);
      const hr = getRecent(readings, neu.workerUid, 'heart_rate', now);
      if (!noise || !hr) return null;
      if (noise.severity === 'info' || hr.severity === 'info') return null;
      return {
        ruleId: 'noise-sustained+hr-elevated',
        triggeringReadings: [noise, hr],
        workerUid: neu.workerUid,
        projectId: neu.projectId,
        recommendation:
          'Ruido sostenido alto + frecuencia cardíaca elevada. ' +
          'Verificar uso de protección auditiva y considerar rotación de tareas.',
        escalation: 'recommend',
      };
    },
  },
  {
    id: 'lone-worker-panic',
    description:
      'Botón pánico de trabajador solo → urgent inmediato (sin esperar otra señal)',
    match: (_readings, neu) => {
      if (neu.kind !== 'lone_worker_panic') return null;
      return {
        ruleId: 'lone-worker-panic',
        triggeringReadings: [neu],
        workerUid: neu.workerUid,
        projectId: neu.projectId,
        recommendation:
          'Trabajador activó botón de pánico. Enviar respuesta inmediata al último GPS conocido.',
        escalation: 'urgent',
      };
    },
  },
];

// ────────────────────────────────────────────────────────────────────────
// Store factory
// ────────────────────────────────────────────────────────────────────────

function readingKey(r: Pick<SensorReading, 'workerUid' | 'kind'>): string {
  return `${r.workerUid}::${r.kind}`;
}

function generateAlertId(rule: string, neu: SensorReading): string {
  // Determinístico para idempotencia: la misma combinación regla+reading
  // dentro de la misma ventana produce el mismo alertId.
  return `${rule}::${neu.workerUid}::${neu.at}`.slice(0, 96);
}

export interface CreateSensorBusOptions {
  rules?: CorrelationRule[];
}

/**
 * Factory. En producción el caller llama `useSensorBus = create(...)`;
 * en tests cada test crea una instancia aislada.
 */
export function createSensorBus(options: CreateSensorBusOptions = {}) {
  const rules = options.rules ?? DEFAULT_CORRELATION_RULES;

  return create<SensorBusState & SensorBusActions>((set, get) => ({
    readings: new Map(),
    pendingAlerts: [],
    totalAlertsEmitted: 0,

    publishReading: (r, now = new Date()) => {
      const currentReadings = new Map(get().readings);
      currentReadings.set(readingKey(r), r);

      const emitted: CorrelatedAlert[] = [];
      for (const rule of rules) {
        const candidate = rule.match(currentReadings, r, now);
        if (!candidate) continue;
        const alertId = generateAlertId(rule.id, r);
        if (get().pendingAlerts.some((a) => a.alertId === alertId)) continue;
        emitted.push({
          ...candidate,
          alertId,
          emittedAt: now.toISOString(),
        });
      }

      set((state) => ({
        readings: currentReadings,
        pendingAlerts: [...state.pendingAlerts, ...emitted].slice(-PENDING_ALERTS_LIMIT),
        totalAlertsEmitted: state.totalAlertsEmitted + emitted.length,
      }));

      return emitted;
    },

    acknowledgeAlert: (alertId) => {
      set((state) => ({
        pendingAlerts: state.pendingAlerts.filter((a) => a.alertId !== alertId),
      }));
    },

    clearStaleReadings: (now = new Date()) => {
      const cutoff = now.getTime() - STALE_THRESHOLD_MS;
      const kept = new Map<string, SensorReading>();
      let removed = 0;
      for (const [k, v] of get().readings.entries()) {
        if (new Date(v.at).getTime() >= cutoff) {
          kept.set(k, v);
        } else {
          removed += 1;
        }
      }
      set({ readings: kept });
      return removed;
    },

    reset: () => {
      set({ readings: new Map(), pendingAlerts: [], totalAlertsEmitted: 0 });
    },
  }));
}

/** Singleton sensor bus para la app productiva. */
export const useSensorBus = createSensorBus();
