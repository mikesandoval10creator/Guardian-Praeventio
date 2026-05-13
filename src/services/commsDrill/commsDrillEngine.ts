// Praeventio Guard — Sprint 53 §215-218: Emergency Comms Drill Engine.
//
// Cierra §215 (drill comunicación emergencia), §216 (prueba mensual
// cadena), §217 (verificación contactabilidad), §218 (radios + dispositivos
// audibles).
//
// 100% determinístico. Construye drill scripts + evalúa ejecución +
// detecta nodos comms caídos.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type CommsChannel =
  | 'radio_vhf'
  | 'radio_uhf'
  | 'phone_cell'
  | 'phone_satellite'
  | 'app_push'
  | 'sms'
  | 'whatsapp'
  | 'pa_loudspeaker'
  | 'face_to_face';

export type DrillObjective =
  | 'verify_primary_channels'
  | 'verify_backup_channels'
  | 'evacuation_announcement'
  | 'roster_callup'
  | 'mass_notification'
  | 'cross_site_relay'
  | 'mutual_external_test';

export interface DrillTarget {
  uid: string;
  role: string;
  /** Canales por los que se espera reciba. */
  expectedChannels: CommsChannel[];
}

export interface DrillScenario {
  id: string;
  objective: DrillObjective;
  scenarioName: string;
  /** Mensaje canónico a transmitir. */
  message: string;
  /** Canales primarios + backup. */
  channelChain: CommsChannel[];
  /** Targets que deben confirmar recepción. */
  targets: DrillTarget[];
  /** Tiempo máximo (segundos) para que todos confirmen. */
  maxTotalResponseSeconds: number;
  /** Frecuencia recomendada (días). */
  recommendedIntervalDays: number;
}

// ────────────────────────────────────────────────────────────────────────
// Canonical drill scripts
// ────────────────────────────────────────────────────────────────────────

const DRILL_LIBRARY: DrillScenario[] = [
  {
    id: 'drill_monthly_primary',
    objective: 'verify_primary_channels',
    scenarioName: 'Verificación mensual canal primario',
    message: 'DRILL TEST: Confirmar recepción. Sin acción real.',
    channelChain: ['radio_vhf', 'phone_cell', 'app_push'],
    targets: [], // populated per project
    maxTotalResponseSeconds: 300,
    recommendedIntervalDays: 30,
  },
  {
    id: 'drill_evacuation',
    objective: 'evacuation_announcement',
    scenarioName: 'Drill anuncio evacuación',
    message: 'EVACUACIÓN DE PRÁCTICA: Dirigirse a punto reunión norte. Sin emergencia real.',
    channelChain: ['pa_loudspeaker', 'radio_vhf', 'app_push', 'sms'],
    targets: [],
    maxTotalResponseSeconds: 600,
    recommendedIntervalDays: 90,
  },
  {
    id: 'drill_backup_chain',
    objective: 'verify_backup_channels',
    scenarioName: 'Cadena de respaldo (asumiendo primary caído)',
    message: 'DRILL: Canal primario simulado caído. Confirmar por backup.',
    channelChain: ['radio_uhf', 'phone_satellite', 'whatsapp'],
    targets: [],
    maxTotalResponseSeconds: 900,
    recommendedIntervalDays: 60,
  },
  {
    id: 'drill_roster_callup',
    objective: 'roster_callup',
    scenarioName: 'Convocatoria roster completa',
    message: 'DRILL: Reportar OK individual.',
    channelChain: ['app_push', 'sms', 'whatsapp', 'phone_cell'],
    targets: [],
    maxTotalResponseSeconds: 1800, // 30 min
    recommendedIntervalDays: 180,
  },
];

export function listDrillScripts(): DrillScenario[] {
  return DRILL_LIBRARY.map((d) => ({ ...d }));
}

export function getDrillById(id: string): DrillScenario | null {
  return DRILL_LIBRARY.find((d) => d.id === id) ?? null;
}

// ────────────────────────────────────────────────────────────────────────
// Drill execution + scoring
// ────────────────────────────────────────────────────────────────────────

export interface ConfirmationRecord {
  targetUid: string;
  channelUsed: CommsChannel;
  receivedAtSeconds: number; // segundos desde inicio del drill
  /** Si responder confirmó a tiempo. */
  onTime: boolean;
}

export interface DrillExecutionInput {
  scenarioId: string;
  targets: DrillTarget[];
  confirmations: ConfirmationRecord[];
  /** Si algún canal de la cadena estuvo caído. */
  channelOutages?: Array<{ channel: CommsChannel; from: number; to: number }>;
  /** ISO-8601 ejecución. */
  executedAt: string;
}

export type DrillVerdict = 'excellent' | 'satisfactory' | 'deficient' | 'failed';

export interface DrillScoreReport {
  scenarioId: string;
  executedAt: string;
  verdict: DrillVerdict;
  /** Score 0-100. */
  score: number;
  /** % de targets que confirmaron. */
  confirmationRatio: number;
  /** Tiempo promedio de respuesta. */
  averageResponseSeconds: number;
  /** Targets que NO confirmaron — críticos para escalation. */
  nonResponders: string[];
  /** Canales con outages reportados. */
  failedChannels: CommsChannel[];
  /** Hallazgos. */
  findings: string[];
  /** Acciones correctivas recomendadas. */
  correctiveActions: string[];
}

