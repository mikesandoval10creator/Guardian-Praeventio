// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 §Fase D.1 — MiDaS depth ML on-device.
//
// Reemplaza la heurística brightness/edge de pointCloudBuilder por inferencia
// MiDaS-small (modelo monocular depth estimation pre-entrenado).
//
// IMPORTANTE — modelo NO incluido en este commit:
//   El binario `public/models/midas/midas-small.onnx` (~30 MB) NO se
//   commitea (mismo principio que SLM models en `public/models/README.md`).
//   El release pipeline lo descarga + verifica SHA-256 antes de `npm run
//   build`. Para dev:
//
//     mkdir -p public/models/midas
//     curl -L "https://huggingface.co/Intel/dpt-hybrid-midas/resolve/main/onnx/model.onnx" \
//       -o public/models/midas/midas-small.onnx
//     # Si no existe, el factory `tryCreateMidasEstimator()` retorna null →
//     # pointCloudBuilder usa la heurística previa (fallback OK).
//
// Privacy on-device:
//   Igual que el resto del pipeline — el frame se procesa LOCAL via
//   onnxruntime-web (WASM en el browser). No hay request a servidor.
//
// Performance objetivo:
//   ~150-300ms por frame en celular medio (Snapdragon 7-gen). Para un
//   video de 10 frames = ~3s total adicional vs heurística. Caller debe
//   reportar progreso al usuario.

import type { ExtractedFrame } from './frameExtractor';
import { logger } from '../../../utils/logger';

/** Mapa de depth normalizado [0,1] del tamaño del frame (height × width). */
export interface DepthMap {
  /** Float32Array de length = width * height. Cada valor en [0,1]. */
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * Interfaz que cualquier depth estimator on-device debe implementar.
 * `pointCloudBuilder` la consume como opcional — si no está, usa la
 * heurística brightness/edge previa.
 */
export interface DepthEstimator {
  /** Identificador legible para logs / observability. */
  readonly id: string;
  /**
   * Estima depth para un frame extraído. La implementación es responsable
   * de hacer su propio resizing al input shape del modelo (MiDaS-small =
   * 256×256) y devolver el depth map en la resolución ORIGINAL del frame
   * (interpolación bilinear).
   */
  estimate(frame: ExtractedFrame): Promise<DepthMap>;
  /** Libera recursos (session, tensors). */
  dispose(): Promise<void>;
}

const MIDAS_MODEL_PATH = '/models/midas/midas-small.onnx';
const MIDAS_INPUT_SIZE = 256; // MiDaS-small expects 256×256
// MiDaS-small training mean/std (ImageNet-derived, standard values).
const NORM_MEAN = [0.485, 0.456, 0.406] as const;
const NORM_STD = [0.229, 0.224, 0.225] as const;

/**
 * Intenta crear un MidasDepthEstimator. Retorna null si:
 *   - El modelo no existe en `/models/midas/midas-small.onnx` (404)
 *   - `onnxruntime-web` falla al cargar (env sin WASM, dev sandbox)
 *   - La session de ORT falla la inicialización
 *
 * El caller debe usar el fallback heurístico en cualquiera de esos casos.
 */
export async function tryCreateMidasEstimator(): Promise<DepthEstimator | null> {
  // 1. HEAD request al modelo para verificar disponibilidad sin descargarlo.
  try {
    const headRes = await fetch(MIDAS_MODEL_PATH, { method: 'HEAD' });
    if (!headRes.ok) {
      logger.debug('[midas] modelo no disponible en bundle, usando fallback heurístico', {
        status: headRes.status,
      });
      return null;
    }
  } catch (err) {
    logger.debug('[midas] HEAD request falló, usando fallback heurístico', { err: String(err) });
    return null;
  }

  // 2. Lazy import de onnxruntime-web — el bundle main NO lo carga eager
  //    para no bloatear users sin Digital Twin.
  let ort: typeof import('onnxruntime-web');
  try {
    ort = await import('onnxruntime-web');
  } catch (err) {
    logger.warn('[midas] onnxruntime-web no se pudo cargar', { err: String(err) });
    return null;
  }

  // 3. Inicializar la session.
  let session: import('onnxruntime-web').InferenceSession;
  try {
    session = await ort.InferenceSession.create(MIDAS_MODEL_PATH, {
      executionProviders: ['wasm'], // wasm es el provider más estable en browser
      graphOptimizationLevel: 'all',
    });
  } catch (err) {
    logger.warn('[midas] session.create falló', { err: String(err) });
    return null;
  }

  logger.info('[midas] MiDaS-small inicializado', {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
  });

  return new MidasDepthEstimator(session, ort);
}

class MidasDepthEstimator implements DepthEstimator {
  readonly id = 'midas-small-onnx';

