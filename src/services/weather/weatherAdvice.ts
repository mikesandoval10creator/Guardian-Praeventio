/**
 * weatherAdvice.ts — Condition-based safety advisories for outdoor workers.
 *
 * Pure functions. No React, no Firestore, no side effects.
 * Covers spec §12 Task 13: heat/hydration, cold/slip, wind/height,
 * UV/sunscreen, plus one motivational/neutral message.
 *
 * Referenced by upgraded WeatherBulletin.
 */

export type AdviceLevel = 'red' | 'amber' | 'blue';

export interface WeatherAdvice {
  icon: string;
  text: string;
  level: AdviceLevel;
}

export interface WeatherAdviceInput {
  temp?: number | null;
  windSpeed?: number | null;
  condition?: string | null;
  uv?: number | null;
  airQuality?: string | null;
  aqi?: number | null;
  humidity?: number | null;
  isDaytime?: boolean;
}

/**
 * Returns up to 3 safety advisories based on weather conditions.
 * Always returns at least 1 (the motivational fallback).
 * Ordered: red first, then amber, then blue.
 */
export function getWeatherAdvice(input: WeatherAdviceInput): WeatherAdvice[] {
  const advisories: WeatherAdvice[] = [];
  const cond = (input.condition ?? '').toLowerCase();
  const temp = input.temp ?? null;
  const wind = input.windSpeed ?? null;
  const uv = input.uv ?? null;
  const humidity = input.humidity ?? null;
  const isDaytime = input.isDaytime ?? true;

  // --- RED (critical, show first) ---

  // Cold + snow/ice → slip surfaces
  if (
    temp !== null && temp < 5 ||
    cond.includes('nieve') || cond.includes('hielo') || cond.includes('escarcha')
  ) {
    advisories.push({
      icon: '🧊',
      text: 'Superficies heladas: use calzado antideslizante y reduzca velocidad de desplazamiento.',
      level: 'red',
    });
  }

  // Rain → slippery
  if (cond.includes('lluvia') || cond.includes('mojad')) {
    advisories.push({
      icon: '⚠️',
      text: 'Use calzado antideslizante en superficies mojadas. Evite escaleras sin pasamanos.',
      level: 'red',
    });
  }

  // Wind → height work
  if (wind !== null && wind > 40) {
    advisories.push({
      icon: '🌬️',
      text: `Viento ${Math.round(wind)} km/h: asegure elementos sueltos y use arnés en trabajos en altura.`,
      level: 'red',
    });
  }

  // Heat → hydration
  if (temp !== null && temp > 30) {
    advisories.push({
      icon: '🌡️',
      text: `Calor ${Math.round(temp)}°C: hidratación cada 20 min y pausas a la sombra (DS 594 Art. 53).`,
      level: 'red',
    });
  }

  // --- AMBER (warnings) ---

  // UV → sunscreen
  if (uv !== null && uv >= 6) {
    advisories.push({
      icon: '☀️',
      text: `UV ${uv}: protector solar 50+, casco con ala y manga larga entre 11:00 y 15:00.`,
      level: 'amber',
    });
  }

  // High humidity + moderate heat
  if (humidity !== null && humidity > 75 && temp !== null && temp > 25) {
    advisories.push({
      icon: '💧',
      text: `Humedad elevada (${Math.round(humidity)}%): sensación térmica mayor, aumentar frecuencia de descansos.`,
      level: 'amber',
    });
  }

  // Air quality
  const aqiHigh =
    (input.aqi !== null && input.aqi !== undefined && input.aqi >= 4) ||
    (input.airQuality !== null && input.airQuality !== undefined &&
      ['mala', 'pésima', 'pesima', 'mala'].some(q => (input.airQuality ?? '').toLowerCase().includes(q)));
  if (aqiHigh) {
    advisories.push({
      icon: '🚶',
      text: 'Calidad del aire deficiente: evite actividad física intensa al aire libre.',
      level: 'amber',
    });
  }

  // --- BLUE (informational) ---

  // Night work
  if (!isDaytime) {
    advisories.push({
      icon: '🔦',
      text: 'Trabajo nocturno: use iluminación adecuada y ropa reflectante.',
      level: 'blue',
    });
  }

  // Motivational fallback (always last, only if no other advice yet)
  if (advisories.length === 0) {
    advisories.push({
      icon: '✅',
      text: 'Condiciones favorables. Mantenga su EPP estándar y disfrute el turno.',
      level: 'blue',
    });
  }

  // Sort: red first, then amber, then blue; cap at 3
  const order: Record<AdviceLevel, number> = { red: 0, amber: 1, blue: 2 };
  return advisories.sort((a, b) => order[a.level] - order[b.level]).slice(0, 3);
}
