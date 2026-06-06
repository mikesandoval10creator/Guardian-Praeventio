// Praeventio Guard — §12.6.2: ManDown timer + re-escalación service.
//
// Detecta inactividad de un trabajador solitario, gestiona timer
// graduado y escala a supervisor → comité → SAMU según severidad
// y tiempo sin ACK. Composable con loneWorker existente.
//
// Determinístico, sin LLM ni I/O. UI consumes events via callbacks.

export type ManDownStage =
  | 'pre_alert'       // 0-60s: warning visual al trabajador
  | 'level_1'         // 60-180s: alerta supervisor
  | 'level_2'         // 180-300s: alerta comité paritario
  | 'level_3'         // 300+s: protocolo emergencia (SAMU + brigada)
  | 'resolved'        // trabajador ACK
  | 'cancelled';      // usuario canceló (false positive)

export interface ManDownEvent {
  /** ID único evento. */
  eventId: string;
  /** UID del trabajador monitoreado. */
  workerUid: string;
  /** ISO 8601: cuándo se detectó inactividad. */
  detectedAt: string;
  /** Tenant + project scoping. */
  tenantId: string;
  projectId: string;
  /** Trigger del ManDown: inactividad/caída/ble-disconnect/heart-rate-anomaly. */
  trigger: 'inactivity' | 'fall_detected' | 'ble_disconnect' | 'hr_anomaly';
  /** Geolocalización última conocida. */
  lastLocation?: {
    lat: number;
    lng: number;
    accuracyM: number;
    timestampIso: string;
  };
  /** Estado actual del evento. */
  stage: ManDownStage;
  /** Timestamps de cada escalación. */
  escalationLog: ManDownEscalation[];
  /** Quién ACK (uid si aplica). */
  acknowledgedByUid?: string;
  /** ISO 8601 cuándo se ACK. */
  acknowledgedAt?: string;
}

export interface ManDownEscalation {
  stage: ManDownStage;
  triggeredAt: string;
  notifiedUids: string[];
  channel: 'fcm' | 'sms' | 'voice' | 'broadcast';
}

export interface ManDownConfig {
  /** Segundos hasta level_1 (default 60). */
  preAlertToLevel1Sec: number;
  /** Segundos hasta level_2 (default 180). */
  level1ToLevel2Sec: number;
  /** Segundos hasta level_3 (default 300). */
  level2ToLevel3Sec: number;
  /** Si trigger es 'fall_detected' → saltar pre_alert directo a level_1. */
  skipPreAlertOnFall: boolean;
  /** UIDs supervisor del proyecto (notificados level_1). */
  supervisorUids: string[];
  /** UIDs comité paritario (notificados level_2). */
  cphsUids: string[];
  /** UIDs brigada emergencia (notificados level_3). */
  emergencyBrigadeUids: string[];
}

export const DEFAULT_MAN_DOWN_CONFIG: ManDownConfig = {
  preAlertToLevel1Sec: 60,
  level1ToLevel2Sec: 180,
  level2ToLevel3Sec: 300,
  skipPreAlertOnFall: true,
  supervisorUids: [],
  cphsUids: [],
  emergencyBrigadeUids: [],
};

/**
 * Inicializa un evento ManDown. Si trigger es fall_detected y
 * skipPreAlertOnFall=true, arranca directamente en level_1.
 */
export function initManDownEvent(input: {
  eventId: string;
  workerUid: string;
  tenantId: string;
  projectId: string;
  trigger: ManDownEvent['trigger'];
  detectedAt: string;
  lastLocation?: ManDownEvent['lastLocation'];
  config: ManDownConfig;
}): ManDownEvent {
  const initialStage: ManDownStage =
    input.trigger === 'fall_detected' && input.config.skipPreAlertOnFall
      ? 'level_1'
      : 'pre_alert';

  const initialEscalation: ManDownEscalation = {
    stage: initialStage,
    triggeredAt: input.detectedAt,
    notifiedUids:
      initialStage === 'level_1' ? input.config.supervisorUids : [input.workerUid],
    channel: initialStage === 'level_1' ? 'fcm' : 'broadcast',
  };

  return {
    eventId: input.eventId,
    workerUid: input.workerUid,
    detectedAt: input.detectedAt,
    tenantId: input.tenantId,
    projectId: input.projectId,
    trigger: input.trigger,
    lastLocation: input.lastLocation,
    stage: initialStage,
    escalationLog: [initialEscalation],
  };
}

/**
 * Avanza el evento al siguiente stage si ha pasado el tiempo configurado.
 * Retorna el nuevo evento (immutable) o el mismo si no aplica avance.
 *
 * Llamar periódicamente (cron 30s o cuando llega tick UI).
 */