  constructor(
    private readonly session: import('onnxruntime-web').InferenceSession,
    private readonly ort: typeof import('onnxruntime-web'),
  ) {}

  async estimate(frame: ExtractedFrame): Promise<DepthMap> {
    // 1. Resize ImageData a 256×256 con bilinear interpolation (offscreen
    //    canvas para evitar tocar el DOM principal).
    const tensorData = preprocessFrame(frame, MIDAS_INPUT_SIZE);

    // 2. Construir tensor con shape [1, 3, 256, 256] (NCHW estándar PyTorch).
    const inputTensor = new this.ort.Tensor(
      'float32',
      tensorData,
      [1, 3, MIDAS_INPUT_SIZE, MIDAS_INPUT_SIZE],
    );

    // 3. Inferencia. El input name viene del modelo (típicamente 'input' o 'pixel_values').
    const inputName = this.session.inputNames[0];
    const outputs = await this.session.run({ [inputName]: inputTensor });
    const outputName = this.session.outputNames[0];
    const outputTensor = outputs[outputName];

    // 4. El output MiDaS-small es típicamente [1, 1, H, W] con depth raw.
    //    Normalizamos a [0, 1] y resizeamos a la resolución original del frame.
    const rawDepth = outputTensor.data as Float32Array;
    const [outH, outW] = inferOutputDims(outputTensor.dims as readonly number[]);
    const normalized = normalizeDepth(rawDepth);
    const resized = resizeBilinear(normalized, outW, outH, frame.width, frame.height);

    return {
      data: resized,
      width: frame.width,
      height: frame.height,
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.session.release();
    } catch (err) {
      logger.debug('[midas] session.release failed', { err: String(err) });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers (testeable sin onnxruntime-web)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Preprocesa un ExtractedFrame al input shape NCHW [3, size, size]
 * normalizado con ImageNet mean/std. Retorna Float32Array de longitud
 * 3 * size * size.
 *
 * Resize con nearest-neighbor (más rápido que bilinear y el modelo
 * absorbe el ruido). El planar layout es contiguous-per-channel.
 */
export function preprocessFrame(frame: ExtractedFrame, size: number): Float32Array {
  const out = new Float32Array(3 * size * size);
  const srcData = frame.imageData.data;
  const sw = frame.width;
  const sh = frame.height;
  const channelSize = size * size;

  for (let y = 0; y < size; y += 1) {
    const sy = Math.min(sh - 1, Math.floor((y / size) * sh));
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(sw - 1, Math.floor((x / size) * sw));
      const srcIdx = (sy * sw + sx) * 4;
      const r = srcData[srcIdx] / 255;
      const g = srcData[srcIdx + 1] / 255;
      const b = srcData[srcIdx + 2] / 255;

      const dstIdx = y * size + x;
      // Normalize con ImageNet stats. Layout: [R-plane, G-plane, B-plane].
      out[dstIdx] = (r - NORM_MEAN[0]) / NORM_STD[0];
      out[channelSize + dstIdx] = (g - NORM_MEAN[1]) / NORM_STD[1];
      out[2 * channelSize + dstIdx] = (b - NORM_MEAN[2]) / NORM_STD[2];
    }
  }
  return out;
}

/** Infiere (H, W) del output tensor, asume [1, 1, H, W] o [1, H, W]. */
function inferOutputDims(dims: readonly number[]): [number, number] {
  if (dims.length === 4) return [dims[2], dims[3]];
  if (dims.length === 3) return [dims[1], dims[2]];
  if (dims.length === 2) return [dims[0], dims[1]];
  throw new Error(`[midas] output shape inesperado: ${dims.join('x')}`);
}

/**
 * Normaliza un Float32Array de depth raw a [0, 1] usando min/max del
 * propio array. MiDaS produce relative depth (no metric), así que la
 * normalización por-frame es la convención estándar.
 */
export function normalizeDepth(raw: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const out = new Float32Array(raw.length);
  if (range === 0) {
    // Degenerate: depth constante. Devolvemos 0.5 (mid-distance).
    out.fill(0.5);
    return out;
  }
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = (raw[i] - min) / range;
  }
  return out;
}

/**
 * Resize bilinear de un depth map [srcW × srcH] a [dstW × dstH].
 * Output: Float32Array length = dstW * dstH.
 */
export function resizeBilinear(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const yLerp = sy - y0;
    for (let x = 0; x < dstW; x += 1) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const xLerp = sx - x0;
      const v00 = src[y0 * srcW + x0];
      const v01 = src[y0 * srcW + x1];
      const v10 = src[y1 * srcW + x0];
      const v11 = src[y1 * srcW + x1];
      const top = v00 + (v01 - v00) * xLerp;
      const bottom = v10 + (v11 - v10) * xLerp;
      out[y * dstW + x] = top + (bottom - top) * yLerp;
    }
  }
  return out;
}
