// Praeventio Guard — Sprint 39 Fase D.3: Modelo térmico 1R1C + CO2 HVAC.
//
// Cierra: Plan Fase D.3 "Modelo térmico 1R1C + balance CO2 HVAC".
//
// Modela una zona ocupacional como un sistema de primer orden:
//
//   Térmico 1R1C:
//     C · dT/dt = (T_amb - T) / R + Q_internas + Q_hvac
//   donde C = capacitancia térmica (J/K), R = resistencia (K/W).
//
//   CO2 balance (well-mixed):
//     V · dC/dt = G - Q · (C - C_outside)
//   donde V = volumen (m³), G = generación interna (m³ CO2/h),
//         Q = renovación aire (m³/h), C en ppm.
//
// Aplicaciones:
//   - Sala de control: ¿se calienta el server room sin AC funcional?
//   - Espacio confinado: ¿hay riesgo de acumulación CO2 con N personas?
//   - Bodega químicos: predicción de evaporación + COV con T° y ventilación.
//
// 100% determinístico, sin LLM. Test deterministic con casos canónicos
// ASHRAE 62.1 / 90.1.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface ThermalZone {
  /** Capacitancia térmica (J/K). Aprox = volumen × densidad × cp aire (1200). */
  thermalCapacityJperK: number;
  /** Resistencia térmica zona-ambiente (K/W). */
  thermalResistanceKperW: number;
}

export interface ThermalDriver {
  /** Temperatura ambiente exterior (°C). */
  ambientC: number;
  /** Calor interno aportado (W) — equipos, ocupantes (≈100 W/persona en oficina). */
  internalGainW: number;
  /** Aporte HVAC (W) — positivo = calentar, negativo = enfriar. */
  hvacW: number;
}

export interface ThermalStep {
  /** Temperatura actual de la zona (°C). */
  currentC: number;
  /** Paso de tiempo (s). */
  dtSeconds: number;
}

/**
 * Avanza un paso de tiempo dt usando Euler explícito:
 *   T_{n+1} = T_n + dt/C · ((T_amb − T_n)/R + Q_int + Q_hvac)
 *
 * dt grande con C pequeña puede inestabilizar; mantener dt ≤ R·C/4 para safety.
 */
export function thermalStep(
  zone: ThermalZone,
  driver: ThermalDriver,
  state: ThermalStep,
): { newCurrentC: number } {
  const Q_conduction = (driver.ambientC - state.currentC) / zone.thermalResistanceKperW;
  const Q_total = Q_conduction + driver.internalGainW + driver.hvacW;
  const dT = (Q_total * state.dtSeconds) / zone.thermalCapacityJperK;
  return { newCurrentC: state.currentC + dT };
}

/**
 * Avanza N pasos para simular evolución térmica de la zona.
 * Devuelve la serie completa para gráficos.
 */
export interface ThermalSeriesPoint {
  timeSec: number;
  temperatureC: number;
}

export function simulateThermalEvolution(
  zone: ThermalZone,
  driver: ThermalDriver,
  initialC: number,
  dtSeconds: number,
  totalSteps: number,
): ThermalSeriesPoint[] {
  const series: ThermalSeriesPoint[] = [{ timeSec: 0, temperatureC: initialC }];
  let cur = initialC;
  for (let i = 1; i <= totalSteps; i++) {
    const { newCurrentC } = thermalStep(zone, driver, {
      currentC: cur,
      dtSeconds,
    });
    cur = newCurrentC;
    series.push({ timeSec: i * dtSeconds, temperatureC: cur });
  }
  return series;
}

/**
 * Steady-state temperature (cuando dT/dt = 0):
 *   T_ss = T_amb + R · (Q_int + Q_hvac)
 */
export function steadyStateTemperatureC(
  zone: ThermalZone,
  driver: ThermalDriver,
): number {
  return driver.ambientC + zone.thermalResistanceKperW * (driver.internalGainW + driver.hvacW);
}

// ────────────────────────────────────────────────────────────────────────
// 2. CO2 balance (well-mixed zone)
// ────────────────────────────────────────────────────────────────────────

/**
 * Generación de CO2 por persona en reposo según ASHRAE 62.1.
 * 0.0048 L/s = 17.28 L/h por persona en actividad ligera.
 */
export const CO2_PER_PERSON_LH = 17.28;

/** Concentración exterior típica (Mauna Loa 2024: ~420 ppm). */
export const CO2_OUTSIDE_PPM = 420;

/** Conversión 1 ppm CO2 = 1 mL/m³. */
const PPM_TO_M3_PER_M3 = 1e-6;

export interface CO2Zone {
  /** Volumen total de la zona (m³). */
  volumeM3: number;
  /** Renovación de aire en m³/h (ACH × volumen = renovación). */
  airExchangeM3perH: number;
  /** Concentración exterior (ppm). */
  outsidePpm?: number;
}

export interface CO2Driver {
  occupancyCount: number;
  /** Multiplier por actividad (1 reposo, 1.5 ligera, 2.5 moderada). */
  activityFactor?: number;
}

export interface CO2Step {
  currentPpm: number;
  dtSeconds: number;
}

