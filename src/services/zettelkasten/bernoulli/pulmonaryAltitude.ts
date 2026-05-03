// SPDX-License-Identifier: MIT
// B.10 — Capacidad pulmonar + altitud (DS 594 Art. 49 / DS 28/2012).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { respiratorPressureDrop } from '../../physics/bernoulliEngine';

/** Constante barométrica (Pa) NIST sea-level. */
const P0_PA = 101325;
/** Tasa de lapso atmosférico (K/m). */
const LAPSE_K_M = 0.0065;
const T0_K = 288.15;
const G_M_S2 = 9.80665;
const M_AIR_KG_MOL = 0.0289644;
const R_J_MOLK = 8.31446;
/** Umbral DS 594 Art. 49: trabajos en altitud ≥ 3000 msnm. */
const ALT_THRESHOLD_M = 3000;

export interface PulmonaryWorker {
  id: string;
  /** Peak Expiratory Flow (L/min). */
  pefLMin: number;
}

export interface AltitudeContext {
  /** Altitud en m s.n.m. */
  masl: number;
}

export interface PulmonaryMask {
  id: string;
  filterResistancePaSPerM3: number;
  /** Caída crítica que dispara descanso obligatorio (Pa). */
  criticalDropPa: number;
}

/**
 * Modelo barométrico NIST: `P(h) = P0·(1 − Lh/T0)^(gM/RL)`.
 * Genera nodo si la combinación PEF + altitud + máscara excede el umbral
 * crítico. Ref.: DS 594 Art. 49, DS 28/2012, NIOSH (informacional).
 */
export function generatePulmonaryNode(
  worker: PulmonaryWorker,
  altitude: AltitudeContext,
  mask: PulmonaryMask,
): RiskNodePayload | null {
  if (worker.pefLMin <= 0) return null;

  const flowM3S = worker.pefLMin / 60000;
  const exponent = (G_M_S2 * M_AIR_KG_MOL) / (R_J_MOLK * LAPSE_K_M);
  const pH = P0_PA * Math.pow(Math.max(1 - (LAPSE_K_M * altitude.masl) / T0_K, 0.01), exponent);
  const pressureRatio = pH / P0_PA;
  // Aire enrarecido: el trabajador respira más rápido para mantener O₂ → flujo escala como 1/ratio.
  const altitudeMultiplier = altitude.masl > ALT_THRESHOLD_M ? 1 / pressureRatio : 1;
  const adjustedDrop = respiratorPressureDrop(mask.filterResistancePaSPerM3, flowM3S) * altitudeMultiplier;

  if (adjustedDrop <= mask.criticalDropPa) return null;

  const severity: RiskNodeSeverity = altitude.masl > ALT_THRESHOLD_M ? 'high' : 'medium';

  return {
    title: 'Capacidad pulmonar comprometida en altitud',
    description: [
      `Trabajador ${worker.id} (PEF=${worker.pefLMin} L/min) con máscara ${mask.id} a ${altitude.masl} m s.n.m.`,
      `P(h)=${(pH / 1000).toFixed(1)} kPa; multiplicador altitud×${altitudeMultiplier.toFixed(2)}.`,
      `Δp ajustado=${adjustedDrop.toFixed(2)} Pa vs crítico ${mask.criticalDropPa.toFixed(2)} Pa.`,
      'Ref.: DS 594 Art. 49, DS 28/2012.',
    ].join('\n'),
    type: 'pulmonary-altitude',
    severity,
    metadata: {
      flowM3S,
      ambientPressurePa: pH,
      altitudeMultiplier,
      adjustedDrop,
    },
    connections: [worker.id, mask.id],
    references: ['DS 594 Art. 49', 'DS 28/2012'],
  };
}
