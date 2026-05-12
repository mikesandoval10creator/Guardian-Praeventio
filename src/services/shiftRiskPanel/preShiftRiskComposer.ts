// Praeventio Guard — Sprint 40 Fase F.21: Panel Riesgo por Turno.
//
// Cierra Plan F.21 "Panel Riesgo por Turno: Dashboard pre-turno con
// clima + fatiga + personal nuevo + tareas críticas + mantención +
// incidents recientes".
//
// Compone 7 fuentes de señal heterogéneas en un score de riesgo
// pre-turno (0-100) + recomendaciones operacionales. El supervisor lo
// abre antes de iniciar el turno; el sistema le dice "hoy tu turno
// arranca con riesgo X por estas razones".
//
// 100% determinístico. Sin ML. Cada factor tiene peso conocido y
// trazable. El supervisor SIEMPRE puede ver de dónde viene cada punto.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ShiftPeriod = 'day' | 'evening' | 'night';

export interface ShiftRiskInputs {
  /** Identificación del turno (proyecto + período + fecha). */
  projectId: string;
  shift: ShiftPeriod;
  date: string; // YYYY-MM-DD

  /** Clima esperado para el turno. */
  weather: {
    rainProbability: number; // 0-1
    windSpeedMs: number;
    uvIndex: number;
    temperatureC: number;
    lightningRiskWithinHours?: number;
    visibilityKm: number;
  };

  /** Trabajadores asignados con flags de fatiga/novato. */
  workers: Array<{
    uid: string;
    fullName: string;
    fatigueRisk?: 'low' | 'moderate' | 'high' | 'critical';
    daysSinceHire: number;
    hasNightShiftHistory?: boolean;
  }>;

  /** Tareas planificadas con categoría de criticidad. */
  plannedTasks: Array<{
    id: string;
    category: string;
    isCriticalTask: boolean;
    requiresPermit?: boolean;
  }>;

  /** Equipos asignados con estado de mantención. */
  equipment: Array<{
    id: string;
    code: string;
    overdueMaintenance?: boolean;
  }>;

  /** Incidentes del proyecto en últimos 7 días. */
  recentIncidents: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    occurredAt: string;
  }>;

  /** Permisos activos para el turno. */
  activePermitsCount: number;

  /** Brigada de emergencia preparada (true/false). */
  emergencyBrigadeReady: boolean;
}

export interface ShiftRiskFactor {
  /** Identificador estable (para tooltip + traza). */
  id: string;
  label: string;
  /** Aporte al score total (positivo = aumenta riesgo). */
  weight: number;
  /** Recomendación accionable o null si no aplica. */
  recommendation?: string;
}

