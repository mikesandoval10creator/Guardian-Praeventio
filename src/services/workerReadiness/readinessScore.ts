// Praeventio Guard — Sprint 41 Fase F.16: Score Preparación Trabajador.
//
// Cierra Plan F.16 "Score Preparación Trabajador (no bloquea, asiste)".
//
// Calcula un score 0-100 de qué tan preparado está un trabajador para
// ejecutar una tarea específica, basado en:
//   - Trainings vigentes vs requeridos
//   - EPP entregado vs requerido
//   - Aptitud médica vigente
//   - Documentos firmados (DDR, ODI, RIOHS)
//   - Experiencia en categoría de tarea
//   - Fatiga (si hay señal de fatigueMonitor)
//
// SOLO ASISTE — NO BLOQUEA. El score se muestra al supervisor para
// que decida con criterio. Directiva 2 usuario respetada.
//
// 100% determinístico. Sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface TaskRequirements {
  /** Trainings requeridos para la tarea (codes). */
  requiredTrainings: string[];
  /** EPP categorías requeridas (e.g. 'arnés', 'casco', 'guantes'). */
  requiredEpp: string[];
  /** Categoría de tarea (para experiencia). */
  taskCategory: string;
  /** Si requiere aptitud médica vigente. */
  requiresMedicalAptitude: boolean;
  /** Documentos clave que deben estar firmados. */
  requiredAcknowledgements: string[];
}

export interface WorkerProfile {
  workerUid: string;
  /** Trainings vigentes (no expirados). */
  activeTrainings: string[];
  /** EPP entregado y vigente. */
  activeEpp: string[];
  /** Aptitud médica: 'vigente' | 'expirada' | 'restringida' | 'sin_aptitud'. */
  medicalAptitudeStatus: 'vigente' | 'expirada' | 'restringida' | 'sin_aptitud';
  /** Documentos firmados (recepción confirmada). */
  signedDocuments: string[];
  /** Cuántas tareas de la misma categoría completó (proxy de experiencia). */
  taskCategoryExperienceCount: number;
  /** Estado de fatiga actual. */
  fatigueLevel: 'low' | 'moderate' | 'high' | 'critical';
  /** Días desde último incidente (más = mejor). */
  daysSinceLastIncident: number;
}

export interface ReadinessGap {
  kind:
    | 'missing_training'
    | 'missing_epp'
    | 'medical_aptitude'
    | 'missing_doc'
    | 'fatigue'
    | 'experience'
    /**
     * Codex PR #315 round-2 P2: incident-recency gap. Emitted when
     * `daysSinceLastIncident < 60`; reduces total score by a graduated
     * penalty proportional to how recent the incident was.
     */
    | 'incident_recency';
  description: string;
  weight: number;
  /** Sugerencia de cómo cerrar el gap. */
  recommendation: string;
}

export interface ReadinessReport {
  workerUid: string;
  taskCategory: string;
  score: number; // 0-100
  level: 'ready' | 'minor_gaps' | 'major_gaps' | 'critical_gaps';
  gaps: ReadinessGap[];
  /** Sugerencias accionables priorizadas. */
  recommendations: string[];
  /** Detalle de sub-componentes. */
  subScores: {
    trainings: number; // 0-25
    epp: number; // 0-20
    medical: number; // 0-15
    documents: number; // 0-10
    experience: number; // 0-15
    fatigue: number; // 0-15
  };
}

// ────────────────────────────────────────────────────────────────────────
// Sub-scoring
// ────────────────────────────────────────────────────────────────────────

function scoreTrainings(profile: WorkerProfile, req: TaskRequirements): { score: number; missing: string[] } {
  if (req.requiredTrainings.length === 0) return { score: 25, missing: [] };
  const missing = req.requiredTrainings.filter((t) => !profile.activeTrainings.includes(t));
  const score = Math.round(((req.requiredTrainings.length - missing.length) / req.requiredTrainings.length) * 25);
  return { score, missing };
}

function scoreEpp(profile: WorkerProfile, req: TaskRequirements): { score: number; missing: string[] } {
  if (req.requiredEpp.length === 0) return { score: 20, missing: [] };
  const missing = req.requiredEpp.filter((e) => !profile.activeEpp.includes(e));
  const score = Math.round(((req.requiredEpp.length - missing.length) / req.requiredEpp.length) * 20);
  return { score, missing };
}

