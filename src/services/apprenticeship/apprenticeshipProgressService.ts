// Praeventio Guard — Sprint K: Aprendices + Mentoría + Autorización Progresiva.
//
// Cierra: Documento usuario "§244-250"
//
// Los aprendices y trabajadores nuevos NO deben tener el mismo nivel de
// autonomía que un veterano. Este motor:
//   - Trackea las tareas que un aprendiz puede ejecutar sin supervisión
//   - Asocia mentor para cada aprendiz
//   - Maneja autorización progresiva (tarea → solo con mentor → autónomo)
//   - Reporta exposición a tareas repetitivas (riesgo músculo-esquelético)
//   - Maneja rotación de tareas para reducir exposición
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type AuthorizationLevel = 'observer' | 'supervised' | 'autonomous';

export interface ApprenticeProfile {
  workerUid: string;
  /** UID del mentor asignado. */
  mentorUid: string;
  /** Fecha de ingreso al programa. */
  startedAt: string;
  /** Mapa de tarea → nivel de autorización actual. */
  taskAuthorizations: Record<string, AuthorizationLevel>;
  /** Días estimados para alcanzar autonomous (default 90). */
  programDays?: number;
}

export interface TaskExecutionLog {
  workerUid: string;
  taskId: string;
  executedAt: string;
  /** Si fue ejecutado con mentor presente. */
  withMentor: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Authorization decisions
// ────────────────────────────────────────────────────────────────────────

export interface ExecutionDecision {
  workerUid: string;
  taskId: string;
  allowed: boolean;
  reason: string;
  requiresMentor: boolean;
}

export function canExecuteTask(
  profile: ApprenticeProfile,
  taskId: string,
  mentorAvailable: boolean,
): ExecutionDecision {
  const level = profile.taskAuthorizations[taskId];
  if (!level || level === 'observer') {
    return {
      workerUid: profile.workerUid,
      taskId,
      allowed: false,
      reason: 'Trabajador en nivel observador para esta tarea. No puede ejecutar.',
      requiresMentor: false,
    };
  }
  if (level === 'supervised') {
    return {
      workerUid: profile.workerUid,
      taskId,
      allowed: mentorAvailable,
      reason: mentorAvailable
        ? 'Aprendiz puede ejecutar con mentor presente.'
        : 'Aprendiz requiere mentor presente y no está disponible.',
      requiresMentor: true,
    };
  }
  return {
    workerUid: profile.workerUid,
    taskId,
    allowed: true,
    reason: 'Trabajador autorizado autonomamente.',
    requiresMentor: false,
  };
}

/**
 * Propone subir nivel cuando el aprendiz ha ejecutado suficientes veces
 * con mentor sin incidentes. Regla canónica:
 *   - observer → supervised tras 5 ejecuciones observadas
 *   - supervised → autonomous tras 10 ejecuciones con mentor sin incidentes
 */
export interface LevelUpProposal {
  workerUid: string;
  taskId: string;
  fromLevel: AuthorizationLevel;
  toLevel: AuthorizationLevel;
  ready: boolean;
  rationale: string;
}

export function proposeLevelUp(
  profile: ApprenticeProfile,
  taskId: string,
  executions: TaskExecutionLog[],
): LevelUpProposal | null {
  const current = profile.taskAuthorizations[taskId] ?? 'observer';
  const own = executions.filter(
    (e) => e.workerUid === profile.workerUid && e.taskId === taskId,
  );

  if (current === 'observer') {
    const ready = own.length >= 5;
    return {
      workerUid: profile.workerUid,
      taskId,
      fromLevel: 'observer',
      toLevel: 'supervised',
      ready,
      rationale: ready
        ? `${own.length} ejecuciones observadas, listo para fase supervisada.`
        : `Necesita ${5 - own.length} ejecuciones más como observador.`,
    };
  }
  if (current === 'supervised') {
    const withMentor = own.filter((e) => e.withMentor).length;
    const ready = withMentor >= 10;
    return {
      workerUid: profile.workerUid,
      taskId,
      fromLevel: 'supervised',
      toLevel: 'autonomous',
      ready,
      rationale: ready
        ? `${withMentor} ejecuciones con mentor sin incidentes, listo para autonomía.`
        : `Necesita ${10 - withMentor} ejecuciones más con mentor.`,
    };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Repetitive task exposure (§246-247)
// ────────────────────────────────────────────────────────────────────────

export interface RepetitiveExposureInput {
  workerUid: string;
  /** Tarea → minutos ejecutados en la última semana. */
  taskMinutesLastWeek: Record<string, number>;
  /** Umbral max minutos / semana en una sola tarea. */
  thresholdMinutes?: number;
}

export interface RepetitiveExposureReport {
  workerUid: string;
  totalMinutes: number;
  /** Tareas que superan umbral. */
  overexposedTasks: Array<{ taskId: string; minutes: number }>;
  /** % de la jornada concentrado en 1 tarea. */
  topTaskShare: number;
  /** Recomendar rotación de tareas. */
  shouldRotate: boolean;
}

const DEFAULT_THRESHOLD = 1200; // 20h/sem = 50% jornada típica

export function assessRepetitiveExposure(input: RepetitiveExposureInput): RepetitiveExposureReport {
  const threshold = input.thresholdMinutes ?? DEFAULT_THRESHOLD;
  const entries = Object.entries(input.taskMinutesLastWeek);
  const totalMinutes = entries.reduce((s, [, m]) => s + m, 0);
  const overexposedTasks = entries
    .filter(([, m]) => m > threshold)
    .map(([taskId, minutes]) => ({ taskId, minutes }));
  const topMinutes = entries.reduce((max, [, m]) => Math.max(max, m), 0);
  const topTaskShare = totalMinutes > 0 ? Math.round((topMinutes / totalMinutes) * 100) : 0;
  return {
    workerUid: input.workerUid,
    totalMinutes,
    overexposedTasks,
    topTaskShare,
    shouldRotate: overexposedTasks.length > 0 || topTaskShare > 70,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Medical referral (§253)
// ────────────────────────────────────────────────────────────────────────

export type MedicalReferralReason =
  | 'occupational_disease_suspected'
  | 'work_related_injury'
  | 'fitness_evaluation'
  | 'reintegration_assessment';

export interface MedicalReferral {
  id: string;
  workerUid: string;
  referredAt: string;
  reason: MedicalReferralReason;
  /** Mutualidad receptora. */
  mutualidadId: string;
  /** ISO-8601 retorno esperado. */
  expectedReturnAt?: string;
  /** Restricciones definitivas tras evaluación. */
  permanentRestrictions?: string[];
}

export interface ReintegrationPlan {
  workerUid: string;
  restrictedTasks: string[];
  /** Tareas que SI puede ejecutar. */
  allowedTasks: string[];
  /** Si requiere ajuste de horario. */
  scheduleAdjustment: boolean;
  rationale: string;
}

export function buildReintegrationPlan(
  referral: MedicalReferral,
  candidateTasks: string[],
  taskRequirements: Record<string, string[]>,
): ReintegrationPlan {
  const restrictions = referral.permanentRestrictions ?? [];
  const restrictedTasks: string[] = [];
  const allowedTasks: string[] = [];

  for (const task of candidateTasks) {
    const reqs = taskRequirements[task] ?? [];
    const conflicts = reqs.some((r) =>
      restrictions.some((res) => res.toLowerCase().includes(r.toLowerCase())),
    );
    if (conflicts) restrictedTasks.push(task);
    else allowedTasks.push(task);
  }

  const scheduleAdjustment =
    referral.reason === 'occupational_disease_suspected' ||
    referral.reason === 'reintegration_assessment';

  return {
    workerUid: referral.workerUid,
    restrictedTasks,
    allowedTasks,
    scheduleAdjustment,
    rationale: `Restricciones: ${restrictions.length} | tareas evaluadas: ${candidateTasks.length} | aptas: ${allowedTasks.length} | restringidas: ${restrictedTasks.length}`,
  };
}
