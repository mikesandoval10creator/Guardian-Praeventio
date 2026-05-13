// Praeventio Guard — Sprint 49 §251-253: Return-to-Work + Restricciones
// por tarea + Derivación mutualidad.
//
// Cierra §251 (datos sensibles médicos separados ya cubierto en §125-128),
// §252 (derivación mutualidad post-incidente), §253 (reintegro tras
// ausencia) y §254 (restricciones por tarea = task fit assessment) de
// la 2da tanda usuario.
//
// 100% determinístico. Motor puro que toma snapshots y produce planes.
//
// ADR 0012: este motor NO contiene datos médicos sensibles (diagnóstico,
// PHI). Solo trabaja con `restrictionTags` codificadas (tier OPERATIONAL).
// El médico tratante mantiene el diagnóstico fuera de este sistema.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Restricciones operacionales — vocabulario CERRADO codificado.
 * Cada tag representa una limitación que el supervisor puede mapear a
 * tareas, SIN exponer la causa médica subyacente. ADR 0012 compliant.
 */
export type RestrictionTag =
  // Físicas
  | 'no_lifting_above_10kg'
  | 'no_lifting_above_25kg'
  | 'no_repetitive_movement_hand'
  | 'no_repetitive_movement_shoulder'
  | 'no_prolonged_standing'
  | 'no_prolonged_sitting'
  | 'no_squatting'
  | 'no_kneeling'
  | 'no_overhead_work'
  // Ambientales
  | 'no_height_work'         // vértigo, post-trauma altura, embarazo
  | 'no_confined_spaces'     // ansiedad, claustrofobia, post-incidente
  | 'no_extreme_temperature' // hot/cold sensitivity
  | 'no_high_noise'          // hipoacusia
  | 'no_chemical_exposure'   // alergias, embarazo
  | 'no_vibration_exposure'
  | 'no_uv_extreme'
  // Cognitivas / horarias
  | 'no_night_shift'
  | 'no_isolated_work'       // depresión, post-incidente psicosocial
  | 'no_decision_under_pressure' // post-burnout, recovery cognitivo
  | 'no_driving'             // medicación sedante, post-convulsión
  | 'reduced_hours'          // gradual reintegration
  // Otras
  | 'requires_buddy'         // segundo trabajador presente siempre
  | 'requires_frequent_breaks';

export interface WorkerRestriction {
  workerUid: string;
  tag: RestrictionTag;
  /** ISO-8601 — desde cuándo aplica. */
  startsAt: string;
  /** ISO-8601 — hasta cuándo (puede ser "indefinite" → null). */
  expiresAt?: string;
  /** Fuente: orden médica, autocertificación, observación supervisor. */
  source: 'mutual_doctor_order' | 'company_doctor_order' | 'self_reported' | 'supervisor_observation';
  /** ID del documento de respaldo (medical_order). NUNCA descripción médica. */
  evidenceDocId?: string;
  /** Si requiere revisión periódica del médico para mantener vigencia. */
  requiresReview?: boolean;
  /** Cuántos días entre reviews. */
  reviewIntervalDays?: number;
}