function scoreMedical(profile: WorkerProfile, req: TaskRequirements): { score: number; gap?: ReadinessGap } {
  if (!req.requiresMedicalAptitude) return { score: 15 };
  switch (profile.medicalAptitudeStatus) {
    case 'vigente':
      return { score: 15 };
    case 'restringida':
      return {
        score: 8,
        gap: {
          kind: 'medical_aptitude',
          description: 'Aptitud médica RESTRINGIDA — revisar restricciones específicas con médico.',
          weight: 7,
          recommendation: 'Consultar restricciones médicas; reasignar tarea si incompatible.',
        },
      };
    case 'expirada':
      return {
        score: 3,
        gap: {
          kind: 'medical_aptitude',
          description: 'Aptitud médica EXPIRADA — agendar examen ocupacional.',
          weight: 12,
          recommendation: 'Agendar examen ocupacional inmediatamente.',
        },
      };
    case 'sin_aptitud':
      return {
        score: 0,
        gap: {
          kind: 'medical_aptitude',
          description: 'Sin aptitud médica registrada.',
          weight: 15,
          recommendation: 'No iniciar tarea; realizar examen pre-ocupacional.',
        },
      };
  }
}

function scoreDocuments(profile: WorkerProfile, req: TaskRequirements): { score: number; missing: string[] } {
  if (req.requiredAcknowledgements.length === 0) return { score: 10, missing: [] };
  const missing = req.requiredAcknowledgements.filter((d) => !profile.signedDocuments.includes(d));
  const score = Math.round(
    ((req.requiredAcknowledgements.length - missing.length) / req.requiredAcknowledgements.length) * 10,
  );
  return { score, missing };
}

function scoreExperience(profile: WorkerProfile, req: TaskRequirements): { score: number; gap?: ReadinessGap } {
  const count = profile.taskCategoryExperienceCount;
  if (count >= 50) return { score: 15 };
  if (count >= 20) return { score: 12 };
  if (count >= 10) return { score: 9 };
  if (count >= 5) return { score: 6 };
  if (count >= 1) return { score: 3 };
  return {
    score: 0,
    gap: {
      kind: 'experience',
      description: `Sin experiencia previa en categoría "${req.taskCategory}".`,
      weight: 15,
      recommendation: 'Asignar mentor o supervisión directa durante primeras horas.',
    },
  };
}

/**
 * Codex PR #315 round-2 P2: incident-recency penalty.
 *
 * Up to round 1 the route computed `daysSinceLastIncident` and passed
 * it into the profile, but `computeReadiness` ignored the field
 * entirely — a worker with an incident yesterday produced an identical
 * report to one with no incident in 90 days. That contradicted the
 * route's own contract (it advertised incident proximity as part of
 * readiness) and silenced a real safety signal.
 *
 * Penalty curve (subtracted from total score; never positive):
 *   days >= 60   →  0   (no penalty — incident is historical)
 *   days 30-59  → -2   (mild reminder)
 *   days 7-29   → -5   (notable; supervisor should know)
 *   days 1-6    → -10  (very recent; significant signal)
 *   days <= 0   → -15  (incident today; strongest signal)
 *
 * The penalty is also surfaced as a gap so the supervisor sees WHY the
 * score dropped. Weight matches the penalty magnitude for sort order.
 * The base 6 subscores are unchanged so existing tests/UI continue to
 * pass; this is a top-level adjustment on the final score.
 */
function scoreIncidentRecency(profile: WorkerProfile): { penalty: number; gap?: ReadinessGap } {
  const d = profile.daysSinceLastIncident;
  if (typeof d !== 'number' || d >= 60) return { penalty: 0 };
  let penalty = 0;
  let weight = 0;
  let description = '';
  let recommendation = '';
  if (d <= 0) {
    penalty = 15;
    weight = 15;
    description = 'Incidente registrado hoy — máxima atención.';
    recommendation = 'Pausa de toma de conciencia + revisión de causa raíz antes de reasignar.';
  } else if (d <= 6) {
    penalty = 10;
    weight = 10;
    description = `Incidente reciente (hace ${d} día${d === 1 ? '' : 's'}).`;
    recommendation = 'Supervisión directa esta jornada + charla de 5 minutos.';
  } else if (d <= 29) {
    penalty = 5;
    weight = 5;
    description = `Incidente en los últimos 30 días (hace ${d} días).`;
    recommendation = 'Revisar lecciones aprendidas con el trabajador antes de iniciar tarea.';
  } else {
    // 30-59
    penalty = 2;
    weight = 2;
    description = `Incidente en los últimos 60 días (hace ${d} días).`;
    recommendation = 'Confirmar que medidas correctivas del incidente estén aplicadas.';
  }
  return {
    penalty,
    gap: { kind: 'incident_recency', description, weight, recommendation },
  };
}