export function scoreDrill(input: DrillExecutionInput): DrillScoreReport {
  const scenario = getDrillById(input.scenarioId);
  if (!scenario) {
    return {
      scenarioId: input.scenarioId,
      executedAt: input.executedAt,
      verdict: 'failed',
      score: 0,
      confirmationRatio: 0,
      averageResponseSeconds: 0,
      nonResponders: [],
      failedChannels: [],
      findings: [`Drill scenario ${input.scenarioId} no encontrado.`],
      correctiveActions: [],
    };
  }

  const findings: string[] = [];
  const correctiveActions: string[] = [];

  const targetUids = new Set(input.targets.map((t) => t.uid));
  // Solo cuentan confirmaciones de uids que estaban en targets — confirmaciones
  // externas (ruido) se descartan.
  const confirmedUids = new Set(
    input.confirmations.filter((c) => targetUids.has(c.targetUid)).map((c) => c.targetUid),
  );
  const nonResponders = Array.from(targetUids).filter((uid) => !confirmedUids.has(uid));

  const confirmationRatio = targetUids.size === 0 ? 0 : confirmedUids.size / targetUids.size;
  const validConfirmations = input.confirmations.filter((c) => targetUids.has(c.targetUid));
  const avgResponse =
    validConfirmations.length === 0
      ? 0
      : validConfirmations.reduce((s, c) => s + c.receivedAtSeconds, 0) / validConfirmations.length;

  const onTimeRatio =
    validConfirmations.length === 0
      ? 0
      : validConfirmations.filter((c) => c.onTime).length / validConfirmations.length;

  // Score computation: confirmation 60% peso + on-time 30% + sin outages 10%
  let score = confirmationRatio * 60 + onTimeRatio * 30;
  const failedChannels = (input.channelOutages ?? []).map((o) => o.channel);
  if (failedChannels.length === 0) {
    score += 10;
  } else {
    findings.push(`${failedChannels.length} canal(es) con outages: ${failedChannels.join(', ')}.`);
    correctiveActions.push('Revisar mantenimiento + redundancia de canales caídos.');
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  // Verdict
  let verdict: DrillVerdict;
  if (score >= 90) verdict = 'excellent';
  else if (score >= 75) verdict = 'satisfactory';
  else if (score >= 50) verdict = 'deficient';
  else verdict = 'failed';

  // Findings + actions específicos
  if (confirmationRatio < 1) {
    findings.push(
      `${nonResponders.length} target(s) no confirmaron — verificar disponibilidad / contactabilidad.`,
    );
    correctiveActions.push(`Re-test individual con los ${nonResponders.length} no-responders.`);
  }
  if (avgResponse > scenario.maxTotalResponseSeconds * 0.8) {
    findings.push(`Tiempo promedio cerca del límite (${avgResponse.toFixed(0)}s).`);
    correctiveActions.push('Reducir latencia: aumentar redundancia canal primario.');
  }
  if (failedChannels.includes('app_push')) {
    correctiveActions.push('App push falló — verificar FCM registration + Foreground Service.');
  }

  return {
    scenarioId: input.scenarioId,
    executedAt: input.executedAt,
    verdict,
    score,
    confirmationRatio: Math.round(confirmationRatio * 100) / 100,
    averageResponseSeconds: Math.round(avgResponse),
    nonResponders,
    failedChannels,
    findings,
    correctiveActions,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Drill schedule planner — when next drill should run
// ────────────────────────────────────────────────────────────────────────

export interface PastDrillExecution {
  scenarioId: string;
  executedAt: string;
  verdict: DrillVerdict;
}

export interface DrillScheduleEntry {
  scenarioId: string;
  scenarioName: string;
  lastExecutedAt?: string;
  nextRecommendedAt: string;
  /** Si el drill está overdue. */
  overdue: boolean;
  /** Días de overdue (si aplica). */
  daysOverdue?: number;
}

const DAY_MS = 86_400_000;

export function planDrillSchedule(
  pastExecutions: ReadonlyArray<PastDrillExecution>,
  now: Date,
): DrillScheduleEntry[] {
  const lastByScenario = new Map<string, PastDrillExecution>();
  for (const exec of pastExecutions) {
    const prev = lastByScenario.get(exec.scenarioId);
    if (!prev || Date.parse(exec.executedAt) > Date.parse(prev.executedAt)) {
      lastByScenario.set(exec.scenarioId, exec);
    }
  }

  return DRILL_LIBRARY.map((s) => {
    const last = lastByScenario.get(s.id);
    if (!last) {
      return {
        scenarioId: s.id,
        scenarioName: s.scenarioName,
        nextRecommendedAt: now.toISOString(),
        overdue: true,
      };
    }
    // Si último verdict fue deficient o failed, acortar interval a la mitad
    const intervalDays =
      last.verdict === 'deficient' || last.verdict === 'failed'
        ? Math.floor(s.recommendedIntervalDays / 2)
        : s.recommendedIntervalDays;
    const nextMs = Date.parse(last.executedAt) + intervalDays * DAY_MS;
    const overdue = nextMs < now.getTime();
    const daysOverdue = overdue ? Math.floor((now.getTime() - nextMs) / DAY_MS) : undefined;
    return {
      scenarioId: s.id,
      scenarioName: s.scenarioName,
      lastExecutedAt: last.executedAt,
      nextRecommendedAt: new Date(nextMs).toISOString(),
      overdue,
      daysOverdue,
    };
  });
}