export function tickManDownEvent(
  event: ManDownEvent,
  nowIso: string,
  config: ManDownConfig,
): ManDownEvent {
  // Estados terminales no avanzan
  if (event.stage === 'resolved' || event.stage === 'cancelled') {
    return event;
  }

  const elapsedSec =
    (Date.parse(nowIso) - Date.parse(event.detectedAt)) / 1000;
  if (isNaN(elapsedSec) || elapsedSec < 0) return event;

  // Cumulative thresholds from detectedAt.
  const t1 = config.preAlertToLevel1Sec;
  const t2 = t1 + config.level1ToLevel2Sec;
  const t3 = t2 + config.level2ToLevel3Sec;

  // The stage the elapsed time WARRANTS. We escalate to this directly instead
  // of advancing a single step: ticks can be missed (cron gap, the worker's
  // device offline then reconnecting). For a possibly-incapacitated worker,
  // a single-step advance would UNDER-escalate — e.g. 600s elapsed but still
  // only reaching level_1, so SAMU/brigada (level_3) are never paged. Every
  // stage crossed in this tick is logged so the responders for each are
  // notified.
  const ESCALATION_ORDER: ManDownStage[] = ['pre_alert', 'level_1', 'level_2', 'level_3'];
  let elapsedRank = 0;
  if (elapsedSec >= t3) elapsedRank = 3;
  else if (elapsedSec >= t2) elapsedRank = 2;
  else if (elapsedSec >= t1) elapsedRank = 1;

  const currentRank = ESCALATION_ORDER.indexOf(event.stage);
  // Never regress (a fall starts at level_1 before t1 elapses).
  const targetRank = Math.max(currentRank, elapsedRank);
  if (targetRank <= currentRank) return event;

  const escalationFor = (stage: ManDownStage): ManDownEscalation => {
    switch (stage) {
      case 'level_1':
        return { stage, triggeredAt: nowIso, notifiedUids: config.supervisorUids, channel: 'fcm' };
      case 'level_2':
        return { stage, triggeredAt: nowIso, notifiedUids: config.cphsUids, channel: 'fcm' };
      case 'level_3':
        // Level 3 fuerza canal multi (FCM + SMS + voz si configurado)
        return { stage, triggeredAt: nowIso, notifiedUids: config.emergencyBrigadeUids, channel: 'voice' };
      default:
        return { stage, triggeredAt: nowIso, notifiedUids: [], channel: 'broadcast' };
    }
  };

  const newEscalations: ManDownEscalation[] = [];
  for (let rank = currentRank + 1; rank <= targetRank; rank++) {
    newEscalations.push(escalationFor(ESCALATION_ORDER[rank]));
  }

  return {
    ...event,
    stage: ESCALATION_ORDER[targetRank],
    escalationLog: [...event.escalationLog, ...newEscalations],
  };
}

/**
 * ACK del evento por supervisor o el propio trabajador. Mueve a 'resolved'.
 */
export function acknowledgeManDownEvent(
  event: ManDownEvent,
  byUid: string,
  ackAtIso: string,
): ManDownEvent {
  if (event.stage === 'cancelled') {
    throw new Error('Cannot acknowledge a cancelled event');
  }
  return {
    ...event,
    stage: 'resolved',
    acknowledgedByUid: byUid,
    acknowledgedAt: ackAtIso,
    escalationLog: [
      ...event.escalationLog,
      {
        stage: 'resolved',
        triggeredAt: ackAtIso,
        notifiedUids: [],
        channel: 'broadcast',
      },
    ],
  };
}

/**
 * Cancela el evento (false positive — trabajador estaba OK, alerta accidental).
 * Diferente a 'resolved' porque marca como NO incidente.
 */
export function cancelManDownEvent(
  event: ManDownEvent,
  byUid: string,
  _reason: string,
  cancelAtIso: string,
): ManDownEvent {
  if (event.stage === 'resolved') {
    throw new Error('Cannot cancel a resolved event');
  }
  return {
    ...event,
    stage: 'cancelled',
    acknowledgedByUid: byUid,
    acknowledgedAt: cancelAtIso,
    escalationLog: [
      ...event.escalationLog,
      {
        stage: 'cancelled',
        triggeredAt: cancelAtIso,
        notifiedUids: [],
        channel: 'broadcast',
      },
    ],
  };
}

/**
 * Helper para UI — texto humano del estado actual.
 */
export function describeStage(stage: ManDownStage): string {
  const map: Record<ManDownStage, string> = {
    pre_alert: 'Pre-alerta — pidiendo confirmación',
    level_1: 'Alerta supervisor activa',
    level_2: 'Escalación a comité paritario',
    level_3: 'PROTOCOLO EMERGENCIA — SAMU notificado',
    resolved: 'Resuelto',
    cancelled: 'Cancelado',
  };
  return map[stage];
}

/**
 * Calcula tiempo restante hasta próxima escalación. Útil para timer UI.
 * Retorna null si está en estado terminal.
 */
export function timeUntilNextEscalation(
  event: ManDownEvent,
  nowIso: string,
  config: ManDownConfig,
): number | null {
  if (event.stage === 'resolved' || event.stage === 'cancelled') return null;

  const elapsedSec =
    (Date.parse(nowIso) - Date.parse(event.detectedAt)) / 1000;
  if (isNaN(elapsedSec)) return null;

  switch (event.stage) {
    case 'pre_alert':
      return Math.max(0, config.preAlertToLevel1Sec - elapsedSec);
    case 'level_1':
      return Math.max(
        0,
        config.preAlertToLevel1Sec + config.level1ToLevel2Sec - elapsedSec,
      );
    case 'level_2':
      return Math.max(
        0,
        config.preAlertToLevel1Sec +
          config.level1ToLevel2Sec +
          config.level2ToLevel3Sec -
          elapsedSec,
      );
    case 'level_3':
      return 0; // Ya en el máximo
    default:
      return null;
  }
}
