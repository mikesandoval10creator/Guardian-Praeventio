// Praeventio Guard — §12.7.4: Telemetría IoT ↔ Probabilidad Falla
//
// Calcula score de probabilidad de falla por equipo basado en telemetría
// histórica (vibración + temperatura + horas operativas + alertas previas).
// El score se proyecta como "arista roja" en RiskNetwork cuando supera
// umbral CRITICAL — la UI dibuja conexión Equipment→FailureRisk.
//
// Determinístico, sin LLM ni I/O. Composable con sensorBus para input.
//
// Fórmula heurística (sin ML por ahora — Sprint 27 podría agregar LSTM):
//
//   score = w_vib × vibration_norm
//         + w_temp × temp_norm
//         + w_hours × hours_norm
//         + w_alerts × alert_density
//
// donde cada componente está normalizado [0,1] y los pesos suman 1.

export interface IoTTelemetryWindow {
  /** ID único del equipo. */
  equipmentId: string;
  /** Vibración RMS en mm/s (ISO 10816 para máquinas rotativas). */
  vibrationRMSmms: number;
  /** Temperatura promedio últimas 24h °C. */
  avgTempC: number;
  /** Horas operativas totales. */
  totalOperatingHours: number;
  /** Cantidad alertas críticas últimos 30 días. */
  alertsCriticalCount30d: number;
  /** Cantidad alertas warning últimos 30 días. */
  alertsWarningCount30d: number;
  /** Horas operativas desde última mantenimiento preventivo. */
  hoursSinceLastMaintenance: number;
}

export interface FailureScoreResult {
  equipmentId: string;
  /** Score 0-100, donde 100 = falla muy probable. */
  failureScore: number;
  /** Categoría derivada del score. */
  riskCategory: 'low' | 'medium' | 'high' | 'critical';
  /** Descomposición por factor (debugging). */
  components: {
    vibration: number;
    temperature: number;
    hours: number;
    alertDensity: number;
  };
  /**
   * Si score >= 70 → la UI debe dibujar arista roja Equipment→FailureRisk.
   */
  shouldDrawRedEdge: boolean;
  /** Recomendación accionable. */
  recommendation: string;
}

// Pesos por categoría (suman 1.0). Vibración es predictor más fuerte
// per ISO 10816 + mantenimiento predictivo industria.
const WEIGHTS = {
  vibration: 0.35,
  temperature: 0.20,
  hours: 0.20,
  alertDensity: 0.25,
} as const;

// Umbrales ISO 10816 zona D (>11.2 mm/s = severo riesgo de falla)
const VIBRATION_ZONE_D_MAX = 11.2;
const TEMP_DELTA_MAX = 50; // °C sobre nominal
const HOURS_MAINT_OVERDUE_THRESHOLD = 2_000; // hr sin mantención
const ALERTS_PER_DAY_CRITICAL = 1; // 1+ alerta crítica/día = grave

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula score de probabilidad de falla para un equipo.
 *
 * Inputs en raw units; función normaliza internamente.
 */
export function calculateFailureScore(
  window: IoTTelemetryWindow,
): FailureScoreResult {
  // Normalización de cada factor a [0,1].
  const vibrationNorm = clamp01(window.vibrationRMSmms / VIBRATION_ZONE_D_MAX);
  const tempNorm = clamp01((window.avgTempC - 25) / TEMP_DELTA_MAX);
  // Horas sin mantención → mientras más alto, más probable falla.
  const hoursNorm = clamp01(
    window.hoursSinceLastMaintenance / HOURS_MAINT_OVERDUE_THRESHOLD,
  );
  // Densidad alertas: cada crítica vale 3× warning. Normalizada por 30 días.
  const alertDensityRaw =
    (window.alertsCriticalCount30d * 3 + window.alertsWarningCount30d) / 30;
  const alertDensityNorm = clamp01(alertDensityRaw / ALERTS_PER_DAY_CRITICAL);

  // Score compuesto ponderado, escala 0-100.
  const compositeScore =
    (vibrationNorm * WEIGHTS.vibration +
      tempNorm * WEIGHTS.temperature +
      hoursNorm * WEIGHTS.hours +
      alertDensityNorm * WEIGHTS.alertDensity) *
    100;

  const failureScore = round2(compositeScore);

  let riskCategory: FailureScoreResult['riskCategory'];
  let recommendation: string;
  if (failureScore >= 70) {
    riskCategory = 'critical';
    recommendation =
      'INMEDIATO: detener equipo y solicitar mantención correctiva. Riesgo de falla catastrófica + accidente DS 132.';
  } else if (failureScore >= 50) {
    riskCategory = 'high';
    recommendation =
      'Agendar mantención preventiva próximas 48h. Aumentar frecuencia inspección visual.';
  } else if (failureScore >= 30) {
    riskCategory = 'medium';
    recommendation =
      'Monitoreo cercano. Verificar alineación + lubricación próxima parada planificada.';
  } else {
    riskCategory = 'low';
    recommendation =
      'Operación normal. Continuar plan mantención preventiva estándar.';
  }

  return {
    equipmentId: window.equipmentId,
    failureScore,
    riskCategory,
    components: {
      vibration: round2(vibrationNorm * 100),
      temperature: round2(tempNorm * 100),
      hours: round2(hoursNorm * 100),
      alertDensity: round2(alertDensityNorm * 100),
    },
    shouldDrawRedEdge: failureScore >= 70,
    recommendation,
  };
}

/**
 * Calcula scores para múltiples equipos en batch. Útil para dashboard
 * Engineering o input al Zettelkasten RiskNetwork.
 *
 * Retorna ordenado por score descendente (peores primero).
 */
export function calculateFailureScoresBatch(
  windows: IoTTelemetryWindow[],
): FailureScoreResult[] {
  return windows
    .map(calculateFailureScore)
    .sort((a, b) => b.failureScore - a.failureScore);
}

/**
 * Filtra solo equipos en zona CRITICAL (score >= 70). Útil para feed
 * de alertas push o "aristas rojas" RiskNetwork rendering.
 */
export function getCriticalEquipment(
  windows: IoTTelemetryWindow[],
): FailureScoreResult[] {
  return calculateFailureScoresBatch(windows).filter(
    (r) => r.riskCategory === 'critical',
  );
}
