// SPDX-License-Identifier: MIT
// B.6 — Ventilación táctica en minería (efecto Venturi extracción gases).

import type { RiskNodePayload, RiskNodeSeverity } from '../types';
import { venturiFlowRate } from '../../physics/bernoulliEngine';

const AIR_DENSITY_KG_M3 = 1.225;
/** Mínimo ACH por DS 594 Art. 32 / DS 132 Art. 75 (minería subterránea). */
const MIN_ACH_DS594 = 12;

export interface MiningTunnel {
  id: string;
  volumeM3: number;
  /** Área boca de túnel (m²). */
  inletAreaM2: number;
  /** Área garganta Venturi (m²). */
  throatAreaM2: number;
  /** ΔP Venturi (Pa). */
  deltaPPa: number;
}

export interface IoTSensorBundle {
  /** Identificador del sensor IoT principal. */
  sensorId: string;
  /** Concentración medida del gas crítico (ppm). */
  measuredPpm: number;
  /** Concentración OEL (ppm). */
  oelPpm: number;
}

/**
 * Wrap del existing `venturiFlowRate` con metadata IoT. Genera nodo cuando el
 * ACH calculado < 12 o el sensor IoT mide > OEL. Ref.: DS 594 Art. 32, DS 132
 * Art. 75.
 */
export function generateMiningExtractionNode(
  tunnel: MiningTunnel,
  sensors: IoTSensorBundle,
): RiskNodePayload | null {
  if (tunnel.volumeM3 <= 0) return null;
  if (tunnel.inletAreaM2 <= tunnel.throatAreaM2) return null;
  if (tunnel.deltaPPa < 0) return null;

  const flowM3S = venturiFlowRate(
    tunnel.inletAreaM2,
    tunnel.throatAreaM2,
    tunnel.deltaPPa,
    AIR_DENSITY_KG_M3,
  );
  const ach = (flowM3S * 3600) / tunnel.volumeM3;
  const ventilationOk = ach >= MIN_ACH_DS594;
  const sensorOk = sensors.measuredPpm <= sensors.oelPpm;
  if (ventilationOk && sensorOk) return null;

  const severity: RiskNodeSeverity = !sensorOk ? 'critical' : 'high';

  return {
    title: 'Ventilación de túnel insuficiente o gas sobre OEL',
    description: [
      `Túnel ${tunnel.id}: Q=${flowM3S.toFixed(3)} m³/s, ACH=${ach.toFixed(1)} (mín ${MIN_ACH_DS594}).`,
      `Sensor ${sensors.sensorId}: ${sensors.measuredPpm} ppm (OEL ${sensors.oelPpm} ppm).`,
      'Ref.: DS 594 Art. 32, DS 132 Art. 75.',
    ].join('\n'),
    type: 'mining-extraction',
    severity,
    metadata: {
      flowM3S,
      ach,
      ventilationOk,
      sensorOk,
      measuredPpm: sensors.measuredPpm,
      oelPpm: sensors.oelPpm,
    },
    connections: [tunnel.id, sensors.sensorId],
    references: ['DS 594 Art. 32', 'DS 132 Art. 75'],
  };
}
