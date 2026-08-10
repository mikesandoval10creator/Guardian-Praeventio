// SPDX-License-Identifier: MIT
// C.13 — Photogrammetry/SLAM bridge. LingBot-Map is not integrated yet.
//
// Ticket 39aaa66d-73fe-8119-9c76-e26f55db154c [P2] — anti-placeholder:
// un nodo `slam-mesh` SOLO se emite cuando existe una malla REAL validada
// (URI + formato + tamaño + hash). Sin malla real, `generateSlamMeshNode`
// devuelve null — nunca afirmamos que hay una malla registrada si no la hay.

import type { RiskNodePayload, RiskNodeSeverity } from "../types";
import type { MeshFormat } from "../../digitalTwin/photogrammetry/types";

export interface CameraSession {
  id: string;
  /** Cantidad de keyframes capturados (métrica real del pipeline). */
  keyframeCount: number;
  /**
   * Cobertura estimada (%). Opcional — solo se usa como gate si el caller
   * realmente la conoce; el pipeline on-device no la reporta hoy, así que
   * NO se fabrica un valor fijo.
   */
  coveragePercent?: number;
}

export interface ProjectId {
  id: string;
}

/**
 * Artifact de malla REAL ya persistido por la pipeline de reconstrucción
 * (on-device adapter: `markJobCompleted`). Requerido — sin esto no hay nodo.
 */
export interface MeshArtifact {
  /** URL firmada del GLB en Firebase Storage. */
  meshUri: string;
  /** Formato del mesh (glb/gltf/obj/ply). */
  meshFormat: MeshFormat;
  /** Tamaño en bytes del artifact. */
  meshSizeBytes: number;
  /** Hash SHA-256 del artifact (opcional pero recomendado para auditoría). */
  sha256?: string;
}

/** Mínimo de keyframes para una malla utilizable. */
const MIN_KEYFRAMES = 30;
const MIN_COVERAGE = 60;

/**
 * Emits a `slam-mesh` node ONLY for a real, validated mesh artifact.
 *
 * Guardrails (veracidad):
 * - `mesh.meshUri` vacío/ausente → null (no afirmamos malla inexistente).
 * - keyframes/coverage bajo umbral → null.
 * - NUNCA emite `metadata.placeholder` — el nodo describe un artifact real.
 *
 * Ref.: DS 43/2015, NFPA 30.
 */
export function generateSlamMeshNode(
  cameraSession: CameraSession,
  projectId: ProjectId,
  mesh: MeshArtifact,
): RiskNodePayload | null {
  if (!mesh || typeof mesh.meshUri !== "string" || mesh.meshUri.trim() === "") {
    return null;
  }
  if (!mesh.meshFormat) return null;
  if (!Number.isFinite(mesh.meshSizeBytes) || mesh.meshSizeBytes <= 0)
    return null;
  if (cameraSession.keyframeCount < MIN_KEYFRAMES) return null;
  if (
    cameraSession.coveragePercent !== undefined &&
    cameraSession.coveragePercent < MIN_COVERAGE
  ) {
    return null;
  }

  const severity: RiskNodeSeverity = "info";

  return {
    title: "Malla de fotogrametría registrada para revisión del gemelo digital",
    description: [
      `Sesión ${cameraSession.id} → proyecto ${projectId.id}.`,
      `Keyframes=${cameraSession.keyframeCount}, cobertura=${cameraSession.coveragePercent}%.`,
      `Mesh real: ${mesh.meshFormat} (${mesh.meshSizeBytes} bytes) — ${mesh.meshUri}`,
      mesh.sha256 ? `SHA-256: ${mesh.sha256}` : "Sin hash registrado.",
      "Estado: mesh registrado; integración LingBot-Map pendiente.",
      "Ref.: DS 43/2015, NFPA 30.",
    ].join("\n"),
    type: "slam-mesh",
    severity,
    metadata: {
      keyframeCount: cameraSession.keyframeCount,
      ...(cameraSession.coveragePercent !== undefined
        ? { coveragePercent: cameraSession.coveragePercent }
        : {}),
      meshUri: mesh.meshUri,
      meshFormat: mesh.meshFormat,
      meshSizeBytes: mesh.meshSizeBytes,
      ...(mesh.sha256 ? { sha256: mesh.sha256 } : {}),
    },
    connections: [cameraSession.id, projectId.id, mesh.meshUri],
    references: ["DS 43/2015", "NFPA 30"],
  };
}
