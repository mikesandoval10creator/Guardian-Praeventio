// Praeventio Guard — Sprint 44 F.11: Verificación de Eficacia.
//
// Cierra F.11 del plan maestro: 30 días después de cerrar una acción
// correctiva, agendar review automático "¿el problema volvió?". Si
// volvió → la acción se marca como `ineffective` y reabre el ciclo.
//
// El motor es PURO. Toma el snapshot del incidente original + el
// snapshot post-acción + las acciones correctivas asociadas. Calcula:
//   - Si el problema reaparece (mismo riesgo + mismas condiciones).
//   - Score de eficacia 0..100.
//   - Recomendación: ratificar / repetir / escalar.
//
// Reusa shapes existentes (CorrectiveAction del centerService).
// No depende del adapter Firestore — el caller le pasa los snapshots.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ActionLevel =
  | 'elimination'
  | 'engineering'
  | 'administrative'
  | 'training'
  | 'epp'
  | 'supervision'
  | 'communication';

export interface CorrectiveActionRef {
  id: string;
  title: string;
  level: ActionLevel;
  /** ISO-8601 cuando se cerró. */
  closedAt: string;
  /** Quién cerró. */
  closedByUid: string;
  /** Evidencia adjunta al cierre. */
  evidenceCount: number;
  /** Si se exigía evidencia tipo foto + medición. */
  evidenceRequired?: boolean;
}

export interface BaselineIncidentSnapshot {
  /** ID del incidente raíz que disparó la acción. */
  incidentId: string;
  /** Riesgo o tipo de evento (mismo taxonomy que F.13 radar). */
  riskKind: string;
  /** Severidad original. */
  severity: 'low' | 'medium' | 'high' | 'critical' | 'sif';
  /** Tasa de ocurrencia previa: incidentes mismo riskKind / 30 días previos. */
  preIncidenceRate30d: number;
  /** Condiciones detectadas en el incidente original (subset relevante). */
  conditions: {
    location?: string;
    timeOfDay?: 'morning' | 'afternoon' | 'night';
    weather?: string;
    crewKind?: string;
  };
}

export interface PostActionWindow {
  /** Inicio de la ventana de verificación (ISO). Typically closedAt. */
  windowStart: string;
  /** Fin de la ventana (default closedAt + 30d). */
  windowEnd: string;
  /** Incidentes con mismo riskKind ocurridos en la ventana. */
  recurrenceIncidents: Array<{
    incidentId: string;
    occurredAt: string;
    sameLocation: boolean;
    sameCrew: boolean;
    severity: 'low' | 'medium' | 'high' | 'critical' | 'sif';
  }>;
  /** Indicadores leading observados en la ventana. */
  leadingIndicators: {
    /** Cuántas observaciones positivas se hicieron en el área. */
    positiveObservations?: number;
    /** Cuántas excepciones / desviaciones se levantaron. */
    exceptionsRaised?: number;
    /** Si se mantuvo verificación periódica del control. */
    controlVerificationsCount?: number;
  };
}

export type EfficacyVerdict = 'effective' | 'partially_effective' | 'ineffective' | 'inconclusive';

export interface EfficacyVerificationResult {
  /** Verdict primario. */
  verdict: EfficacyVerdict;
  /** Score 0..100 (100 = efectiva, 0 = problema empeoró). */
  score: number;
  /** Justificación human-readable. */
  rationale: string;
  /** Recomendación accionable. */
  recommendation:
    | 'ratify_close'
    | 'extend_observation_window'
    | 'reopen_repeat_action'
    | 'escalate_to_higher_level'
    | 'investigate_root_cause_again';
  /** Razones específicas (lista). */
  reasons: string[];
  /** Si reabrió: motivo concreto. */
  reopenTriggers: string[];
  /** Cuándo fue evaluado. */
  evaluatedAt: string;
  /** Window evaluada. */
  windowDays: number;
}

// ────────────────────────────────────────────────────────────────────────
// Verification
// ────────────────────────────────────────────────────────────────────────

export interface VerifyEfficacyInput {
  baseline: BaselineIncidentSnapshot;
  window: PostActionWindow;
  actions: CorrectiveActionRef[];
}

export interface VerifyOptions {
  now?: Date;
}

const DAY_MS = 86_400_000;