export interface ShiftRiskReport {
  projectId: string;
  shift: ShiftPeriod;
  date: string;
  /** Score 0-100 (100 = alto riesgo, 0 = sin factores adversos). */
  riskScore: number;
  level: 'green' | 'amber' | 'red';
  factors: ShiftRiskFactor[];
  /** Top 3 recomendaciones priorizadas. */
  topRecommendations: string[];
  /** Si recomienda postergar arranque del turno (riesgo extremo). */
  recommendDelayShiftStart: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

const FATIGUE_WEIGHTS = { critical: 25, high: 15, moderate: 7, low: 0 } as const;
const SEVERITY_INCIDENT_WEIGHTS = { critical: 15, high: 9, medium: 4, low: 1 } as const;
const SHIFT_BASE_WEIGHT: Record<ShiftPeriod, number> = {
  day: 0,
  evening: 5,
  night: 12,
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

// ────────────────────────────────────────────────────────────────────────
// Factor extractors
// ────────────────────────────────────────────────────────────────────────

function weatherFactors(w: ShiftRiskInputs['weather']): ShiftRiskFactor[] {
  const out: ShiftRiskFactor[] = [];

  if (w.lightningRiskWithinHours !== undefined && w.lightningRiskWithinHours <= 3) {
    out.push({
      id: 'lightning',
      label: `Riesgo tormenta eléctrica en ${w.lightningRiskWithinHours}h`,
      weight: 25,
      recommendation: 'Suspender trabajos al aire libre hasta confirmar pronóstico.',
    });
  }

  if (w.rainProbability > 0.7) {
    out.push({
      id: 'rain',
      label: `Lluvia ${Math.round(w.rainProbability * 100)}%`,
      weight: 10,
      recommendation: 'Reprogramar tareas en exterior + cubrir excavaciones.',
    });
  }

  if (w.windSpeedMs > 11) {
    out.push({
      id: 'wind',
      label: `Viento ${w.windSpeedMs} m/s sobre umbral izaje`,
      weight: 15,
      recommendation: 'Suspender izaje y trabajo en altura sobre 1.8m.',
    });
  }

  if (w.uvIndex >= 11) {
    out.push({
      id: 'uv-extreme',
      label: `UV ${w.uvIndex} extremo`,
      weight: 8,
      recommendation: 'Bloqueador solar 50+, sombra obligatoria 12-15h, pausas cada 30min.',
    });
  }

  if (w.temperatureC >= 32) {
    out.push({
      id: 'heat',
      label: `${w.temperatureC}°C — estrés térmico`,
      weight: 10,
      recommendation: 'Hidratación cada 20min + pausas frescas + monitoreo WBGT.',
    });
  } else if (w.temperatureC <= 5) {
    out.push({
      id: 'cold',
      label: `${w.temperatureC}°C — riesgo frío`,
      weight: 7,
      recommendation: 'Vestimenta multicapa, pausas calientes, evaluar windchill.',
    });
  }

  if (w.visibilityKm < 1) {
    out.push({
      id: 'low-visibility',
      label: `Visibilidad ${w.visibilityKm}km`,
      weight: 12,
      recommendation: 'Iluminación reforzada, restringir maquinaria móvil, vigía adicional.',
    });
  }

  return out;
}

function fatigueFactors(workers: ShiftRiskInputs['workers']): ShiftRiskFactor[] {
  const out: ShiftRiskFactor[] = [];
  let totalFatigueWeight = 0;
  const highFatigue: string[] = [];

  for (const w of workers) {
    const f = w.fatigueRisk ?? 'low';
    totalFatigueWeight += FATIGUE_WEIGHTS[f];
    if (f === 'critical' || f === 'high') {
      highFatigue.push(w.fullName);
    }
  }

  if (highFatigue.length > 0) {
    out.push({
      id: 'fatigue',
      label: `${highFatigue.length} trabajador(es) con fatiga alta/crítica`,
      weight: Math.min(35, totalFatigueWeight),
      recommendation: `No asignar a tareas críticas: ${highFatigue.slice(0, 3).join(', ')}.`,
    });
  }

  return out;
}

function newWorkersFactor(workers: ShiftRiskInputs['workers']): ShiftRiskFactor | null {
  const newbies = workers.filter((w) => w.daysSinceHire <= 14);
  if (newbies.length === 0) return null;
  const weight = Math.min(20, newbies.length * 5);
  return {
    id: 'new-workers',
    label: `${newbies.length} trabajador(es) nuevo(s) (<14 días)`,
    weight,
    recommendation: 'Asignar mentor + restringir tareas críticas no acompañadas.',
  };
}

function criticalTasksFactor(tasks: ShiftRiskInputs['plannedTasks']): ShiftRiskFactor | null {
  const criticals = tasks.filter((t) => t.isCriticalTask);
  if (criticals.length === 0) return null;
  const noPermit = criticals.filter((t) => t.requiresPermit && !t.requiresPermit);
  void noPermit;
  return {
    id: 'critical-tasks',
    label: `${criticals.length} tarea(s) crítica(s) planificada(s)`,
    weight: Math.min(20, criticals.length * 4),
    recommendation: 'Verificar permisos activos + checklist pre-tarea + supervisor competente.',
  };
}

function equipmentMaintenanceFactor(
  equipment: ShiftRiskInputs['equipment'],
): ShiftRiskFactor | null {
  const overdue = equipment.filter((e) => e.overdueMaintenance);
  if (overdue.length === 0) return null;
  return {
    id: 'equipment-overdue',
    label: `${overdue.length} equipo(s) con mantención vencida`,
    weight: Math.min(15, overdue.length * 4),
    recommendation: `Bloquear uso: ${overdue.slice(0, 3).map((e) => e.code).join(', ')}.`,
  };
}

function recentIncidentsFactor(
  incidents: ShiftRiskInputs['recentIncidents'],
): ShiftRiskFactor | null {
  if (incidents.length === 0) return null;
  let totalWeight = 0;
  for (const i of incidents) totalWeight += SEVERITY_INCIDENT_WEIGHTS[i.severity];
  return {
    id: 'recent-incidents',
    label: `${incidents.length} incidente(s) en últimos 7 días`,
    weight: Math.min(25, totalWeight),
    recommendation: 'Revisar acciones correctivas pendientes + briefing al equipo.',
  };
}

function brigadeFactor(ready: boolean): ShiftRiskFactor | null {
  if (ready) return null;
  return {
    id: 'brigade-not-ready',
    label: 'Brigada de emergencia no acreditada',
    weight: 15,
    recommendation: 'Confirmar disponibilidad brigada antes de iniciar turno.',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Composer
// ────────────────────────────────────────────────────────────────────────

export function composeShiftRiskPanel(inputs: ShiftRiskInputs): ShiftRiskReport {
  const factors: ShiftRiskFactor[] = [];

  // Base por turno (nocturno arranca con +12)
  const shiftBase = SHIFT_BASE_WEIGHT[inputs.shift];
  if (shiftBase > 0) {
    factors.push({
      id: 'shift-base',
      label: inputs.shift === 'night' ? 'Turno nocturno (base)' : 'Turno tarde (base)',
      weight: shiftBase,
      recommendation:
        inputs.shift === 'night'
          ? 'Verificar iluminación, descansos, vigilancia anti-fatiga.'
          : undefined,
    });
  }

  factors.push(...weatherFactors(inputs.weather));
  factors.push(...fatigueFactors(inputs.workers));

  const newF = newWorkersFactor(inputs.workers);
  if (newF) factors.push(newF);

  const critF = criticalTasksFactor(inputs.plannedTasks);
  if (critF) factors.push(critF);

  const eqF = equipmentMaintenanceFactor(inputs.equipment);
  if (eqF) factors.push(eqF);

  const incF = recentIncidentsFactor(inputs.recentIncidents);
  if (incF) factors.push(incF);

  const briF = brigadeFactor(inputs.emergencyBrigadeReady);
  if (briF) factors.push(briF);

  const total = factors.reduce((sum, f) => sum + f.weight, 0);
  const riskScore = clamp(total);

  let level: 'green' | 'amber' | 'red' = 'green';
  if (riskScore >= 60) level = 'red';
  else if (riskScore >= 30) level = 'amber';

  // Top 3 recomendaciones (ordenado por weight desc)
  const topRecommendations = [...factors]
    .filter((f) => f.recommendation)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((f) => f.recommendation!) as string[];

  return {
    projectId: inputs.projectId,
    shift: inputs.shift,
    date: inputs.date,
    riskScore,
    level,
    factors,
    topRecommendations,
    recommendDelayShiftStart: riskScore >= 75,
  };
}
