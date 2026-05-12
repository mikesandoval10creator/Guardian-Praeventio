// Praeventio Guard — Sprint K: Ritmo circadiano + Sueño + Carga mental.
//
// Cierra: Documento usuario "§256-257"
//
// Detecta cuándo un trabajador está en su "ventana de menor alerta"
// (madrugada 2-6am) y combinado con horas de sueño previo + carga
// mental, recomienda ajustes.
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type CircadianWindow = 'peak' | 'optimal' | 'declining' | 'low_alert' | 'recovery';

export interface CircadianInput {
  /** Hora local (0-23). */
  localHour: number;
  /** Horas dormidas las últimas 24h. */
  sleepHoursLast24h: number;
  /** Días consecutivos en turno nocturno (0 si día). */
  consecutiveNightShifts: number;
  /** Carga mental subjetiva (1-10). */
  mentalLoadRating?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Circadian window
// ────────────────────────────────────────────────────────────────────────

export function classifyCircadianWindow(localHour: number): CircadianWindow {
  // Ventanas basadas en literatura NIOSH:
  //   2-6am: low_alert (mayor riesgo accidentes)
  //   6-9am: recovery
  //   9-12pm: peak
  //   12-15h: declining (post-lunch dip)
  //   15-18h: optimal
  //   18-22h: declining
  //   22-2am: low_alert
  if (localHour >= 2 && localHour < 6) return 'low_alert';
  if (localHour >= 6 && localHour < 9) return 'recovery';
  if (localHour >= 9 && localHour < 12) return 'peak';
  if (localHour >= 12 && localHour < 15) return 'declining';
  if (localHour >= 15 && localHour < 18) return 'optimal';
  if (localHour >= 18 && localHour < 22) return 'declining';
  return 'low_alert';
}

// ────────────────────────────────────────────────────────────────────────
// Fatigue/alertness scoring
// ────────────────────────────────────────────────────────────────────────

export interface AlertnessReport {
  window: CircadianWindow;
  /** Score 0-100 (mayor = más alerta). */
  alertnessScore: number;
  level: 'high' | 'moderate' | 'low' | 'critical';
  recommendations: string[];
  /** True si NO se recomienda operación de equipos críticos. */
  blockCriticalOps: boolean;
}

const WINDOW_BASELINE: Record<CircadianWindow, number> = {
  peak: 90,
  optimal: 80,
  recovery: 60,
  declining: 50,
  low_alert: 25,
};

export function assessAlertness(input: CircadianInput): AlertnessReport {
  const window = classifyCircadianWindow(input.localHour);
  let score = WINDOW_BASELINE[window];

  // Penalización por sueño insuficiente
  if (input.sleepHoursLast24h < 4) score -= 30;
  else if (input.sleepHoursLast24h < 6) score -= 15;
  else if (input.sleepHoursLast24h < 7) score -= 5;

  // Penalización por turnos nocturnos consecutivos
  if (input.consecutiveNightShifts >= 5) score -= 20;
  else if (input.consecutiveNightShifts >= 3) score -= 10;
  else if (input.consecutiveNightShifts >= 1) score -= 5;

  // Penalización por carga mental alta
  if (input.mentalLoadRating !== undefined) {
    if (input.mentalLoadRating >= 8) score -= 15;
    else if (input.mentalLoadRating >= 6) score -= 5;
  }

  score = Math.max(0, Math.min(100, score));

  let level: 'high' | 'moderate' | 'low' | 'critical';
  if (score >= 70) level = 'high';
  else if (score >= 50) level = 'moderate';
  else if (score >= 30) level = 'low';
  else level = 'critical';

  const recommendations: string[] = [];
  if (window === 'low_alert') {
    recommendations.push('Ventana de baja alerta circadiana — supervisar tareas críticas.');
  }
  if (input.sleepHoursLast24h < 6) {
    recommendations.push(`Sueño insuficiente (${input.sleepHoursLast24h}h). Recomendar descanso adicional.`);
  }
  if (input.consecutiveNightShifts >= 5) {
    recommendations.push(`${input.consecutiveNightShifts} turnos nocturnos consecutivos — rotación urgente.`);
  }
  if (level === 'critical') {
    recommendations.push('NO autorizar operación de equipos críticos. Asignar tarea de baja exigencia.');
  }

  return {
    window,
    alertnessScore: score,
    level,
    recommendations,
    blockCriticalOps: level === 'critical' || level === 'low',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Shift schedule recommender
// ────────────────────────────────────────────────────────────────────────

export interface ShiftWorker {
  workerUid: string;
  /** Días consecutivos en turno actual. */
  currentShiftDays: number;
  /** Tipo de turno actual. */
  currentShiftKind: 'day' | 'night' | 'rotative';
  /** Horas trabajadas semana actual. */
  hoursWorkedWeek: number;
}

export interface ShiftRotationRecommendation {
  workerUid: string;
  needsRotation: boolean;
  reasons: string[];
  /** Días máximos sugeridos antes de rotar. */
  daysUntilForceRotation: number;
}

const MAX_CONSECUTIVE_NIGHT_SHIFTS = 7;
const MAX_HOURS_WEEK_LEGAL = 45; // Chile Ley 21.561

export function recommendShiftRotation(worker: ShiftWorker): ShiftRotationRecommendation {
  const reasons: string[] = [];
  if (worker.currentShiftKind === 'night' && worker.currentShiftDays >= MAX_CONSECUTIVE_NIGHT_SHIFTS) {
    reasons.push(`${worker.currentShiftDays} días consecutivos en turno nocturno (máximo recomendado: ${MAX_CONSECUTIVE_NIGHT_SHIFTS}).`);
  }
  if (worker.hoursWorkedWeek > MAX_HOURS_WEEK_LEGAL) {
    reasons.push(`Horas trabajadas semana (${worker.hoursWorkedWeek}) supera máximo legal ${MAX_HOURS_WEEK_LEGAL}h.`);
  }
  const daysUntilForceRotation = Math.max(
    0,
    MAX_CONSECUTIVE_NIGHT_SHIFTS - worker.currentShiftDays,
  );
  return {
    workerUid: worker.workerUid,
    needsRotation: reasons.length > 0,
    reasons,
    daysUntilForceRotation,
  };
}
