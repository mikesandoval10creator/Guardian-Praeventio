// SPDX-License-Identifier: MIT
// C.13 — Placeholder SLAM / fotogrametría (LingBot-Map). Sprint futuro.

import type { RiskNodePayload, RiskNodeSeverity } from '../types';

export interface CameraSession {
  id: string;
  /** Cantidad de keyframes capturados. */
  keyframeCount: number;
  /** Cobertura estimada (%). */
  coveragePercent: number;
}

export interface ProjectId {
  id: string;
}

/** Mínimo de keyframes para una malla utilizable. */
const MIN_KEYFRAMES = 30;
const MIN_COVERAGE = 60;

/**
 * Placeholder hasta integración con LingBot-Map open source. Por ahora emite un
 * nodo `slam-mesh` cuando una sesión cumple un mínimo de keyframes/cobertura,
 * para que el Asesor pueda enlazar derrames químicos al gemelo digital cuando
 * exista. Ref.: DS 43/2015, NFPA 30.
 */
export function generateSlamMeshNode(
  cameraSession: CameraSession,
  projectId: ProjectId,
): RiskNodePayload | null {
  if (cameraSession.keyframeCount < MIN_KEYFRAMES) return null;
  if (cameraSession.coveragePercent < MIN_COVERAGE) return null;

  const severity: RiskNodeSeverity = 'info';

  return {
    title: 'Malla SLAM disponible para gemelo digital de faena',
    description: [
      `Sesión ${cameraSession.id} → proyecto ${projectId.id}.`,
      `Keyframes=${cameraSession.keyframeCount}, cobertura=${cameraSession.coveragePercent}%.`,
      'Placeholder: integración pendiente con LingBot-Map (open source).',
      'Ref.: DS 43/2015, NFPA 30.',
    ].join('\n'),
    type: 'slam-mesh',
    severity,
    metadata: {
      keyframeCount: cameraSession.keyframeCount,
      coveragePercent: cameraSession.coveragePercent,
      placeholder: true,
    },
    connections: [cameraSession.id, projectId.id],
    references: ['DS 43/2015', 'NFPA 30'],
  };
}
