// Praeventio Guard — Sprint K: Climate-Aware Scheduling + Work Suspension.
//
// Cierra: Documento usuario "§94" (programación reactiva)
//
// Cuando hay alertas climáticas (lluvia, viento, calor extremo, frío, UV
// extremo, tormenta eléctrica), decide automáticamente:
//   - Qué tareas suspender
//   - Qué tareas reprogramar al horario menos crítico
//   - Qué controles adicionales activar
//
// Determinístico. Reglas trazables.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface WeatherConditions {
  temperatureC: number;
  humidityPercent: number;
  windSpeedMs: number;
  rainProbability: number; // 0-1
  uvIndex: number;
  /** Tormenta eléctrica detectada en próximas 6h. */
  lightningRiskWithinHours?: number;
  visibilityKm: number;
}

export type TaskCategory =
  | 'altura'
  | 'izaje'
  | 'excavacion'
  | 'soldadura'
  | 'electrico'
  | 'pintura_exterior'
  | 'transporte'
  | 'oficina';

export interface ScheduledTask {
  id: string;
  category: TaskCategory;
  /** Hora local programada (0-23). */
  scheduledHour: number;
  /** Si es al aire libre. */
  outdoor: boolean;
  workerUids: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Decision engine
// ────────────────────────────────────────────────────────────────────────

export type WeatherDecision = 'proceed' | 'add_controls' | 'reschedule' | 'suspend';

export interface TaskWeatherAssessment {
  taskId: string;
  category: TaskCategory;
  decision: WeatherDecision;
  reasons: string[];
  /** Hora sugerida para reprogramación. */
  suggestedHour?: number;
  /** Controles adicionales recomendados. */
  additionalControls: string[];
}

export function assessTaskWeather(
  task: ScheduledTask,
  weather: WeatherConditions,
): TaskWeatherAssessment {
  const reasons: string[] = [];
  const additionalControls: string[] = [];
  let decision: WeatherDecision = 'proceed';

  // ─── Lluvia ───
  if (weather.rainProbability > 0.7 && task.outdoor) {
    if (task.category === 'excavacion' || task.category === 'electrico') {
      reasons.push(`Probabilidad lluvia ${Math.round(weather.rainProbability * 100)}% — tarea crítica al aire libre.`);
      decision = 'suspend';
    } else if (task.category === 'pintura_exterior') {
      reasons.push('Pintura exterior + lluvia → resultado defectuoso.');
      decision = 'reschedule';
    } else if (task.category === 'altura') {
      reasons.push('Trabajo en altura + lluvia → resbalones.');
      decision = decision === 'suspend' ? 'suspend' : 'reschedule';
    }
  }

  // ─── Tormenta eléctrica ───
  if (weather.lightningRiskWithinHours !== undefined && weather.lightningRiskWithinHours <= 3) {
    if (task.outdoor) {
      reasons.push(`Riesgo de tormenta eléctrica en ${weather.lightningRiskWithinHours}h.`);
      decision = 'suspend';
    }
  }

  // ─── Viento ───
  if (task.category === 'izaje' && weather.windSpeedMs >= 11) {
    reasons.push(`Viento ${weather.windSpeedMs.toFixed(1)} m/s ≥ 11 m/s — bloqueo izaje.`);
    decision = 'suspend';
  } else if (task.category === 'altura' && weather.windSpeedMs >= 14) {
    reasons.push(`Viento ${weather.windSpeedMs.toFixed(1)} m/s ≥ 14 m/s — bloqueo altura.`);
    decision = 'suspend';
  }

  // ─── Calor extremo ───
  if (weather.temperatureC >= 35 && task.outdoor) {
    if (task.scheduledHour >= 11 && task.scheduledHour <= 16) {
      reasons.push(`Calor extremo ${weather.temperatureC}°C en horario crítico (11-16h).`);
      decision = decision === 'suspend' ? 'suspend' : 'reschedule';
    } else {
      decision = decision === 'suspend' ? 'suspend' : 'add_controls';
      additionalControls.push('Pausas hidratación cada 30min', 'Sombra obligatoria');
    }
  }

  // ─── Frío extremo ───
  if (weather.temperatureC <= -10 && task.outdoor) {
    reasons.push(`Frío extremo ${weather.temperatureC}°C.`);
    decision = decision === 'suspend' ? 'suspend' : 'add_controls';
    additionalControls.push('Vestimenta multicapa', 'Pausas en refugio cada 30min', 'No trabajar solo');
  }

  // ─── UV extremo ───
  if (weather.uvIndex >= 11 && task.outdoor) {
    reasons.push(`UV index ${weather.uvIndex} extremo.`);
    if (task.scheduledHour >= 11 && task.scheduledHour <= 16) {
      decision = decision === 'suspend' ? 'suspend' : 'reschedule';
    } else {
      additionalControls.push('FPS 50+', 'Manga larga', 'Protección facial');
      if (decision === 'proceed') decision = 'add_controls';
    }
  }

  // ─── Visibilidad reducida ───
  if (weather.visibilityKm < 0.5 && task.outdoor) {
    reasons.push('Visibilidad reducida.');
    if (task.category === 'transporte' || task.category === 'izaje') {
      decision = 'suspend';
    } else {
      decision = decision === 'suspend' ? 'suspend' : 'add_controls';
      additionalControls.push('Iluminación adicional', 'Vigía obligatorio');
    }
  }

  // Sugerencia de reprogramación
  let suggestedHour: number | undefined;
  if (decision === 'reschedule') {
    suggestedHour = task.scheduledHour < 11 ? 6 : 18;
  }

  return {
    taskId: task.id,
    category: task.category,
    decision,
    reasons,
    suggestedHour,
    additionalControls,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Daily plan adjustment
// ────────────────────────────────────────────────────────────────────────

export interface DailyPlanAdjustment {
  proceed: number;
  addControls: number;
  reschedule: number;
  suspend: number;
  assessments: TaskWeatherAssessment[];
}

export function buildDailyPlanAdjustment(
  tasks: ScheduledTask[],
  weather: WeatherConditions,
): DailyPlanAdjustment {
  const assessments = tasks.map((t) => assessTaskWeather(t, weather));
  const counts = { proceed: 0, addControls: 0, reschedule: 0, suspend: 0 };
  for (const a of assessments) {
    if (a.decision === 'proceed') counts.proceed += 1;
    else if (a.decision === 'add_controls') counts.addControls += 1;
    else if (a.decision === 'reschedule') counts.reschedule += 1;
    else if (a.decision === 'suspend') counts.suspend += 1;
  }
  return { ...counts, assessments };
}
