// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction.
//
// Convierte una secuencia de frames extraídos a un point cloud 3D.
//
// El algoritmo NO es photogrammetría real (SfM completa requiere bundle
// adjustment + feature matching + RANSAC, lo cual necesitaría OpenCV-WASM
// o un modelo TFLite y es ~50-200MB). En vez de eso usamos una
// **monocular structure heuristic** que SÍ deriva la nube del video real
// del usuario (no es mock):
//
//   1. Cada frame contribuye N samples uniformes (grilla 32×32 = 1024
//      puntos por frame).
//   2. La posición XY del sample se mapea a las coordenadas del píxel
//      normalizadas a [-1, 1] (esto preserva el aspect ratio del video).
//   3. La profundidad Z se deriva de **brightness inverse** + **edge
//      gradient** del píxel:
//        - brightness alto → píxel cerca de la cámara (mayor Z hacia
//          el observador en convención three.js: Z+ = atrás-de-cámara,
//          usamos Z- = hacia adelante)
//        - edge gradient alto → píxel está en un borde → más cerca
//          (mejor enfocado)
//      Esto produce una "depth heatmap" que para escenas de faena con
//      iluminación típica refleja approximate-structure (no foto-real).
//   4. El frame index aporta un OFFSET en Z: frames más tardíos del
//      video se posicionan "más lejos" del origen — esto simula
//      barrido de cámara y produce un volumen 3D útil para colocar
//      objetos.
//   5. El color RGB de cada punto preserva el color real del píxel —
//      el usuario ve una nube color-fiel a su video.
//
// Resultado: una nube de puntos REAL derivada del video del usuario.
// No es un mesh foto-realista, pero es estructura útil para colocar
// objetos virtuales (extintores, hidrantes) en relación a la faena
// capturada. El bounding box de la nube + la densidad por región
// dicen al usuario "aquí estuvo la cámara, aquí hay estructura".
//
// Privacy: 100 % on-device. Las imágenes nunca se transmiten.

import type { ExtractedFrame } from './frameExtractor';
import { logger } from '../../../utils/logger';

export interface PointCloud {
  /** Posiciones XYZ planar [x0,y0,z0,x1,y1,z1,...]. */
  positions: Float32Array;
  /** Colores RGB planar [r0,g0,b0,r1,...] (0-1 normalizado). */
  colors: Float32Array;
  /** Cantidad total de puntos en la nube. */
  pointCount: number;
  /** Bounding box de la nube en world coords. */
  boundingBox: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  /** Cuántos frames contribuyeron. */
  framesContributing: number;
  /** Resolución de la grilla por frame (default 32). */
  gridResolution: number;
}

export interface BuildPointCloudOptions {
  /**
   * Resolución de la grilla por frame. 32 = 1024 puntos/frame. 16 = 256
   * puntos/frame (más rápido, menos detalle). Default 24 (576
   * puntos/frame — equilibrio bueno para celulares).
   */
  gridResolution?: number;
  /**
   * Espacio entre frames en eje Z (metros). Default 0.5. Controla la
   * "profundidad" del volumen reconstruido — videos largos con
   * movimiento de cámara producirán volúmenes más grandes.
   */
  frameZStep?: number;
  /**
   * Escala del rango XY (metros). Default 5. Un frame se proyecta en un
   * cuadrado de [-scale/2, +scale/2] en X e Y (con aspect ratio).
   */
  xyScale?: number;
  /**
   * Amplitud máxima de la heurística de profundidad por píxel. Default 1.5
   * metros. Variaciones brightness/edge contribuyen hasta esta cantidad.
   */
  depthAmplitude?: number;
  /** Callback de progreso (0-1). */
  onProgress?: (ratio: number) => void;
}

const DEFAULT_GRID_RES = 24;
const DEFAULT_FRAME_Z_STEP = 0.5;
const DEFAULT_XY_SCALE = 5;
const DEFAULT_DEPTH_AMPLITUDE = 1.5;

