// SPDX-License-Identifier: MIT
// C.13 — Photogrammetry/SLAM bridge. LingBot-Map is not integrated yet.

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
 * Emits a conservative `slam-mesh` node for completed photogrammetry sessions.
 * `metadata.placeholder=true` remains until a real mesh consumer and any
 * LingBot-Map integration are wired end-to-end. Ref.: DS 43/2015, NFPA 30.
 */
export function generateSlamMeshNode(
  cameraSession: CameraSession,
  projectId: ProjectId,
): RiskNodePayload | null {
  if (cameraSession.keyframeCount < MIN_KEYFRAMES) return null;
  if (cameraSession.coveragePercent < MIN_COVERAGE) return null;

  const severity: RiskNodeSeverity = 'info';

  return {
    title: 'Malla de fotogrametría registrada para revisión del gemelo digital',
    description: [
      `Sesión ${cameraSession.id} → proyecto ${projectId.id}.`,
      `Keyframes=${cameraSession.keyframeCount}, cobertura=${cameraSession.coveragePercent}%.`,
      'Estado: mesh registrado; integración LingBot-Map pendiente.',
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
