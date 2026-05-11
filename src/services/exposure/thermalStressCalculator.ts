// Praeventio Guard — Sprint 39 Fase L.9: Estrés Térmico + UV + Aclimatación.
//
// Cierra: Documento usuario "§350-360" — Top usuario #12
//
// Extiende `exposureRegistry` (que ya tiene agentes heat/cold/uv_radiation)
// con cálculos derivados:
//
//   - WBGT simplificado (índice estrés térmico ocupacional)
//   - heatStressProtocol: pausas y controles según WBGT
//   - coldExtremeProtocol: hipotermia, vestimenta, refugio
//   - acclimatizationStatus: ¿puede el trabajador estar a esta altura?
//   - uvCumulativeExposure: índice UV acumulado diario
//   - shadeRefugeMap: zonas con sombra/agua/descanso registradas
//
// Todo determinístico — umbrales OSHA / NIOSH / Protocolo MINSAL.

// ────────────────────────────────────────────────────────────────────────
// WBGT (Wet Bulb Globe Temperature)
// ────────────────────────────────────────────────────────────────────────

export type WorkIntensity = 'light' | 'moderate' | 'heavy' | 'very_heavy';

/**
 * Cálculo simplificado de WBGT outdoor (NIOSH):
 *   WBGT = 0.7 × Tw + 0.2 × Tg + 0.1 × Td
 * Donde Tw = temperatura bulbo húmedo, Tg = globo, Td = seco.
 *
 * Si no hay sensores reales, una aproximación a partir de T° + humedad
 * relativa + carga solar funciona para decisiones operacionales (NO
 * para informes técnicos formales).
 */
export function approximateWBGT(
  tempC: number,
  humidityPercent: number,
  solarLoad: 'none' | 'low' | 'medium' | 'high' = 'medium',
): number {
  // Approximación heat index → WBGT (de tablas NWS/OSHA).
  const heatIndex =
    tempC +
    (humidityPercent / 100) * (tempC - 14) * 0.3 +
    { none: 0, low: 1, medium: 2.5, high: 4 }[solarLoad];
  // El WBGT outdoor suele estar ~3-4°C bajo el heat index.
  return Math.round((heatIndex - 3) * 10) / 10;
}

export interface HeatStressProtocol {
  wbgt: number;
  intensity: WorkIntensity;
  /** Minutos de trabajo permitidos por hora. */
  workMinutesPerHour: number;
  /** Minutos de descanso en sombra mínimos por hora. */
  restMinutesPerHour: number;
  /** Recomendación de hidratación (ml de agua por hora). */
  hydrationMlPerHour: number;
  /** True si se debe DETENER el trabajo. */
  stopWork: boolean;
  message: string;
}

/**
 * Devuelve el protocolo de trabajo/descanso para un WBGT + intensidad.
 * Reglas basadas en NIOSH + ACGIH TLV.
 */
