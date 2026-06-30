// weatherAdvice — reglas puras de seguridad según condiciones climáticas.
// Fusiona la lógica de WeatherSafetyRecommendations (altitud/UV/calor/viento/
// humedad — DS 594, DS 132) para alimentar el banner rotativo de consejos.
// Pura, determinista, sin side-effects.

export interface WeatherInput {
  temp?: number;
  humidity?: number;
  windSpeed?: number;
  uvIndex?: number;
  altitude?: number;
}

export type AdviceSeverity = 'info' | 'warning' | 'critical';

export interface AdviceItem {
  text: string;
  severity: AdviceSeverity;
}

/** Consejos disparados por las condiciones climáticas reales (DS 594 / DS 132). */
export function buildWeatherAdvice(w: WeatherInput | undefined): AdviceItem[] {
  if (!w) return [];
  const out: AdviceItem[] = [];
  const alt = w.altitude ?? 0;

  if (alt > 2400) {
    out.push({
      severity: 'critical',
      text: 'Altitud > 2.400 m (−25% O₂): aclimatación OBLIGATORIA antes de tareas físicas. Vigila cefalea, náuseas y vértigo.',
    });
  } else if (alt > 1500) {
    out.push({
      severity: 'warning',
      text: `Altitud ${Math.round(alt)} m (−15% O₂): aumenta los descansos e hidrátate (mínimo 500 ml/h).`,
    });
  }

  if ((w.uvIndex ?? 0) >= 8) {
    out.push({
      severity: 'critical',
      text: 'UV extremo (≥8): protector SPF50+, casco con ala y manga larga. Evita el sol directo 11:00–15:00 h (DS 594 Art. 53).',
    });
  }

  if ((w.temp ?? 20) >= 32) {
    out.push({
      severity: 'critical',
      text: `Riesgo de golpe de calor (${w.temp}°C): pausas de 15 min/h en sombra e hidratación de 250 ml cada 20 min (DS 594).`,
    });
  } else if ((w.temp ?? 20) >= 27) {
    out.push({
      severity: 'warning',
      text: `Calor moderado (${w.temp}°C): rota las tareas pesadas al horario fresco y garantiza agua fresca.`,
    });
  }

  if ((w.windSpeed ?? 0) >= 60) {
    out.push({
      severity: 'critical',
      text: `Viento fuerte (${w.windSpeed} km/h): suspende trabajos en altura, andamios y grúas. Asegura materiales sueltos (DS 132 Art. 53).`,
    });
  }

  if ((w.humidity ?? 50) >= 80 && (w.temp ?? 20) >= 25) {
    out.push({
      severity: 'warning',
      text: `Humedad ${w.humidity}% con ${w.temp}°C: índice de calor elevado, reduce la intensidad del trabajo físico.`,
    });
  }

  return out;
}
