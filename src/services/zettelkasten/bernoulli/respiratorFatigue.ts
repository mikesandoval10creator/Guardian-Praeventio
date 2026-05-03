// SPDX-License-Identifier: MIT
// B.9 — Fatiga del respirador (NIOSH 42 CFR Part 84).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { respiratorPressureDrop } from '../../physics/bernoulliEngine';

export interface WorkerInfo {
  id: string;
  /** Caudal respiratorio (m³/s). NIOSH ref reposo ≈ 1e-3 m³/s. */
  breathingFlowM3S: number;
}

export interface RespiratorMask {
  id: string;
  /** Resistencia filtro (Pa·s/m³). N95 ≈ 800. */
  filterResistancePaSPerM3: number;
  /** Caída de presión nominal admisible (Pa). NIOSH N95 ≤ 343 Pa @ 85 L/min. */
  maxPressureDropPa: number;
}

export interface AmbientCondition {
  /** Temperatura ambiente (°C). */
  temperatureC: number;
}

/**
 * Genera nodo cuando `Δp = R·Q` supera el límite NIOSH del respirador.
 * Ref.: NIOSH 42 CFR Part 84, DS 594 Art. 53.
 */
export function generateRespiratorFatigueNode(
  worker: WorkerInfo,
  mask: RespiratorMask,
  ambient: AmbientCondition,
): RiskNodePayload | null {
  if (worker.breathingFlowM3S <= 0) return null;
  if (mask.filterResistancePaSPerM3 <= 0) return null;

  const dropPa = respiratorPressureDrop(mask.filterResistancePaSPerM3, worker.breathingFlowM3S);
  // Corrección por calor (>30 °C aumenta caudal +20 %).
  const adjustedDrop = ambient.temperatureC > 30 ? dropPa * 1.2 : dropPa;
  if (adjustedDrop <= mask.maxPressureDropPa) return null;

  const ratio = adjustedDrop / mask.maxPressureDropPa;
  const severity: RiskNodeSeverity = ratio > 1.5 ? 'high' : 'medium';

  return {
    title: 'Fatiga respiratoria: caída de presión sobre límite NIOSH',
    description: [
      `Trabajador ${worker.id} con respirador ${mask.id}: Δp=${adjustedDrop.toFixed(1)} Pa (límite ${mask.maxPressureDropPa.toFixed(0)} Pa).`,
      `Ratio: ${ratio.toFixed(2)} — relevar antes del fin de turno.`,
      'Ref.: NIOSH 42 CFR Part 84, DS 594 Art. 53.',
    ].join('\n'),
    type: 'respirator-fatigue',
    severity,
    metadata: { dropPa, adjustedDrop, ratio, temperatureC: ambient.temperatureC },
    connections: [worker.id, mask.id],
    references: ['NIOSH 42 CFR Part 84', 'DS 594 Art. 53'],
  };
}