function scoreFatigue(profile: WorkerProfile): { score: number; gap?: ReadinessGap } {
  switch (profile.fatigueLevel) {
    case 'low':
      return { score: 15 };
    case 'moderate':
      return {
        score: 9,
        gap: {
          kind: 'fatigue',
          description: 'Fatiga moderada detectada.',
          weight: 6,
          recommendation: 'Considerar pausas adicionales o rotación de tarea.',
        },
      };
    case 'high':
      return {
        score: 3,
        gap: {
          kind: 'fatigue',
          description: 'Fatiga alta — riesgo aumentado.',
          weight: 12,
          recommendation: 'Reasignar a tarea menos exigente; descanso obligatorio.',
        },
      };
    case 'critical':
      return {
        score: 0,
        gap: {
          kind: 'fatigue',
          description: 'Fatiga CRÍTICA — no debe ejecutar tareas críticas.',
          weight: 15,
          recommendation: 'Suspender turno; descanso mínimo 8h.',
        },
      };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Level classification
// ────────────────────────────────────────────────────────────────────────

function classifyLevel(score: number): ReadinessReport['level'] {
  if (score >= 85) return 'ready';
  if (score >= 65) return 'minor_gaps';
  if (score >= 40) return 'major_gaps';
  return 'critical_gaps';
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

export function computeReadiness(
  profile: WorkerProfile,
  task: TaskRequirements,
): ReadinessReport {
  const t = scoreTrainings(profile, task);
  const e = scoreEpp(profile, task);
  const m = scoreMedical(profile, task);
  const d = scoreDocuments(profile, task);
  const x = scoreExperience(profile, task);
  const f = scoreFatigue(profile);
  // Codex PR #315 round-2 P2: incident-recency penalty applied to the
  // final aggregate. The 6 sub-scores keep their original weights so the
  // existing UI and tests are not regressed; the recency signal is a
  // top-level deduction that ranges 0..-15 depending on how recent the
  // incident was.
  const ir = scoreIncidentRecency(profile);

  const baseScore = t.score + e.score + m.score + d.score + x.score + f.score;
  const score = baseScore - ir.penalty;

  const gaps: ReadinessGap[] = [];
  for (const missing of t.missing) {
    gaps.push({
      kind: 'missing_training',
      description: `Training faltante: ${missing}`,
      weight: 25 / Math.max(1, task.requiredTrainings.length),
      recommendation: `Asignar capacitación ${missing}.`,
    });
  }
  for (const missing of e.missing) {
    gaps.push({
      kind: 'missing_epp',
      description: `EPP faltante: ${missing}`,
      weight: 20 / Math.max(1, task.requiredEpp.length),
      recommendation: `Entregar EPP ${missing}.`,
    });
  }
  if (m.gap) gaps.push(m.gap);
  for (const missing of d.missing) {
    gaps.push({
      kind: 'missing_doc',
      description: `Documento sin firmar: ${missing}`,
      weight: 10 / Math.max(1, task.requiredAcknowledgements.length),
      recommendation: `Capturar firma del documento ${missing} (QR F.5).`,
    });
  }
  if (x.gap) gaps.push(x.gap);
  if (f.gap) gaps.push(f.gap);
  if (ir.gap) gaps.push(ir.gap);

  // Priorizar recomendaciones por weight desc
  const recommendations = [...gaps]
    .sort((a, b) => b.weight - a.weight)
    .map((g) => g.recommendation)
    .slice(0, 5);

  const clamped = Math.max(0, Math.min(100, score));
  return {
    workerUid: profile.workerUid,
    taskCategory: task.taskCategory,
    score: clamped,
    level: classifyLevel(clamped),
    gaps,
    recommendations,
    subScores: {
      trainings: t.score,
      epp: e.score,
      medical: m.score,
      documents: d.score,
      experience: x.score,
      fatigue: f.score,
    },
  };
}
