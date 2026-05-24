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
  buildPointCloudFromFramesAsync,
  type PointCloud,
  type BuildPointCloudOptions,
} from './pointCloudBuilder';
import { exportPointCloudToGlb, type ExportGlbResult } from './glbExporter';
import { exportPointCloudToUsdz, type ExportUsdzResult } from './usdzExporter';
import { tryCreateMidasEstimator, type DepthEstimator } from './midasDepthEstimator';
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
  /** Tamaño del USDZ en bytes (solo si emitUsdz=true). */
  usdzSizeBytes?: number;
  /** Duración total del pipeline (ms). */
  durationMs: number;
  /** Cuánto duró cada etapa (ms). */
  stageDurations: {
    extractMs: number;
    pointCloudMs: number;
    exportMs: number;
    /** Solo presente si emitUsdz=true. */
    usdzExportMs?: number;
  };
}

export interface ReconstructFromVideoOptions {
  /** Pasado a extractFramesFromVideo. */
  frameExtractor?: Pick<ExtractFramesOptions, 'frameCount' | 'maxWidth'>;
  /** Pasado a buildPointCloudFromFrames. */
  pointCloud?: BuildPointCloudOptions;
  /**
   * §2.28 (2026-05-23) — Emitir también USDZ para iOS Quick Look. El USDZ
   * convierte el point cloud a quads (2 triángulos por punto), porque
   * AR Quick Look no soporta POINTS primitive. Add ~30% al tiempo de
   * export. Default true — agrega ~100 KB pero da acceso iOS AR.
   */
  emitUsdz?: boolean;
  /** Tamaño del quad por punto en metros, default 0.05. */
  quadSize?: number;
  /**
   * §Fase D.1 (2026-05-23) — Si true, intenta cargar MiDaS depth ML
   * on-device para reemplazar la heurística brightness/edge por
   * inferencia ONNX real. Si el modelo no está disponible
   * (`/models/midas/midas-small.onnx` 404), la pipeline degrada
   * automáticamente al fallback heurístico SIN error. Default true —
   * usuarios con el modelo bundled ganan calidad gratis.
   */
  useMidasDepth?: boolean;
  /**
   * Callback de progreso macro (0-1) con stage label opcional.
   * El caller lo usa para mostrar UI bar:
   *
   *   onProgress(0.0, 'extract')
   *   onProgress(0.4, 'extract')
   *   onProgress(0.6, 'point-cloud')
   *   onProgress(0.85, 'export-glb')
   *   onProgress(1.0, 'export-usdz')
   */
  onProgress?: (ratio: number, stage: ReconstructionStage) => void;
  /** Cancel signal. Aborta la pipeline en cualquier etapa. */
  abortSignal?: AbortSignal;
}

export type ReconstructionStage =
  | 'extract'
  | 'point-cloud'
  | 'export'
  | 'export-glb'
  | 'export-usdz'
  | 'done';

export interface ReconstructionResult {
  /** GLB blob listo para upload o save local (Android + WebXR + model-viewer). */
  glb: Blob;
  /** USDZ blob para iOS AR Quick Look (solo si emitUsdz=true). */
  usdz?: Blob;
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

  // Stage 2: point cloud — usa MiDaS si disponible (Fase D.1), sino heurística.
  const pcStart = performance.now();
  let depthEstimator: DepthEstimator | null = null;
  if (options.useMidasDepth !== false) {
    try {
      depthEstimator = await tryCreateMidasEstimator();
      if (depthEstimator) {
        logger.info('[reconstructFromVideo] MiDaS depth ML activo', {
          estimatorId: depthEstimator.id,
        });
      }
    } catch (err) {
      logger.warn('[reconstructFromVideo] MiDaS init falló, usando heurística', {
        err: String(err),
      });
    }
  }

  let cloud: PointCloud;
  try {
    const pcOptions: BuildPointCloudOptions = {
      ...options.pointCloud,
      onProgress: (r) => onProgress?.(0.4 + r * 0.4, 'point-cloud'),
      depthEstimator: depthEstimator ?? undefined,
    };
    cloud = depthEstimator
      ? await buildPointCloudFromFramesAsync(frames, pcOptions)
      : buildPointCloudFromFrames(frames, pcOptions);
  } catch (err) {
    logger.error('[reconstructFromVideo] pointCloud failed', { err: String(err) });
    throw err;
  } finally {
    // Liberar recursos ORT incluso si tiramos
    if (depthEstimator) {
      void depthEstimator.dispose().catch(() => {});
    }
  }
  const pointCloudMs = performance.now() - pcStart;
  onProgress?.(0.8, 'point-cloud');

  if (abortSignal?.aborted) {
    throw new DOMException('reconstructFromVideo aborted', 'AbortError');
  }

  // Stage 3: export GLB (always).
  const emitUsdz = options.emitUsdz !== false;
  const glbStart = performance.now();
  let glb: ExportGlbResult;
  try {
    glb = await exportPointCloudToGlb(cloud);
  } catch (err) {
    logger.error('[reconstructFromVideo] glbExport failed', { err: String(err) });
    throw err;
  }
  const exportMs = performance.now() - glbStart;
  onProgress?.(emitUsdz ? 0.85 : 1, emitUsdz ? 'export-glb' : 'done');

  // Stage 4 (opcional): export USDZ.
  let usdz: ExportUsdzResult | null = null;
  let usdzExportMs: number | undefined;
  if (emitUsdz) {
    if (abortSignal?.aborted) {
      throw new DOMException('reconstructFromVideo aborted', 'AbortError');
    }
    const usdzStart = performance.now();
    try {
      usdz = await exportPointCloudToUsdz(cloud, { quadSize: options.quadSize });
    } catch (err) {
      // Si el USDZ falla, seguimos con GLB-only (no es fatal — Android +
      // model-viewer pueden usar el GLB; solo iOS Quick Look se ve afectado).
      logger.warn('[reconstructFromVideo] usdzExport failed — continuing with GLB only', {
        err: String(err),
      });
    }
    usdzExportMs = Math.round(performance.now() - usdzStart);
    onProgress?.(1, 'done');
  }

  const totalMs = performance.now() - startedAt;

  return {
    glb: glb.blob,
    usdz: usdz?.blob,
    metrics: {
      framesExtracted: frames.length,
      pointsReconstructed: cloud.pointCount,
      gridResolution: cloud.gridResolution,
      boundingBox: cloud.boundingBox,
      glbSizeBytes: glb.sizeBytes,
      usdzSizeBytes: usdz?.sizeBytes,
      durationMs: Math.round(totalMs),
      stageDurations: {
        extractMs: Math.round(extractMs),
        pointCloudMs: Math.round(pointCloudMs),
        exportMs: Math.round(exportMs),
        usdzExportMs,
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
