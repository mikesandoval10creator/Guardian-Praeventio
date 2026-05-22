// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction pipeline.
//
// Orquesta el pipeline completo VIDEO → MESH GLB sin enviar bytes fuera
// del browser:
//
//   1. extractFramesFromVideo(file)     → ExtractedFrame[]
//   2. buildPointCloudFromFrames(frames) → PointCloud
//   3. exportPointCloudToGlb(cloud)      → Blob GLB
//
// El caller (UI page o adapter) recibe un único Blob + métricas.
//
// Directiva inviolable (TODO §2.28 2026-05-21): **el video del usuario
// NUNCA sale del dispositivo**. Solo el GLB resultante puede opcionalmente
// subirse a Storage si el usuario lo elige.

import {
  extractFramesFromVideo,
  type ExtractedFrame,
  type ExtractFramesOptions,
} from './frameExtractor';
import {
  buildPointCloudFromFrames,
  type PointCloud,
  type BuildPointCloudOptions,
} from './pointCloudBuilder';
import { exportPointCloudToGlb, type ExportGlbResult } from './glbExporter';
import { logger } from '../../../utils/logger';

export interface ReconstructionMetrics {
  framesExtracted: number;
  pointsReconstructed: number;
  /** Resolución de la grilla por frame. */
  gridResolution: number;
  /** Bounding box del mesh en metros. */
  boundingBox: PointCloud['boundingBox'];
  /** Tamaño del GLB en bytes. */
  glbSizeBytes: number;
  /** Duración total del pipeline (ms). */
  durationMs: number;
  /** Cuánto duró cada etapa (ms). */
  stageDurations: {
    extractMs: number;
    pointCloudMs: number;
    exportMs: number;
  };
}

export interface ReconstructFromVideoOptions {
  /** Pasado a extractFramesFromVideo. */
  frameExtractor?: Pick<ExtractFramesOptions, 'frameCount' | 'maxWidth'>;
  /** Pasado a buildPointCloudFromFrames. */
  pointCloud?: BuildPointCloudOptions;
  /**
   * Callback de progreso macro (0-1) con stage label opcional.
   * El caller lo usa para mostrar UI bar:
   *
   *   onProgress(0.0, 'extract')
   *   onProgress(0.4, 'extract')
   *   onProgress(0.6, 'point-cloud')
   *   onProgress(1.0, 'export')
   */
  onProgress?: (ratio: number, stage: ReconstructionStage) => void;
  /** Cancel signal. Aborta la pipeline en cualquier etapa. */
  abortSignal?: AbortSignal;
}

export type ReconstructionStage = 'extract' | 'point-cloud' | 'export' | 'done';

export interface ReconstructionResult {
  /** GLB blob listo para upload o save local. */
  glb: Blob;
  /** Métricas detalladas del proceso. */
  metrics: ReconstructionMetrics;
}

/**
 * Pipeline completa: video file → GLB blob + métricas.
 *
 * Procesa todo on-device. Lanza si:
 *   - El video no se puede decodificar.
 *   - El point cloud sale vacío.
 *   - El GLTFExporter falla.
 *   - abortSignal aborta.
 *
 * Privacy guarantee: ningún byte del video se envía a Storage o backend
 * dentro de esta función. El caller decide qué hacer con el GLB resultante.
 */
export async function reconstructFromVideo(
  file: File,
  options: ReconstructFromVideoOptions = {},
): Promise<ReconstructionResult> {
  const startedAt = performance.now();
  const { onProgress, abortSignal } = options;

  // Stage 1: extract frames.
  const extractStart = performance.now();
  let frames: ExtractedFrame[];
  try {
    frames = await extractFramesFromVideo(file, {
      ...options.frameExtractor,
      onProgress: (r) => onProgress?.(r * 0.4, 'extract'),
      abortSignal,
    });
  } catch (err) {
    logger.error('[reconstructFromVideo] extract failed', { err: String(err) });
    throw err;
  }
  const extractMs = performance.now() - extractStart;
  onProgress?.(0.4, 'extract');

  if (abortSignal?.aborted) {
    throw new DOMException('reconstructFromVideo aborted', 'AbortError');
  }

  // Stage 2: point cloud.
  const pcStart = performance.now();
  let cloud: PointCloud;
  try {
    cloud = buildPointCloudFromFrames(frames, {
      ...options.pointCloud,
      onProgress: (r) => onProgress?.(0.4 + r * 0.4, 'point-cloud'),
    });
  } catch (err) {
    logger.error('[reconstructFromVideo] pointCloud failed', { err: String(err) });
    throw err;
  }
  const pointCloudMs = performance.now() - pcStart;
  onProgress?.(0.8, 'point-cloud');

  if (abortSignal?.aborted) {
    throw new DOMException('reconstructFromVideo aborted', 'AbortError');
  }

  // Stage 3: export GLB.
  const exportStart = performance.now();
  let glb: ExportGlbResult;
  try {
    glb = await exportPointCloudToGlb(cloud);
  } catch (err) {
    logger.error('[reconstructFromVideo] glbExport failed', { err: String(err) });
    throw err;
  }
  const exportMs = performance.now() - exportStart;
  onProgress?.(1, 'done');

  const totalMs = performance.now() - startedAt;

  return {
    glb: glb.blob,
    metrics: {
      framesExtracted: frames.length,
      pointsReconstructed: cloud.pointCount,
      gridResolution: cloud.gridResolution,
      boundingBox: cloud.boundingBox,
      glbSizeBytes: glb.sizeBytes,
      durationMs: Math.round(totalMs),
      stageDurations: {
        extractMs: Math.round(extractMs),
        pointCloudMs: Math.round(pointCloudMs),
        exportMs: Math.round(exportMs),
      },
    },
  };
}

export type {
  ExtractedFrame,
  ExtractFramesOptions,
  PointCloud,
  BuildPointCloudOptions,
  ExportGlbResult,
};
