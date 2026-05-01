// Praeventio Guard — Pure helpers extracted from Dashboard.tsx (A11 R18).
//
// Logic copied verbatim from `src/pages/Dashboard.tsx` to keep the refactor
// behaviour-preserving. All functions here are pure (no IO, no React, no
// clock side effects beyond an injected `now`) so they can be unit-tested.

export type ChallengePeriod = 'daily' | 'weekly' | 'monthly' | 'annual';

export const POINTS_BY_PERIOD: Record<ChallengePeriod, number> = {
  daily: 10,
  weekly: 50,
  monthly: 200,
  annual: 1000,
};

export const industryChallenges: Record<string, Record<ChallengePeriod, string[]>> = {
  'Construcción': {
    daily: ['Check-in EPP', 'Charla 5 min', 'Reportar 1 Hallazgo', 'Inspección de Andamios', 'Limpieza de área'],
    weekly: ['Auditoría de Terreno', 'Revisión de Maquinaria', 'Capacitación Altura', 'Simulacro de Evacuación', 'Reunión de Comité'],
    monthly: ['Informe de Siniestralidad', 'Inspección de Grúas', 'Capacitación Primeros Auxilios', 'Revisión de PTS', 'Inventario de EPP'],
    annual: ['Examen Médico Ocupacional', 'Renovación de Certificaciones', 'Plan de Emergencia Anual', 'Auditoría Externa', 'Cierre de Brechas'],
  },
  'Minería': {
    daily: ['Control de Fatiga', 'Check-list Camión Extracción', 'Medición de Gases', 'Reportar Condición Subestándar', 'Charla de Inicio'],
    weekly: ['Inspección de Taludes', 'Prueba de Frenos', 'Capacitación Espacios Confinados', 'Revisión de Extintores', 'Control de Polvo'],
    monthly: ['Mantenimiento Preventivo', 'Auditoría de Procesos', 'Capacitación Sustancias Peligrosas', 'Revisión de Refugios', 'Informe de Producción Segura'],
    annual: ['Certificación de Operadores', 'Simulacro General de Mina', 'Revisión de Estabilidad de Botaderos', 'Auditoría de Seguridad', 'Plan de Cierre Progresivo'],
  },
  'General': {
    daily: ['Check-in Asistencia', 'Orden y Limpieza', 'Reportar Incidente', 'Pausa Activa', 'Revisión de Herramientas'],
    weekly: ['Charla de Seguridad', 'Inspección de Oficina', 'Capacitación Básica', 'Revisión de Botiquín', 'Reunión de Equipo'],
    monthly: ['Informe Mensual', 'Simulacro de Incendio', 'Capacitación Específica', 'Revisión de Políticas', 'Encuesta de Clima'],
    annual: ['Evaluación de Desempeño', 'Plan de Capacitación Anual', 'Revisión de Objetivos', 'Auditoría Interna', 'Cena de Seguridad'],
  },
};

/**
 * Determine if a challenge has been completed within the active period.
 * `completedAt` is the ISO string (or millis-compatible Date input) recorded
 * by the gamification engine when the challenge was last completed.
 */
export function isChallengeCompletedAt(
  completedAt: string | number | undefined,
  period: ChallengePeriod,
  now: Date = new Date(),
): boolean {
  if (!completedAt) return false;
  const date = new Date(completedAt);

  switch (period) {
    case 'daily':
      return date.toDateString() === now.toDateString();
    case 'weekly': {
      const diffTime = Math.abs(now.getTime() - date.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 7;
    }
    case 'monthly':
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    case 'annual':
      return date.getFullYear() === now.getFullYear();
    default:
      return false;
  }
}

/**
 * Build an .ics calendar string for daily challenges, distributed in 2-hour
 * blocks starting tomorrow at 09:00. Pure (relative to the supplied `now`).
 */
export function buildDailyChallengesIcs(
  challenges: string[],
  now: Date = new Date(),
): string {
  let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Praeventio Guard//ES\n';

  challenges.forEach((challenge, index) => {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9 + index * 2, 0, 0, 0);

    const start = tomorrow.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endDt = new Date(tomorrow.getTime() + 60 * 60000);
    const end = endDt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    ics += 'BEGIN:VEVENT\n';
    ics += `UID:praeventio-daily-${index}-${now.getTime()}@praeventioguard.com\n`;
    ics += `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'}\n`;
    ics += `DTSTART:${start}\n`;
    ics += `DTEND:${end}\n`;
    ics += `SUMMARY:${challenge}\n`;
    ics += `DESCRIPTION:Tarea diaria de seguridad en Praeventio Guard\n`;
    ics += 'END:VEVENT\n';
  });

  ics += 'END:VCALENDAR';
  return ics;
}

/**
 * Trigger a browser download for an arbitrary text payload as `filename`.
 * Side-effectful — kept here so the modal can stay declarative.
 */
export function downloadTextFile(content: string, filename: string, mime = 'text/calendar;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

const CLOSED_STATUSES = new Set([
  'cerrado', 'cerrada', 'completed', 'completado', 'completada',
]);

/**
 * Compute the % compliance for a project based on its findings, tasks and
 * trainings. Mirrors the original Dashboard.calculateCompliance.
 *
 * Each bucket scores 100 when empty (vacuous truth) and proportionally
 * otherwise; the final score is the unweighted mean of the three buckets.
 */
export function computeProjectCompliance(
  projectId: string,
  nodes: Array<{
    projectId?: string;
    type: string;
    metadata?: { status?: string; estado?: string };
  }>,
  nodeTypes: { FINDING: string; TASK: string; TRAINING: string },
): number {
  const projectNodes = nodes.filter(n => n.projectId === projectId);

  const findings = projectNodes.filter(n => n.type === nodeTypes.FINDING);
  let findingsScore = 100;
  if (findings.length > 0) {
    const closed = findings.filter(n => {
      const status = (n.metadata?.status || n.metadata?.estado || '').toLowerCase();
      return CLOSED_STATUSES.has(status);
    }).length;
    findingsScore = (closed / findings.length) * 100;
  }

  const tasks = projectNodes.filter(n => n.type === nodeTypes.TASK);
  let tasksScore = 100;
  if (tasks.length > 0) {
    const completed = tasks.filter(n => {
      const status = (n.metadata?.status || n.metadata?.estado || '').toLowerCase();
      return CLOSED_STATUSES.has(status);
    }).length;
    tasksScore = (completed / tasks.length) * 100;
  }

  const trainings = projectNodes.filter(n => n.type === nodeTypes.TRAINING);
  let trainingsScore = 100;
  if (trainings.length > 0) {
    const completed = trainings.filter(n =>
      n.metadata?.status === 'completed' || n.metadata?.estado === 'Completada'
    ).length;
    trainingsScore = (completed / trainings.length) * 100;
  }

  return Math.round((findingsScore + tasksScore + trainingsScore) / 3);
}