function daysBetween(aIso: string, bIso: string): number {
  return Math.max(0, Math.round((Date.parse(bIso) - Date.parse(aIso)) / DAY_MS));
}

/**
 * Jerarquía de niveles — mayor número = más robusto (ISO 31000).
 */
const LEVEL_RANK: Record<ActionLevel, number> = {
  elimination: 6,
  engineering: 5,
  administrative: 4,
  supervision: 3,
  training: 2,
  communication: 1,
  epp: 1,
};

function topLevel(actions: CorrectiveActionRef[]): ActionLevel | null {
  if (actions.length === 0) return null;
  return actions.reduce<ActionLevel>(
    (best, a) => (LEVEL_RANK[a.level] > LEVEL_RANK[best] ? a.level : best),
    actions[0]!.level,
  );
}

export function verifyEfficacy(
  input: VerifyEfficacyInput,
  options: VerifyOptions = {},
): EfficacyVerificationResult {
  const now = options.now ?? new Date();
  const windowDays = daysBetween(input.window.windowStart, input.window.windowEnd);
  const reasons: string[] = [];
  const reopenTriggers: string[] = [];

  // Codex P2 PR #127: si `now < windowEnd`, la ventana de observación no
  // ha terminado y NO debe retornar 'effective'. Forzamos veredicto
  // 'inconclusive' + recomendación extend_observation_window.
  const windowEndMs = Date.parse(input.window.windowEnd);
  const windowComplete = now.getTime() >= windowEndMs;

  // 1. Recurrencia en la misma ubicación / crew
  const recurrences = input.window.recurrenceIncidents;
  const sameLocationCount = recurrences.filter((r) => r.sameLocation).length;
  const sameCrewCount = recurrences.filter((r) => r.sameCrew).length;
  const escalatedSeverity = recurrences.some((r) => severityRank(r.severity) > severityRank(input.baseline.severity));

  // 2. Comparación de tasa
  const observedRate30d =
    (recurrences.length / Math.max(1, windowDays)) * 30;
  const improvementRatio =
    input.baseline.preIncidenceRate30d > 0
      ? (input.baseline.preIncidenceRate30d - observedRate30d) /
        input.baseline.preIncidenceRate30d
      : observedRate30d === 0
        ? 1
        : 0;

  // 3. Indicadores leading
  const leading = input.window.leadingIndicators;
  const hasOngoingVerifications = (leading.controlVerificationsCount ?? 0) > 0;

  // ── Score
  let score = 100;
  if (recurrences.length > 0) {
    // Codex P2 PR #127: cualquier reincidencia (aun sin location/crew/sev
    // match) debe sacar el score de la zona 'effective' (≥80). Bumpeamos
    // penalty a 25 por reincidencia para que 1 sola caída deje score=75.
    const penalty = Math.min(75, recurrences.length * 25);
    score -= penalty;
    reasons.push(`${recurrences.length} reincidencia(s) del mismo riesgo en la ventana.`);
    reopenTriggers.push(`recurrence:${recurrences.length}`);
  }
  if (sameLocationCount > 0) {
    score -= 10;
    reasons.push(`${sameLocationCount} reincidencia(s) en la misma ubicación.`);
    reopenTriggers.push('same_location');
  }
  if (sameCrewCount > 0) {
    score -= 5;
    reasons.push(`${sameCrewCount} reincidencia(s) con la misma cuadrilla.`);
  }
  if (escalatedSeverity) {
    score -= 20;
    reasons.push('Severidad escaló en al menos una reincidencia.');
    reopenTriggers.push('severity_escalated');
  }
  if (improvementRatio > 0.5 && recurrences.length === 0) {
    reasons.push(`Tasa bajó ${Math.round(improvementRatio * 100)}% vs baseline.`);
  }
  if (!hasOngoingVerifications) {
    score -= 5;
    reasons.push('Sin verificaciones periódicas del control registradas en la ventana.');
  }
  // Codex P2 PR #127: exceptionsRaised es un negative leading indicator
  // (desviaciones del control). Si hay >0 deben bajar el score aunque
  // no haya incidentes todavía.
  const exceptionsRaised = leading.exceptionsRaised ?? 0;
  if (exceptionsRaised > 0) {
    const exceptionsPenalty = Math.min(20, exceptionsRaised * 5);
    score -= exceptionsPenalty;
    reasons.push(`${exceptionsRaised} excepción(es)/desviación(es) al control en la ventana.`);
    reopenTriggers.push(`exceptions:${exceptionsRaised}`);
  }
  if (input.actions.length === 0) {
    // Codex P2 PR #127: sin acciones, extender la ventana no sirve —
    // hay que pedir reopen/repeat. Bajamos score por debajo del umbral
    // 'inconclusive' (30) para que la rama 'ineffective' se active.
    score = Math.min(score, 25);
    reasons.push('No hay acciones correctivas asociadas — no se puede medir eficacia.');
    reopenTriggers.push('no_actions_recorded');
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Codex P2 PR #127: si la ventana de observación aún no ha terminado,
  // forzamos 'inconclusive' independiente del score — un ratify
  // prematuro sería un bug grave (cierra una acción antes de saber si
  // funcionó). Aplica solo cuando NO hay señales tempranas malas.
  if (!windowComplete && score >= 80 && recurrences.length === 0 && exceptionsRaised === 0) {
    score = Math.min(score, 60);
    reasons.push('Ventana de observación todavía no se completa — veredicto preliminar inconclusive.');
    reopenTriggers.push('window_incomplete');
  }

  // ── Verdict
  let verdict: EfficacyVerdict;
  if (score >= 80) verdict = 'effective';
  else if (score >= 55) verdict = 'partially_effective';
  else if (score >= 30) verdict = 'inconclusive';
  else verdict = 'ineffective';

  // ── Recommendation
  let recommendation: EfficacyVerificationResult['recommendation'];
  const best = topLevel(input.actions);
  if (verdict === 'effective') {
    recommendation = 'ratify_close';
  } else if (verdict === 'partially_effective') {
    // Codex P2 PR #127: si severity escaló, investigar root cause
    // tiene prioridad sobre extender la ventana — el incidente empeoró
    // así que el plan original no atacó la causa real.
    if (escalatedSeverity) {
      recommendation = 'investigate_root_cause_again';
      reasons.push('Severidad escaló → causa raíz probablemente no era la real.');
    } else {
      recommendation = hasOngoingVerifications
        ? 'extend_observation_window'
        : 'reopen_repeat_action';
    }
  } else if (verdict === 'inconclusive') {
    // Codex P2 PR #127: sin acciones registradas, extender ventana no
    // resuelve nada — recomendar reopen para crear acciones.
    if (input.actions.length === 0) {
      recommendation = 'reopen_repeat_action';
    } else {
      recommendation = 'extend_observation_window';
    }
  } else {
    // ineffective
    if (best && LEVEL_RANK[best] < LEVEL_RANK.engineering) {
      recommendation = 'escalate_to_higher_level';
      reasons.push(
        `Acción más fuerte aplicada fue ${best}; subir a engineering/elimination.`,
      );
    } else if (escalatedSeverity) {
      recommendation = 'investigate_root_cause_again';
      reasons.push('Severidad escaló → causa raíz probablemente no era la real.');
    } else {
      recommendation = 'reopen_repeat_action';
    }
  }

  // ── Rationale one-liner
  const rationale =
    recurrences.length === 0
      ? `Sin reincidencias en ${windowDays} días desde el cierre.`
      : `${recurrences.length} reincidencia(s) detectada(s) en ${windowDays} días.`;

  return {
    verdict,
    score,
    rationale,
    recommendation,
    reasons,
    reopenTriggers,
    evaluatedAt: now.toISOString(),
    windowDays,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function severityRank(s: BaselineIncidentSnapshot['severity']): number {
  return { low: 1, medium: 2, high: 3, critical: 4, sif: 5 }[s];
}

/**
 * Construye la ventana default (30 días desde el cierre de la última
 * acción) — caller puede acortar/alargar si su política lo exige.
 */
export function defaultPostActionWindow(
  closedAt: string,
  recurrences: PostActionWindow['recurrenceIncidents'] = [],
  leading: PostActionWindow['leadingIndicators'] = {},
  windowDays = 30,
): PostActionWindow {
  const start = Date.parse(closedAt);
  const end = new Date(start + windowDays * DAY_MS).toISOString();
  return {
    windowStart: closedAt,
    windowEnd: end,
    recurrenceIncidents: recurrences,
    leadingIndicators: leading,
  };
}
