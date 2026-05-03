// SPDX-License-Identifier: MIT
// C.14 — Monitor hidrostático de diques / tranques de relaves.

import type { RiskNodePayload, RiskNodeSeverity } from '../types';

const G_M_S2 = 9.80665;

export interface Dike {
  id: string;
  /** Altura del dique (m). */
  heightM: number;
  /** Densidad del fluido retenido (kg/m³). Pulpa relave ≈ 1500. */
  fluidDensityKgM3: number;
}

export interface PiezometerReading {
  id: string;
  /** Profundidad del piezómetro (m). */
  depthM: number;
  /** Presión medida (Pa). */
  measuredPressurePa: number;
}

/** Tolerancia: 15 % de desviación dispara alerta de infiltración. */
const INFILTRATION_TOLERANCE = 0.15;

/**
 * Genera nodo `dike-hydrostatic` cuando algún piezómetro mide una presión
 * < (1 − tolerancia) × ρgh esperada (sugiere infiltración / pérdida de
 * confinamiento). Ref.: DS 248/2007, Resolución 1500 SERNAGEOMIN.
 */
export function generateDikeNode(
  dike: Dike,
  sensors: PiezometerReading[],
): RiskNodePayload | null {
  if (dike.heightM <= 0 || dike.fluidDensityKgM3 <= 0) return null;
  if (sensors.length === 0) return null;

  const anomalies: { id: string; expectedPa: number; measuredPa: number; deviation: number }[] = [];
  for (const sensor of sensors) {
    if (sensor.depthM <= 0) continue;
    const expectedPa = dike.fluidDensityKgM3 * G_M_S2 * sensor.depthM;
    const deviation = (expectedPa - sensor.measuredPressurePa) / expectedPa;
    if (deviation > INFILTRATION_TOLERANCE) {
      anomalies.push({ id: sensor.id, expectedPa, measuredPa: sensor.measuredPressurePa, deviation });
    }
  }

  if (anomalies.length === 0) return null;

  const worst = anomalies.reduce((a, b) => (a.deviation > b.deviation ? a : b));
  const severity: RiskNodeSeverity = worst.deviation > 0.3 ? 'critical' : 'high';

  return {
    title: 'Anomalía piezométrica: posible infiltración en dique',
    description: [
      `Dique ${dike.id} (h=${dike.heightM} m, ρ=${dike.fluidDensityKgM3} kg/m³).`,
      `Sensores anómalos: ${anomalies.length}/${sensors.length}.`,
      `Peor caso: ${worst.id} → esperado ${(worst.expectedPa / 1000).toFixed(1)} kPa, medido ${(worst.measuredPa / 1000).toFixed(1)} kPa (caída ${(worst.deviation * 100).toFixed(0)}%).`,
      'Ref.: DS 248/2007, Resolución 1500 SERNAGEOMIN.',
    ].join('\n'),
    type: 'dike-hydrostatic',
    severity,
    metadata: {
      anomalyCount: anomalies.length,
      worstSensorId: worst.id,
      worstDeviation: worst.deviation,
      worstExpectedPa: worst.expectedPa,
      worstMeasuredPa: worst.measuredPa,
    },
    connections: [dike.id, ...anomalies.map((a) => a.id)],
    references: ['DS 248/2007', 'Resolución 1500 SERNAGEOMIN'],
  };
}