/**
 * Avanza un paso del balance CO2 well-mixed:
 *   dC/dt = G/V − (Q/V)·(C − C_out)
 * donde G = generación m³/h por TOTAL ocupantes, Q = m³/h ventilación.
 * En ppm/s.
 */
export function co2Step(
  zone: CO2Zone,
  driver: CO2Driver,
  state: CO2Step,
): { newPpm: number } {
  const occ = Math.max(0, driver.occupancyCount);
  const activity = driver.activityFactor ?? 1;
  const outPpm = zone.outsidePpm ?? CO2_OUTSIDE_PPM;

  // Generación en ppm/s:
  //   G_m3_per_s = occ × (CO2_PER_PERSON_LH / 1000) × activity / 3600
  //   ppm/s = G_m3_per_s / V * 1e6
  const G_m3_per_s = (occ * (CO2_PER_PERSON_LH / 1000) * activity) / 3600;
  const generationPpmPerS = (G_m3_per_s / zone.volumeM3) * 1e6;

  // Dilución por ventilación:
  //   Q_per_s en 1/s = (Q m³/h / 3600) / V
  const Q_per_s = zone.airExchangeM3perH / 3600 / zone.volumeM3;
  const dilutionPpmPerS = Q_per_s * (state.currentPpm - outPpm);

  const dPpm = (generationPpmPerS - dilutionPpmPerS) * state.dtSeconds;
  // Guard PPM_TO_M3 not used directly; kept exported for callers.
  void PPM_TO_M3_PER_M3;
  return { newPpm: Math.max(outPpm, state.currentPpm + dPpm) };
}

export interface CO2SeriesPoint {
  timeSec: number;
  ppm: number;
}

export function simulateCO2Evolution(
  zone: CO2Zone,
  driver: CO2Driver,
  initialPpm: number,
  dtSeconds: number,
  totalSteps: number,
): CO2SeriesPoint[] {
  const series: CO2SeriesPoint[] = [{ timeSec: 0, ppm: initialPpm }];
  let cur = initialPpm;
  for (let i = 1; i <= totalSteps; i++) {
    const { newPpm } = co2Step(zone, driver, { currentPpm: cur, dtSeconds });
    cur = newPpm;
    series.push({ timeSec: i * dtSeconds, ppm: cur });
  }
  return series;
}

/**
 * Concentración steady-state CO2:
 *   C_ss = C_out + G / Q (en consistent units)
 */
export function steadyStateCO2Ppm(zone: CO2Zone, driver: CO2Driver): number {
  if (zone.airExchangeM3perH <= 0) return Number.POSITIVE_INFINITY;
  const occ = Math.max(0, driver.occupancyCount);
  const activity = driver.activityFactor ?? 1;
  const outPpm = zone.outsidePpm ?? CO2_OUTSIDE_PPM;
  const G_m3_per_h = occ * (CO2_PER_PERSON_LH / 1000) * activity; // m3/h
  const Q_m3_per_h = zone.airExchangeM3perH;
  const ppmAddition = (G_m3_per_h / Q_m3_per_h) * 1e6;
  return outPpm + ppmAddition;
}

// ────────────────────────────────────────────────────────────────────────
// 3. Air quality alerts
// ────────────────────────────────────────────────────────────────────────

export type AirQualityLevel = 'excellent' | 'good' | 'acceptable' | 'poor' | 'critical';

/**
 * Categorización según ASHRAE 62.1 + NIOSH:
 *  <600 ppm  excellent (oficinas con buena ventilación)
 *  600-800  good
 *  800-1000 acceptable (umbral confort y atención)
 *  1000-1500 poor (somnolencia, dolor cabeza)
 *  >1500    critical (acción inmediata: ventilar)
 */
export function classifyAirQuality(ppm: number): AirQualityLevel {
  if (ppm < 600) return 'excellent';
  if (ppm < 800) return 'good';
  if (ppm < 1000) return 'acceptable';
  if (ppm < 1500) return 'poor';
  return 'critical';
}

export interface AirQualityRecommendation {
  level: AirQualityLevel;
  message: string;
  /** Acciones determinísticas. */
  actions: string[];
}

export function recommendVentilation(ppm: number): AirQualityRecommendation {
  const level = classifyAirQuality(ppm);
  switch (level) {
    case 'excellent':
      return {
        level,
        message: 'Calidad de aire excelente. Sin acción.',
        actions: [],
      };
    case 'good':
      return {
        level,
        message: 'Calidad de aire buena.',
        actions: [],
      };
    case 'acceptable':
      return {
        level,
        message: 'Calidad aceptable. Vigilancia recomendada si la jornada es prolongada.',
        actions: ['Verificar que el sistema de ventilación esté operativo.'],
      };
    case 'poor':
      return {
        level,
        message: 'Calidad pobre. Activar ventilación adicional.',
        actions: [
          'Abrir ventanas o aumentar caudal HVAC.',
          'Reducir ocupación temporalmente si es posible.',
        ],
      };
    case 'critical':
      return {
        level,
        message: 'Calidad crítica. Riesgo de somnolencia y deterioro cognitivo.',
        actions: [
          'Evacuar zona hasta que ppm < 1000.',
          'Verificar funcionamiento sistema HVAC.',
          'Reportar a mantenimiento para diagnóstico.',
        ],
      };
  }
}
