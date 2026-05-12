// Praeventio Guard — Sprint K: Carga mental + Carga administrativa + Automatizador admin.
//
// Cierra: Documento usuario "§258-260"
//
// Mide la carga mental de los trabajadores (NASA-TLX adaptado) +
// detecta carga administrativa excesiva (formularios, firmas, reportes)
// que el sistema puede automatizar.
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// NASA-TLX adapted (§258)
// ────────────────────────────────────────────────────────────────────────

export interface MentalLoadSurvey {
  workerUid: string;
  /** Cada dimensión 0-100. */
  mentalDemand: number;       // mental demand
  physicalDemand: number;     // physical demand
  temporalDemand: number;     // urgencia / tiempo
  effort: number;             // esfuerzo total
  frustration: number;        // frustración
  performance: number;        // rendimiento percibido (invertido: alto = peor)
  surveyedAt: string;
}

export interface MentalLoadScore {
  workerUid: string;
  /** TLX promedio (0-100). */
  overallLoad: number;
  level: 'low' | 'moderate' | 'high' | 'critical';
  /** Dimensión dominante. */
  dominantFactor: keyof Omit<MentalLoadSurvey, 'workerUid' | 'surveyedAt'>;
  /** Recomendaciones. */
  recommendations: string[];
}

export function scoreMentalLoad(survey: MentalLoadSurvey): MentalLoadScore {
  const dims = {
    mentalDemand: survey.mentalDemand,
    physicalDemand: survey.physicalDemand,
    temporalDemand: survey.temporalDemand,
    effort: survey.effort,
    frustration: survey.frustration,
    performance: survey.performance,
  };
  // Promedio ponderado (TLX clásico pondera por participante; aquí
  // simplificamos a promedio equal-weight para PYME).
  const overallLoad = Math.round(
    Object.values(dims).reduce((s, v) => s + v, 0) / Object.keys(dims).length,
  );

  let level: MentalLoadScore['level'];
  if (overallLoad >= 75) level = 'critical';
  else if (overallLoad >= 55) level = 'high';
  else if (overallLoad >= 35) level = 'moderate';
  else level = 'low';

  const entries = Object.entries(dims) as Array<[keyof typeof dims, number]>;
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const dominantFactor = sorted[0][0];

  const recommendations: string[] = [];
  if (dominantFactor === 'frustration' && dims.frustration > 60) {
    recommendations.push('Frustración alta — investigar fuente (procesos, jefatura, recursos).');
  }
  if (dominantFactor === 'temporalDemand' && dims.temporalDemand > 70) {
    recommendations.push('Presión de tiempo alta — revisar planificación + recursos.');
  }
  if (dominantFactor === 'physicalDemand' && dims.physicalDemand > 70) {
    recommendations.push('Carga física alta — revisar ergonomía / rotación tareas.');
  }
  if (level === 'critical') {
    recommendations.push('Conversación 1:1 con jefatura preventiva inmediatamente.');
  }

  return {
    workerUid: survey.workerUid,
    overallLoad,
    level,
    dominantFactor,
    recommendations,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Administrative burden (§259-260)
// ────────────────────────────────────────────────────────────────────────

export type AdminTaskKind =
  | 'form_filling'
  | 'signature_request'
  | 'document_upload'
  | 'meeting'
  | 'report_writing'
  | 'data_entry'
  | 'approval_chase';

export interface AdminTaskTime {
  workerUid: string;
  kind: AdminTaskKind;
  /** Minutos por semana dedicados a este tipo. */
  minutesPerWeek: number;
}

export interface AdminBurdenReport {
  workerUid: string;
  totalAdminMinutesPerWeek: number;
  /** % de jornada (45h = 2700min) en admin. */
  adminLoadPercent: number;
  level: 'healthy' | 'high' | 'excessive';
  /** Sugerencias de automatización. */
  automationCandidates: Array<{ kind: AdminTaskKind; minutesPerWeek: number; estimatedSaving: number }>;
}

const AUTOMATION_SAVINGS: Record<AdminTaskKind, number> = {
  form_filling: 0.7, // 70% ahorro con templates
  signature_request: 0.5,
  document_upload: 0.8,
  meeting: 0.2,
  report_writing: 0.6,
  data_entry: 0.85,
  approval_chase: 0.6,
};

const FULL_WEEK_MINUTES = 45 * 60; // 2700

export function buildAdminBurdenReport(tasks: AdminTaskTime[], workerUid: string): AdminBurdenReport {
  const own = tasks.filter((t) => t.workerUid === workerUid);
  const totalAdminMinutesPerWeek = own.reduce((s, t) => s + t.minutesPerWeek, 0);
  const adminLoadPercent = Math.round((totalAdminMinutesPerWeek / FULL_WEEK_MINUTES) * 100);

  let level: 'healthy' | 'high' | 'excessive';
  if (adminLoadPercent < 25) level = 'healthy';
  else if (adminLoadPercent < 40) level = 'high';
  else level = 'excessive';

  const automationCandidates = own
    .map((t) => ({
      kind: t.kind,
      minutesPerWeek: t.minutesPerWeek,
      estimatedSaving: Math.round(t.minutesPerWeek * AUTOMATION_SAVINGS[t.kind]),
    }))
    .filter((c) => c.estimatedSaving >= 30) // mínimo 30 min ahorro/sem
    .sort((a, b) => b.estimatedSaving - a.estimatedSaving);

  return {
    workerUid,
    totalAdminMinutesPerWeek,
    adminLoadPercent,
    level,
    automationCandidates,
  };
}