export function buildPointCloudFromFrames(
  frames: ExtractedFrame[],
  options: BuildPointCloudOptions = {},
): PointCloud {
  if (frames.length === 0) {
    throw new Error('buildPointCloudFromFrames: no frames to process.');
  }
  const grid = Math.max(4, Math.min(options.gridResolution ?? DEFAULT_GRID_RES, 128));
  const zStep = options.frameZStep ?? DEFAULT_FRAME_Z_STEP;
  const xyScale = options.xyScale ?? DEFAULT_XY_SCALE;
  const depthAmp = options.depthAmplitude ?? DEFAULT_DEPTH_AMPLITUDE;
  const onProgress = options.onProgress;

  const pointsPerFrame = grid * grid;
  const totalPoints = pointsPerFrame * frames.length;
  const positions = new Float32Array(totalPoints * 3);
  const colors = new Float32Array(totalPoints * 3);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  let writeOffset = 0;

  frames.forEach((frame, frameIdx) => {
    const data = frame.imageData.data;
    const w = frame.width;
    const h = frame.height;
    const aspectRatio = w / h;

    // El frame se proyecta en X ∈ [-xyScale/2 * aspect, +xyScale/2 * aspect]
    // y Y ∈ [-xyScale/2, +xyScale/2] preservando aspect ratio. Y crece
    // hacia arriba en convención Three.js.
    const xHalfRange = (xyScale / 2) * aspectRatio;
    const yHalfRange = xyScale / 2;

    // Z base del frame: frames más tardíos del video se posicionan "más
    // lejos" del origen (Z negativo en convención Three.js = hacia el
    // espectador). Esto produce un "tunel" 3D que el usuario puede
    // explorar.
    const zBase = -frameIdx * zStep;

    // Sampling uniforme sobre la grilla.
    for (let gy = 0; gy < grid; gy += 1) {
      for (let gx = 0; gx < grid; gx += 1) {
        // Centro de la celda en coords normalizadas [0,1].
        const nx = (gx + 0.5) / grid;
        const ny = (gy + 0.5) / grid;

        // Píxel correspondiente.
        const px = Math.min(w - 1, Math.floor(nx * w));
        const py = Math.min(h - 1, Math.floor(ny * h));
        const idx = (py * w + px) * 4;
        const r = data[idx] / 255;
        const g = data[idx + 1] / 255;
        const b = data[idx + 2] / 255;

        // Brightness heuristic (luminance Rec. 709).
        const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Edge gradient — diferencia con vecinos right + down.
        let edgeMag = 0;
        if (px + 1 < w && py + 1 < h) {
          const rightIdx = (py * w + (px + 1)) * 4;
          const downIdx = ((py + 1) * w + px) * 4;
          const dxR = (data[rightIdx] - data[idx]) / 255;
          const dxG = (data[rightIdx + 1] - data[idx + 1]) / 255;
          const dxB = (data[rightIdx + 2] - data[idx + 2]) / 255;
          const dyR = (data[downIdx] - data[idx]) / 255;
          const dyG = (data[downIdx + 1] - data[idx + 1]) / 255;
          const dyB = (data[downIdx + 2] - data[idx + 2]) / 255;
          edgeMag = Math.sqrt(
            dxR * dxR + dxG * dxG + dxB * dxB + dyR * dyR + dyG * dyG + dyB * dyB,
          );
        }

        // Depth derivada: brighter + sharper edges → más cerca de la
        // cámara (mayor componente Z positivo). depth ∈ [0, depthAmp].
        const depthFactor = brightness * 0.6 + Math.min(edgeMag, 1) * 0.4;
        const dz = depthFactor * depthAmp;

        // Posición final.
        const x = (nx * 2 - 1) * xHalfRange;
        // Y invertido para que arriba del frame quede arriba en world.
        const y = (1 - ny * 2) * yHalfRange;
        const z = zBase + dz;

        positions[writeOffset * 3] = x;
        positions[writeOffset * 3 + 1] = y;
        positions[writeOffset * 3 + 2] = z;
        colors[writeOffset * 3] = r;
        colors[writeOffset * 3 + 1] = g;
        colors[writeOffset * 3 + 2] = b;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;

        writeOffset += 1;
      }
    }

    onProgress?.((frameIdx + 1) / frames.length);
  });

  if (writeOffset === 0) {
    throw new Error('buildPointCloudFromFrames: ningún punto generado.');
  }

  // Si todos los frames fallaron silenciosamente, los arrays tienen ceros.
  // Verificamos el bounding box: si es degenerado, el caller debe saber.
  if (!Number.isFinite(minX) || !Number.isFinite(maxZ)) {
    logger.warn('[pointCloudBuilder] bounding box degenerado (todos los frames vacíos)');
  }

  return {
    positions,
    colors,
    pointCount: writeOffset,
    boundingBox: {
      minX,
      maxX,
      minY,
      maxY,
      minZ,
      maxZ,
    },
    framesContributing: frames.length,
    gridResolution: grid,
  };
}
