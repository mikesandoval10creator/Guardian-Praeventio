// SPDX-License-Identifier: MIT
// A.4 — Monitoreo de espacios confinados: gradiente de presión HVAC.

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { staticPressureDelta } from '../../physics/bernoulliEngine';

const AIR_DENSITY_KG_M3 = 1.225; // NIST air

export interface ConfinedSpace {
  id: string;
  volumeM3: number;
  /** Densidad relativa del contaminante (1.0 = aire). H2S = 1.19. */
  contaminantRelDensity: number;
}

export interface ConfinedExtractor {
  /** Velocidad de extracción inferior (m/s). */
  extractionVelocityMs: number;
  /** Velocidad de aspiración superior (m/s). */
  intakeVelocityMs: number;
  /** Caudal nominal (m³/s). */
  flowRateM3S: number;
}

export interface ContaminantSensor {
  /** Gradiente de presión medido por el sensor (Pa). */
  measuredDeltaPPa: number;
}

/** Tolerancia normativa: ±20 % del gradiente calculado (DS 594 Art. 35). */
const TOLERANCE = 0.2;
/** Renovaciones de aire / hora mínimas. */
const MIN_ACH = 6;

/**
 * Genera un nodo Zettelkasten si el gradiente de presión necesario para evacuar
 * gases pesados (H₂S, CO₂) NO se cumple según `ΔP = ½ρ(v₂²−v₁²)`, o si el
 * sensor mide >20 % de desviación del cálculo, o si ACH < 6. Ref.: DS 594
 * Art. 35 / Art. 61, DS 132 Art. 74, OSHA 29 CFR 1910.146.
 */
export function generateConfinedSpaceVentNode(
  space: ConfinedSpace,
  extractor: ConfinedExtractor,
  contaminant: ContaminantSensor,
): RiskNodePayload | null {
  if (space.volumeM3 <= 0 || extractor.flowRateM3S <= 0) return null;

  const rhoEffective = AIR_DENSITY_KG_M3 * Math.max(space.contaminantRelDensity, 0.5);
  const computedDelta = staticPressureDelta(
    rhoEffective,
    extractor.intakeVelocityMs,
    extractor.extractionVelocityMs,
  );
  const ach = (extractor.flowRateM3S * 3600) / space.volumeM3;
  const deviation = computedDelta !== 0
    ? Math.abs((contaminant.measuredDeltaPPa - computedDelta) / computedDelta)
    : 0;
  const achOk = ach >= MIN_ACH;
  const gradientOk = computedDelta > 0;
  const sensorOk = deviation <= TOLERANCE;

  if (achOk && gradientOk && sensorOk) return null;

  const severity: RiskNodeSeverity = !gradientOk || !achOk ? 'critical' : 'high';

  return {
    title: 'Gradiente de presión insuficiente para espacio confinado',
    description: [
      `Espacio ${space.id} (V=${space.volumeM3} m³, ρ_rel=${space.contaminantRelDensity}).`,
      `ΔP calculado: ${computedDelta.toFixed(1)} Pa, sensor: ${contaminant.measuredDeltaPPa.toFixed(1)} Pa, desviación ${(deviation * 100).toFixed(0)}%.`,
      `ACH=${ach.toFixed(1)} (mín ${MIN_ACH}).`,
      'Ref.: DS 594 Art. 35 / 61, DS 132 Art. 74, OSHA 29 CFR 1910.146.',
    ].join('\n'),
    type: 'confined-space-vent',
    severity,
    metadata: {
      computedDeltaPa: computedDelta,
      measuredDeltaPa: contaminant.measuredDeltaPPa,
      deviation,
      ach,
      achOk,
      gradientOk,
      sensorOk,
    },
    connections: [space.id],
    references: ['DS 594 Art. 35', 'DS 594 Art. 61', 'DS 132 Art. 74', 'OSHA 29 CFR 1910.146'],
  };
}