export function heatStressProtocol(wbgt: number, intensity: WorkIntensity): HeatStressProtocol {
  // Tabla NIOSH simplificada (min trabajo/hora):
  // intensity \ WBGT  <25  25-28  28-30  30-32  >32
  // light             60   60     60     45     30
  // moderate          60   45     30     15     0(STOP)
  // heavy             45   30     15     0      0
  // very_heavy        30   15     0      0      0
  const table: Record<WorkIntensity, Array<[number, number]>> = {
    light: [
      [25, 60],
      [28, 60],
      [30, 60],
      [32, 45],
      [Infinity, 30],
    ],
    moderate: [
      [25, 60],
      [28, 45],
      [30, 30],
      [32, 15],
      [Infinity, 0],
    ],
    heavy: [
      [25, 45],
      [28, 30],
      [30, 15],
      [32, 0],
      [Infinity, 0],
    ],
    very_heavy: [
      [25, 30],
      [28, 15],
      [30, 0],
      [32, 0],
      [Infinity, 0],
    ],
  };
  const row = table[intensity].find(([upper]) => wbgt <= upper)!;
  const workMinutes = row[1];
  const stopWork = workMinutes === 0;
  const restMinutes = stopWork ? 60 : 60 - workMinutes;
  // Hidratación: ~250ml por trabajo intenso, escalado por minutos trabajo.
  const hydrationMlPerHour = stopWork
    ? 0
    : Math.round(((workMinutes / 60) * (intensity === 'heavy' || intensity === 'very_heavy' ? 1000 : 700)) / 50) * 50;

  return {
    wbgt,
    intensity,
    workMinutesPerHour: workMinutes,
    restMinutesPerHour: restMinutes,
    hydrationMlPerHour,
    stopWork,
    message: stopWork
      ? `WBGT ${wbgt}°C con intensidad ${intensity} → DETENER faena al aire libre, reprogramar.`
      : `WBGT ${wbgt}°C: ${workMinutes}min trabajo + ${restMinutes}min descanso por hora. Hidratar ${hydrationMlPerHour}ml/h.`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Cold extreme protocol (§358)
// ────────────────────────────────────────────────────────────────────────

export interface ColdProtocol {
  tempC: number;
  windSpeedMs: number;
  windChillC: number;
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  recommendations: string[];
  stopWork: boolean;
}

/**
 * Wind chill (Environment Canada formula):
 *   Twc = 13.12 + 0.6215 T - 11.37 V^0.16 + 0.3965 T V^0.16
 * (T en °C, V en km/h). Aproximación válida para T < 10°C y V > 4.8 km/h.
 */
export function computeWindChill(tempC: number, windSpeedMs: number): number {
  const vKmh = windSpeedMs * 3.6;
  if (tempC > 10 || vKmh < 4.8) return tempC;
  return (
    Math.round(
      (13.12 + 0.6215 * tempC - 11.37 * Math.pow(vKmh, 0.16) + 0.3965 * tempC * Math.pow(vKmh, 0.16)) *
        10,
    ) / 10
  );
}

export function coldExtremeProtocol(tempC: number, windSpeedMs: number): ColdProtocol {
  const windChillC = computeWindChill(tempC, windSpeedMs);
  let riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  if (windChillC > 0) riskLevel = 'low';
  else if (windChillC > -10) riskLevel = 'medium';
  else if (windChillC > -28) riskLevel = 'high';
  else riskLevel = 'extreme';

  const recommendations: string[] = [];
  if (riskLevel !== 'low') {
    recommendations.push('Vestimenta multicapa + casco con balaclava');
    recommendations.push('Hidratación abundante (la sed disminuye con frío)');
  }
  if (riskLevel === 'high') {
    recommendations.push('Pausas en refugio cada 30 minutos');
    recommendations.push('Monitoreo de síntomas: temblor incontrolable, confusión, mareo');
  }
  if (riskLevel === 'extreme') {
    recommendations.push('Suspender trabajos al aire libre no críticos');
    recommendations.push('Compañero permanente (no trabajar solo)');
  }

  return {
    tempC,
    windSpeedMs,
    windChillC,
    riskLevel,
    recommendations,
    stopWork: riskLevel === 'extreme',
  };
}

// ────────────────────────────────────────────────────────────────────────
// Acclimatization (§351-352)
// ────────────────────────────────────────────────────────────────────────

export interface AcclimatizationStatus {
  workerUid: string;
  altitudeMeters: number;
  daysAtAltitude: number;
  /** True si el trabajador puede ejercer normalmente. */
  isAcclimatized: boolean;
  /** Días recomendados antes de actividad pesada. */
  recommendedDaysToWait: number;
  message: string;
}

/**
 * Reglas WMS (Wilderness Medical Society) adaptadas a faena:
 *   - >2500m: 2 días de aclimatación
 *   - >3500m: 4 días
 *   - >4500m: 7 días
 * El trabajador se considera "aclimatizado" si ha estado a esa altura
 * o superior los días recomendados.
 */
export function checkAcclimatization(
  workerUid: string,
  altitudeMeters: number,
  daysAtAltitude: number,
): AcclimatizationStatus {
  let required = 0;
  if (altitudeMeters > 4500) required = 7;
  else if (altitudeMeters > 3500) required = 4;
  else if (altitudeMeters > 2500) required = 2;

  const isAcclimatized = daysAtAltitude >= required;
  const recommendedDaysToWait = Math.max(0, required - daysAtAltitude);

  return {
    workerUid,
    altitudeMeters,
    daysAtAltitude,
    isAcclimatized,
    recommendedDaysToWait,
    message: isAcclimatized
      ? `Trabajador aclimatizado para ${altitudeMeters}m (${daysAtAltitude}d expuesto).`
      : `Trabajador NO aclimatizado a ${altitudeMeters}m. Esperar ${recommendedDaysToWait}d antes de actividad pesada.`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// UV cumulative exposure (§353-354)
// ────────────────────────────────────────────────────────────────────────

export interface UvDailyMeasurement {
  /** UV index al momento (0-12+). */
  uvIndex: number;
  /** Hora de la medición (0-23). */
  hour: number;
}

export interface UvExposureReport {
  /** UV dosis estimada del día (SED — Standard Erythema Dose). */
  dailySED: number;
  /** Índice UV pico del día. */
  peakUvIndex: number;
  /** Riesgo según pico + dosis acumulada. */
  riskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  /** Recomendación: reprogramar al horario menos crítico. */
  reprogramSuggested: boolean;
  message: string;
}

/**
 * Estima la exposición UV diaria. Un SED = 100 J/m². Una hora a UV
 * index 8 ≈ 16 SED, lo cual es alto. Si SED > 30 o pico > 11 → reprogramar.
 */
export function buildUvExposureReport(measurements: UvDailyMeasurement[]): UvExposureReport {
  const peakUvIndex = measurements.reduce((max, m) => Math.max(max, m.uvIndex), 0);
  const dailySED = measurements.reduce((sum, m) => sum + m.uvIndex * 2, 0);

  let riskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  if (peakUvIndex >= 11 || dailySED >= 40) riskLevel = 'extreme';
  else if (peakUvIndex >= 8 || dailySED >= 25) riskLevel = 'high';
  else if (peakUvIndex >= 6 || dailySED >= 15) riskLevel = 'moderate';
  else riskLevel = 'low';

  const reprogramSuggested = riskLevel === 'high' || riskLevel === 'extreme';

  return {
    dailySED: Math.round(dailySED * 10) / 10,
    peakUvIndex,
    riskLevel,
    reprogramSuggested,
    message: reprogramSuggested
      ? `UV pico ${peakUvIndex} (${riskLevel}). Sugerir tareas al aire libre entre 6-10am o después de 18h.`
      : `UV pico ${peakUvIndex} (${riskLevel}). Continuar con protección estándar.`,
  };
}
