// SPDX-License-Identifier: MIT
// Sprint 15 — Windowed predictive trigger.
//
// Pure function that, given the CURRENT environmental reading and a
// FORECAST function returning the predicted reading +N minutes ahead,
// decides whether to emit a "lead-time" alert BEFORE the risk
// materializes. The economy is positive: a fired alert never costs XP;
// when the crew acknowledges with "Atendido", they EARN XP.
//
// This module is intentionally infrastructure-free: no fetch, no
// Firestore, no timers. The scheduler (alertScheduler.ts) wires real I/O.

export interface PredictiveContext {
  /** The instantaneous reading right now (e.g. wind speed, gas ppm). */
  currentValue: number;
  /** The threshold at which the underlying generator considers "risk". */
  threshold: number;
  /** Identifier of the Bernoulli generator owning this trigger. */
  generatorId: string;
}

export interface WindowedDecision {
  fire: boolean;
  /** Minutes ahead of the materialization point that the alert is fired. */
  leadTimeMin: number;
  /** Recommended human-readable mitigation in Spanish. */
  recommendedAction: string;
  /** Forecast value the decision was based on. */
  forecastValue: number;
}

/**
 * Forecast function: given a number of minutes ahead, returns the
 * predicted scalar reading. Implementations may interpolate between
 * weather samples, IoT history, etc. Caller passes a closure wrapping
 * whatever data source is appropriate.
 */
export type ForecastFn = (minutesAhead: number) => number;

/**
 * Decision rule:
 *   1. Walk forward in 1-minute steps from +1 to +windowMinutes.
 *   2. Find the FIRST step where forecast >= threshold (risk
 *      materializes).
 *   3. Fire iff that step is at least `minLeadTimeMin` minutes in the
 *      future (so the crew has time to react). leadTimeMin is the gap
 *      between "now" and that step.
 *   4. Never fire if currentValue is already >= threshold (that's a
 *      reactive alert, handled by the underlying generator, not by this
 *      lead-time module — and a predictive system that fires while the
 *      hazard is already present would feel punitive).
 */
export function shouldFireWindowed(
  ctx: PredictiveContext,
  forecast: ForecastFn,
  options: {
    windowMinutes?: number;
    minLeadTimeMin?: number;
    recommendedAction?: string;
  } = {}
): WindowedDecision {
  const windowMinutes = options.windowMinutes ?? 15;
  const minLeadTimeMin = options.minLeadTimeMin ?? 5;
  const action = options.recommendedAction ?? 'Pausar tarea y reevaluar en 10 minutos.';

  // Skip if hazard already present.
  if (ctx.currentValue >= ctx.threshold) {
    return { fire: false, leadTimeMin: 0, recommendedAction: action, forecastValue: ctx.currentValue };
  }

  for (let m = 1; m <= windowMinutes; m++) {
    const forecastValue = forecast(m);
    if (forecastValue >= ctx.threshold) {
      const leadTimeMin = m;
      return {
        fire: leadTimeMin >= minLeadTimeMin,
        leadTimeMin,
        recommendedAction: action,
        forecastValue,
      };
    }
  }
  // Forecast never crosses threshold inside the window.
  return { fire: false, leadTimeMin: 0, recommendedAction: action, forecastValue: forecast(windowMinutes) };
}

/**
 * Default Spanish-CL recommendations per Bernoulli generator id. Used by
 * the scheduler to pick a mitigation when the generator doesn't supply
 * one explicitly. Keys mirror `bernoulliNodeRegistry`.
 */
export const RECOMMENDED_ACTIONS_ES: Record<string, string> = {
  'scaffold-uplift': 'Asegurar el andamiaje y suspender trabajo en altura.',
  'structural-wind': 'Detener izaje de carga y refugiar al personal.',
  'gas-leak-anomaly': 'Evacuar el área y ventilar antes de reanudar.',
  'gas-dispersion': 'Despejar la zona aguas abajo del viento.',
  'confined-space-vent': 'Aumentar caudal de ventilación y verificar atmósfera.',
  'hazmat-pipe': 'Reducir presión y verificar líneas antes de continuar.',
  'hidrante-pressure': 'Validar presión de red antes de iniciar maniobra.',
  'misting-suppression': 'Activar nebulización adicional.',
  'mining-extraction': 'Verificar Venturi y reposicionar al personal.',
  'respirator-fatigue': 'Programar relevo del operador.',
  'pulmonary-altitude': 'Iniciar protocolo de aclimatación.',
  'micro-wind-energy': 'Reducir carga en aerogenerador.',
  'slope-stability': 'Despejar el pie del talud.',
  'slam-mesh': 'Re-escanear malla SLAM y verificar integridad.',
  'dike-hydrostatic': 'Inspeccionar dique e iniciar achique preventivo.',
};
