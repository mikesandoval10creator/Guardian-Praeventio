// Praeventio Guard — Sprint 39 Fase I.4: Control de Fatiga por Jornada.
//
// Cierra: Documento usuario "Recomendaciones nuevas §65, §66, §67"
//
// Trackea horas acumuladas, turnos consecutivos, descanso entre turnos.
// Recomendaciones según DS 594 + Ley 20.949 + Protocolo MINSAL.

export interface WorkSession {
  workerUid: string;
  startedAt: string;
  endedAt?: string;
  isNight: boolean;
  /** Si la sesión cubrió tareas críticas (altura, confinado, eléctrico). */
  hadCriticalTasks: boolean;
}

export type FatigueRisk = 'low' | 'moderate' | 'high' | 'critical';

export interface FatigueAssessment {
  workerUid: string;
  totalHoursLast24h: number;
  totalHoursLast7d: number;
  consecutiveShifts: number;
  nightShiftsLast7d: number;
  hoursOfRestSinceLastShift: number;
  risk: FatigueRisk;
  recommendations: string[];
  shouldRestrictCritical: boolean;
  assessedAt: string;
}

const MAX_HOURS_24H = 12; // DS 594 art. 102 jornada continua
const MIN_REST_BETWEEN_SHIFTS_H = 11; // Código Trabajo art. 38
const MAX_NIGHT_SHIFTS_PER_WEEK = 5;

export function assessFatigue(
  workerUid: string,
  sessions: WorkSession[],
  now: Date = new Date(),
): FatigueAssessment {
  // Filtra sesiones del worker en rangos relevantes.
  const ws = sessions.filter((s) => s.workerUid === workerUid);
  const nowMs = now.getTime();
  const last24hMs = nowMs - 24 * 3_600_000;
  const last7dMs = nowMs - 7 * 24 * 3_600_000;

  const last24h = ws.filter(
    (s) => Date.parse(s.startedAt) >= last24hMs,
  );
  const last7d = ws.filter(
    (s) => Date.parse(s.startedAt) >= last7dMs,
  );

  const totalHoursLast24h = sumHours(last24h, now);
  const totalHoursLast7d = sumHours(last7d, now);
  const nightShiftsLast7d = last7d.filter((s) => s.isNight).length;

  // Sesiones consecutivas (con < MIN_REST_BETWEEN_SHIFTS_H entre ellas).
  const sorted = ws
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  let consecutiveShifts = 1;
  let maxConsecutive = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev.endedAt) continue;
    const restH = (Date.parse(curr.startedAt) - Date.parse(prev.endedAt)) / 3_600_000;
    if (restH < MIN_REST_BETWEEN_SHIFTS_H) {
      consecutiveShifts += 1;
      if (consecutiveShifts > maxConsecutive) maxConsecutive = consecutiveShifts;
    } else {
      consecutiveShifts = 1;
    }
  }

  // Last rest: tiempo desde fin de la última sesión.
  let hoursOfRestSinceLastShift = 999;
  const lastEnded = sorted
    .filter((s) => s.endedAt)
    .sort((a, b) => b.endedAt!.localeCompare(a.endedAt!))[0];
  if (lastEnded) {
    hoursOfRestSinceLastShift =
      (nowMs - Date.parse(lastEnded.endedAt!)) / 3_600_000;
  }

  // Compute risk
  let risk: FatigueRisk = 'low';
  const recommendations: string[] = [];
  if (totalHoursLast24h > MAX_HOURS_24H) {
    risk = 'critical';
    recommendations.push(
      `Excede ${MAX_HOURS_24H}h en 24h (DS 594 art. 102): suspender y descansar`,
    );
  } else if (totalHoursLast24h > MAX_HOURS_24H * 0.85) {
    risk = 'high';
    recommendations.push('Cerca del máximo 12h diarias: priorizar pausa');
  }
  if (hoursOfRestSinceLastShift < MIN_REST_BETWEEN_SHIFTS_H) {
    if (risk === 'low') risk = 'moderate';
    recommendations.push(
      `Descanso entre turnos < ${MIN_REST_BETWEEN_SHIFTS_H}h (Código Trabajo art. 38): ajustar agenda`,
    );
  }
  if (nightShiftsLast7d > MAX_NIGHT_SHIFTS_PER_WEEK) {
    if (risk === 'low' || risk === 'moderate') risk = 'high';
    recommendations.push(
      `>${MAX_NIGHT_SHIFTS_PER_WEEK} turnos nocturnos/semana: aplicar protocolo MINSAL`,
    );
  }
  if (maxConsecutive >= 3) {
    if (risk === 'low') risk = 'moderate';
    recommendations.push(
      `${maxConsecutive} turnos consecutivos sin descanso suficiente: rotar`,
    );
  }

  return {
    workerUid,
    totalHoursLast24h: Math.round(totalHoursLast24h * 10) / 10,
    totalHoursLast7d: Math.round(totalHoursLast7d * 10) / 10,
    consecutiveShifts: maxConsecutive,
    nightShiftsLast7d,
    hoursOfRestSinceLastShift: Math.round(hoursOfRestSinceLastShift * 10) / 10,
    risk,
    recommendations,
    shouldRestrictCritical: risk === 'high' || risk === 'critical',
    assessedAt: now.toISOString(),
  };
}

function sumHours(sessions: WorkSession[], now: Date): number {
  let total = 0;
  for (const s of sessions) {
    const end = s.endedAt ? Date.parse(s.endedAt) : now.getTime();
    total += (end - Date.parse(s.startedAt)) / 3_600_000;
  }
  return total;
}
