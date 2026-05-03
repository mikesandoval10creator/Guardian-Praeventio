// SPDX-License-Identifier: MIT
// A.2 — Sistema de supresión de polvo (misting Venturi PM2.5 / sílice).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { venturiFlowRate } from '../../physics/bernoulliEngine';

const AIR_DENSITY_KG_M3 = 1.225; // NIST sea-level air, 15°C
/** Tamaño máximo de gota efectivo contra PM2.5 según ISO 14644 (50 µm). */
const MAX_EFFECTIVE_DROPLET_M = 50e-6;

export interface MistingInjector {
  id: string;
  /** Área entrada inyector (m²). */
  inletAreaM2: number;
  /** Área garganta Venturi (m²). */
  throatAreaM2: number;
  /** Caída de presión a través del Venturi (Pa). */
  deltaPPa: number;
}

export interface WaterSupply {
  /** Caudal de agua disponible (m³/s). */
  flowRateM3S: number;
  /** Presión disponible (Pa). */
  pressurePa: number;
}

export interface AirSupply {
  /** Caudal de aire disponible (m³/s). */
  availableFlowM3S: number;
}

/**
 * Genera un nodo Zettelkasten si el caudal de aire disponible es insuficiente
 * para producir neblina ultra-fina captadora de PM2.5 según el principio
 * Venturi `Q = A·√(2ΔP/ρ)`. Ref.: DS 132/2004 Art. — minería; DS 594 Art. 65
 * (sílice respirable, OEL 0.025 mg/m³); ISO 14644.
 */
export function generateMistingNode(
  injector: MistingInjector,
  water: WaterSupply,
  airSupply: AirSupply,
): RiskNodePayload | null {
  if (injector.inletAreaM2 <= injector.throatAreaM2) return null;
  if (injector.deltaPPa < 0) return null;
  if (water.flowRateM3S <= 0) return null;

  const requiredAirFlow = venturiFlowRate(
    injector.inletAreaM2,
    injector.throatAreaM2,
    injector.deltaPPa,
    AIR_DENSITY_KG_M3,
  );
  // Aproximación: el tamaño de gota es inversamente proporcional a √(velocidad de aire).
  const throatVelocity = requiredAirFlow / injector.throatAreaM2;
  const dropletSizeM = throatVelocity > 0
    ? MAX_EFFECTIVE_DROPLET_M * Math.sqrt(50 / Math.max(throatVelocity, 0.1))
    : Number.POSITIVE_INFINITY;

  const airOk = airSupply.availableFlowM3S >= requiredAirFlow;
  const dropletOk = dropletSizeM <= MAX_EFFECTIVE_DROPLET_M;
  if (airOk && dropletOk) return null;

  const severity: RiskNodeSeverity = !airOk ? 'high' : 'medium';

  return {
    title: 'Supresión de polvo: caudal de aire o tamaño de gota fuera de norma',
    description: [
      `Inyector ${injector.id}: Q_aire requerido=${(requiredAirFlow * 1000).toFixed(2)} L/s; disponible=${(airSupply.availableFlowM3S * 1000).toFixed(2)} L/s.`,
      `Tamaño gota estimado: ${(dropletSizeM * 1e6).toFixed(1)} µm (límite captura PM2.5: ${(MAX_EFFECTIVE_DROPLET_M * 1e6).toFixed(0)} µm).`,
      'Ref.: DS 132/2004 (minería), DS 594 Art. 65 (sílice respirable), ISO 14644.',
    ].join('\n'),
    type: 'misting-suppression',
    severity,
    metadata: {
      requiredAirFlowM3S: requiredAirFlow,
      availableAirFlowM3S: airSupply.availableFlowM3S,
      dropletSizeM,
      throatVelocityMs: throatVelocity,
    },
    connections: [injector.id],
    references: ['DS 132/2004', 'DS 594 Art. 65', 'ISO 14644'],
  };
}