export interface TaskRequirements {
  taskId: string;
  /** Restricciones que la tarea CHOCA con. Si trabajador tiene alguna → no apto. */
  conflictsWith: RestrictionTag[];
  /** Carga física estimada (1-5). */
  physicalLoad?: 1 | 2 | 3 | 4 | 5;
  /** Carga cognitiva estimada. */
  cognitiveLoad?: 1 | 2 | 3 | 4 | 5;
  /** Duración esperada en min. */
  estimatedMinutes?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Task fit assessment
// ────────────────────────────────────────────────────────────────────────

export type TaskFit = 'fit' | 'fit_with_accommodation' | 'unfit' | 'requires_medical_review';

export interface TaskFitAssessment {
  workerUid: string;
  taskId: string;
  fit: TaskFit;
  /** Restricciones violadas (vacío si fit). */
  violatedRestrictions: RestrictionTag[];
  /** Accommodations sugeridas (buddy, breaks, reducción tiempo). */
  suggestedAccommodations: string[];
  /** Razones legibles para el supervisor (sin info médica). */
  rationale: string;
}

export function assessTaskFit(
  workerRestrictions: ReadonlyArray<WorkerRestriction>,
  task: TaskRequirements,
  now: Date,
): TaskFitAssessment {
  const nowMs = now.getTime();
  // Filter to active restrictions
  const active = workerRestrictions.filter((r) => {
    if (Date.parse(r.startsAt) > nowMs) return false;
    if (r.expiresAt && Date.parse(r.expiresAt) < nowMs) return false;
    return true;
  });

  const violatedRestrictions: RestrictionTag[] = [];
  for (const r of active) {
    if (task.conflictsWith.includes(r.tag)) {
      violatedRestrictions.push(r.tag);
    }
  }

  const workerUid = workerRestrictions[0]?.workerUid ?? '';

  // Suggest accommodations
  const suggested: string[] = [];
  const allTags = new Set(active.map((r) => r.tag));
  if (allTags.has('requires_buddy') && !violatedRestrictions.length) {
    suggested.push('Asignar segundo trabajador como buddy (acompañamiento)');
  }
  if (allTags.has('reduced_hours')) {
    suggested.push('Reducir jornada a 50-75% durante reintegración progresiva');
  }
  if (allTags.has('requires_frequent_breaks')) {
    suggested.push('Pausas activas cada 60-90 min mínimo');
  }

  if (violatedRestrictions.length === 0) {
    return {
      workerUid,
      taskId: task.taskId,
      fit: suggested.length > 0 ? 'fit_with_accommodation' : 'fit',
      violatedRestrictions: [],
      suggestedAccommodations: suggested,
      rationale: suggested.length > 0
        ? 'Trabajador apto con acomodaciones recomendadas.'
        : 'Trabajador apto sin restricciones aplicables a esta tarea.',
    };
  }

  // ¿Hay restricciones que requieren medical_review (sin reviewIntervalDays cumplido)?
  const needsReview = active.some((r) => {
    if (!r.requiresReview) return false;
    const lastReviewMs = Date.parse(r.startsAt);
    const interval = (r.reviewIntervalDays ?? 30) * 86_400_000;
    return nowMs - lastReviewMs > interval;
  });

  if (needsReview) {
    return {
      workerUid,
      taskId: task.taskId,
      fit: 'requires_medical_review',
      violatedRestrictions,
      suggestedAccommodations: suggested,
      rationale: 'Restricción requiere revisión médica para confirmar vigencia antes de asignar.',
    };
  }

  return {
    workerUid,
    taskId: task.taskId,
    fit: 'unfit',
    violatedRestrictions,
    suggestedAccommodations: suggested,
    rationale: `Tarea entra en conflicto con ${violatedRestrictions.length} restricción(es) vigente(s) del trabajador.`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Derivación a mutualidad (post-incidente)
// ────────────────────────────────────────────────────────────────────────

export type MutualityDerivationReason =
  | 'work_injury'
  | 'occupational_disease_suspected'
  | 'commute_accident'
  | 'psychosocial_event'
  | 'periodic_medical_check_due';

export interface MutualityDerivation {
  workerUid: string;
  incidentId?: string;
  reason: MutualityDerivationReason;
  /** Mutualidad asignada (Achs, IST, Mutual, ISL). Caller resuelve desde
   *  enrolment del worker. */
  mutuality: 'achs' | 'ist' | 'mutual' | 'isl';
  /** Cuándo se debe presentar el trabajador. */
  scheduledFor: string;
  /** Si urgent → ambulancia/traslado inmediato. */
  urgency: 'emergency' | 'urgent' | 'routine';
  /** Folio del DIAT/DIEP asociado (si se generó). */
  associatedFolio?: string;
}

export interface DerivationDecisionInput {
  workerUid: string;
  workerMutuality: MutualityDerivation['mutuality'];
  incidentSeverity?: 'low' | 'medium' | 'high' | 'critical' | 'sif';
  incidentKind?: 'fall' | 'cut' | 'burn' | 'crush' | 'chemical' | 'electric' | 'psychological' | 'other';
  commuteEvent?: boolean;
  workerHasLostTime?: boolean;
  occupationalSuspicion?: boolean;
}

export function decideDerivation(
  input: DerivationDecisionInput,
  now: Date,
): MutualityDerivation {
  let reason: MutualityDerivationReason;
  let urgency: MutualityDerivation['urgency'];

  if (input.commuteEvent) {
    reason = 'commute_accident';
    urgency = input.incidentSeverity === 'critical' || input.incidentSeverity === 'sif' ? 'emergency' : 'urgent';
  } else if (input.occupationalSuspicion) {
    reason = 'occupational_disease_suspected';
    urgency = 'routine';
  } else if (input.incidentSeverity === 'sif' || input.incidentSeverity === 'critical') {
    reason = 'work_injury';
    urgency = 'emergency';
  } else if (input.workerHasLostTime || input.incidentSeverity === 'high' || input.incidentSeverity === 'medium') {
    reason = 'work_injury';
    urgency = 'urgent';
  } else if (input.incidentKind === 'psychological') {
    reason = 'psychosocial_event';
    urgency = 'urgent';
  } else {
    reason = 'work_injury';
    urgency = 'routine';
  }

  // Schedule: emergency = ahora, urgent = +2h, routine = +24h
  const offsetMs =
    urgency === 'emergency'
      ? 0
      : urgency === 'urgent'
        ? 2 * 3_600_000
        : 24 * 3_600_000;

  return {
    workerUid: input.workerUid,
    reason,
    mutuality: input.workerMutuality,
    scheduledFor: new Date(now.getTime() + offsetMs).toISOString(),
    urgency,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Return-to-work plan
// ────────────────────────────────────────────────────────────────────────

export interface ReturnToWorkPlan {
  workerUid: string;
  absenceFrom: string;
  absenceTo: string;
  /** Días totales fuera. */
  absenceDays: number;
  /** Tipo de ausencia. */
  absenceKind: 'sick_leave' | 'work_injury_leave' | 'maternity' | 'personal' | 'other';
  /** Restricciones activas al volver. */
  activeRestrictions: WorkerRestriction[];
  /** Plan progresivo (semanas + carga %). */
  progressiveSchedule: Array<{ weekFromReturn: number; loadPct: number; tasksAllowed: string[] }>;
  /** Si requiere reevaluación a las N semanas. */
  reassessmentInWeeks: number;
  /** Acomodaciones agregadas que el supervisor debe implementar. */
  accommodations: string[];
}

export interface BuildRtwPlanInput {
  workerUid: string;
  absenceFrom: string;
  absenceTo: string;
  absenceKind: ReturnToWorkPlan['absenceKind'];
  activeRestrictions: WorkerRestriction[];
}

const DAY_MS = 86_400_000;

export function buildReturnToWorkPlan(input: BuildRtwPlanInput): ReturnToWorkPlan {
  const absenceFromMs = Date.parse(input.absenceFrom);
  const absenceToMs = Date.parse(input.absenceTo);
  const absenceDays = Math.max(0, Math.round((absenceToMs - absenceFromMs) / DAY_MS));

  // Schedule based on absence length
  let progressive: ReturnToWorkPlan['progressiveSchedule'];
  let reassessmentInWeeks: number;

  if (absenceDays < 7) {
    // Short — vuelta normal en semana 1
    progressive = [{ weekFromReturn: 1, loadPct: 100, tasksAllowed: ['all_low_risk'] }];
    reassessmentInWeeks = 2;
  } else if (absenceDays < 30) {
    // Medium — 2 semanas progresivas
    progressive = [
      { weekFromReturn: 1, loadPct: 50, tasksAllowed: ['low_risk_only'] },
      { weekFromReturn: 2, loadPct: 80, tasksAllowed: ['low_risk_only', 'medium_risk_with_buddy'] },
      { weekFromReturn: 3, loadPct: 100, tasksAllowed: ['all_low_medium'] },
    ];
    reassessmentInWeeks = 4;
  } else {
    // Long — 4-6 semanas progresivas
    progressive = [
      { weekFromReturn: 1, loadPct: 25, tasksAllowed: ['observation_only'] },
      { weekFromReturn: 2, loadPct: 50, tasksAllowed: ['low_risk_only'] },
      { weekFromReturn: 4, loadPct: 75, tasksAllowed: ['low_risk_only', 'medium_risk_with_buddy'] },
      { weekFromReturn: 6, loadPct: 100, tasksAllowed: ['all_within_restrictions'] },
    ];
    reassessmentInWeeks = 8;
  }

  // Build accommodations list from restrictions
  const accommodations: string[] = [];
  const tags = new Set(input.activeRestrictions.map((r) => r.tag));
  if (tags.has('requires_buddy')) accommodations.push('Buddy permanente durante reintegración.');
  if (tags.has('requires_frequent_breaks')) accommodations.push('Pausas cada 60min mínimo.');
  if (tags.has('reduced_hours')) accommodations.push('Jornada reducida según schedule progresivo.');
  if (tags.has('no_night_shift')) accommodations.push('Solo turnos diurnos.');
  if (tags.has('no_height_work') || tags.has('no_confined_spaces')) {
    accommodations.push('Reasignar a tareas en zona segura (ground-level, espacios abiertos).');
  }
  if (tags.has('no_isolated_work')) {
    accommodations.push('Evitar trabajo aislado (al menos un compañero en línea de vista).');
  }
  if (input.absenceKind === 'work_injury_leave') {
    accommodations.push('Refuerzo psicosocial: check-in supervisor semana 1 + bienestar laboral.');
  }

  return {
    workerUid: input.workerUid,
    absenceFrom: input.absenceFrom,
    absenceTo: input.absenceTo,
    absenceDays,
    absenceKind: input.absenceKind,
    activeRestrictions: input.activeRestrictions,
    progressiveSchedule: progressive,
    reassessmentInWeeks,
    accommodations,
  };
}
