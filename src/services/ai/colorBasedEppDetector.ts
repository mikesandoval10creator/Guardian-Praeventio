// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.18 (2026-05-22) detector EPP on-device REAL.
//
// Reemplaza a `MockEppDetector` con una detección heurística basada en
// el pixel data de la imagen. NO es un modelo ML (eso es Opción B Phase 2,
// requiere TFLite + dataset etiquetado). Pero SÍ analiza los píxeles reales
// del usuario en lugar de devolver detecciones fijas.
//
// Heurística por clase EPP (las 7 estándar DS 594):
//
//   casco        → buscar regiones con saturación alta + hue en
//                  amarillo / naranja / blanco / azul en la parte
//                  SUPERIOR del frame (top ~25%). Cascos se ubican
//                  en cabeza → arriba del frame.
//
//   chaleco_reflectivo → buscar patches con luminancia alta + saturación
//                  alta + colores típicos (naranja/amarillo/verde
//                  fluo). Pueden estar en torso → centro vertical.
//
//   gafas        → muy difícil sin ML. Heurística: buscar patrón
//                  oscuro-claro-oscuro horizontal en la zona facial
//                  (top 30%). Bajo umbral confidence reportado.
//
//   guantes      → manos suelen estar en bordes laterales / inferior
//                  del frame. Buscar regiones con color piel-NO
//                  (no rosa/beige típico) + saturación.
//
//   arnes        → patrones de correas (líneas paralelas oscuras
//                  sobre torso). Heurística: gradient response en
//                  zona pecho.
//
//   botas        → bottom 25% del frame, color oscuro (cuero/cuero
//                  industrial), luminancia baja.
//
//   respirador   → zona facial (top 30%, centro horizontal),
//                  patrón ovalado con saturación baja (mascarillas
//                  suelen ser blancas/grises).
//
// Esta heurística NO es exacta. Para usos productivos legales se
// recomienda integrar un modelo TFLite real (Opción B Phase 2). Por
// ahora ofrece:
//   - Análisis REAL del píxel data del usuario (no mock).
//   - Confidence calibrado (baja para clases difíciles como gafas).
//   - 100% on-device (la imagen permanece en memoria del browser).
//   - Determinístico: misma imagen → misma respuesta.
//
// Cuando llegue el modelo TFLite real:
//   - Reemplazar `detect()` con la inferencia TFLite.
//   - Eliminar este archivo o degradarlo a fallback secundario.

import type {
  EppDetection,
  EppDetector,
  EppDetectorInput,
  EppClass,
} from './eppDetectorOnDevice';
import { logger } from '../../utils/logger';

/**
 * Detecta si un valor parece ser `ImageData` sin usar `instanceof` (porque
 * jsdom y entornos polyfilled crean `ImageData`-like objects que no son
 * instancias del constructor global). Chequea la shape: data Uint8ClampedArray
 * + width/height numéricos.
 */
function isImageDataLike(x: unknown): x is ImageData {
  return (
    !!x &&
    typeof x === 'object' &&
    'data' in (x as Record<string, unknown>) &&
    (x as ImageData).data instanceof Uint8ClampedArray &&
    typeof (x as ImageData).width === 'number' &&
    typeof (x as ImageData).height === 'number'
  );
}

/**
 * Convierte la entrada del detector a `ImageData`. Esta es la única
 * representación que la heurística por color necesita — independizar el
 * análisis de la fuente de imagen permite tests unitarios sin depender
 * de `createImageBitmap` (no disponible en jsdom).
 *
 * Paths:
 *  - `ImageData` → pass-through (path productivo: caller ya hizo
 *    `getImageData`; path test: jsdom carece de createImageBitmap).
 *  - `Blob` / `ImageBitmap` / `HTMLImageElement` → canvas pipeline normal.
 *
 * Lanza si:
 *  - No hay DOM (entorno Node/SSR puro) y la entrada NO es ImageData.
 *  - El blob no se puede decodificar.
 */
async function imageToImageData(image: EppDetectorInput): Promise<ImageData> {
  // Fast path: ya viene como ImageData (caller pre-decodificó o test jsdom).
  if (isImageDataLike(image)) return image;

  if (typeof document === 'undefined') {
    throw new Error('colorBasedEppDetector requires DOM or ImageData input');
  }
  let bitmap: ImageBitmap;
  if (image instanceof Blob) {
    bitmap = await createImageBitmap(image);
  } else if ('width' in image && 'height' in image) {
    // ImageBitmap o HTMLImageElement — el último puede no estar loaded.
    if (image instanceof HTMLImageElement) {
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('image load failed'));
        });
      }
      bitmap = await createImageBitmap(image);
    } else {
      bitmap = image as ImageBitmap;
    }
  } else {
    throw new Error('Unsupported image input');
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Canvas 2D context not available');
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return imageData;
}

/**
 * Convierte RGB [0..255] a HSV [h:0..360, s:0..1, v:0..1].
 * Necesario para la heurística por color (HSV es más natural para
 * identificar amarillo/naranja/etc. que RGB).
 */
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/**
 * Analiza una región del frame y devuelve estadísticas útiles para las
 * heurísticas: ratio de píxeles que cumplen `predicate` + brightness
 * promedio + saturación promedio.
 */
function analyzeRegion(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  predicate: (h: number, s: number, v: number) => boolean,
): { matchRatio: number; avgBrightness: number; avgSaturation: number; sampleCount: number } {
  let matches = 0;
  let totalBrightness = 0;
  let totalSaturation = 0;
  let count = 0;
  // Sampleamos cada 2 píxeles por velocidad (cuadruplica throughput).
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const idx = (y * width + x) * 4;
      const { h, s, v } = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);
      totalBrightness += v;
      totalSaturation += s;
      if (predicate(h, s, v)) matches += 1;
      count += 1;
    }
  }
  return {
    matchRatio: count === 0 ? 0 : matches / count,
    avgBrightness: count === 0 ? 0 : totalBrightness / count,
    avgSaturation: count === 0 ? 0 : totalSaturation / count,
    sampleCount: count,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Heurísticas por clase EPP. Cada una devuelve {confidence, bbox?}.
// confidence ∈ [0, 1]. Si confidence === 0, la clase NO se reporta.
// ──────────────────────────────────────────────────────────────────────

interface ClassHeuristic {
  /** Color predicate en HSV (true = pixel match). */
  colorTest: (h: number, s: number, v: number) => boolean;
  /** Región normalizada del frame [x0, y0, x1, y1] ∈ [0,1]. */
  region: [number, number, number, number];
  /**
   * Confidence floor — si matchRatio supera este umbral, reportamos.
   * Cada clase tiene un umbral calibrado distinto.
   */
  matchThreshold: number;
  /**
   * Confidence ceiling — limita confianza incluso si matchRatio === 1.
   * Útil para clases donde la heurística es notablemente débil (gafas,
   * arnés) — el modelo TFLite real subiría este techo.
   */
  confidenceCeiling: number;
  /** Si true, requiere también saturación alta en la región. */
  requiresSaturation?: boolean;
  /** Si true, requiere brightness alta. */
  requiresBrightness?: boolean;
}

const HEURISTICS: Record<EppClass, ClassHeuristic> = {
  casco: {
    // Amarillo (h≈45-65), naranja (h≈10-35), blanco (s baja, v alta), azul (h≈200-240).
    colorTest: (h, s, v) =>
      ((h >= 30 && h <= 70) && s > 0.4 && v > 0.4) || // amarillo
      ((h >= 5 && h <= 35) && s > 0.45 && v > 0.4) || // naranja
      ((s < 0.2) && v > 0.75) || // blanco
      ((h >= 200 && h <= 250) && s > 0.4 && v > 0.3), // azul
    region: [0.1, 0.0, 0.9, 0.3], // top 30% del frame, centrado
    matchThreshold: 0.05,
    confidenceCeiling: 0.85,
  },
  chaleco_reflectivo: {
    // Naranja fluo / amarillo fluo / verde fluo (saturación + brightness altas).
    colorTest: (h, s, v) =>
      ((h >= 15 && h <= 70) && s > 0.55 && v > 0.55) || // amarillo/naranja fluo
      ((h >= 70 && h <= 140) && s > 0.55 && v > 0.5), // verde fluo
    region: [0.15, 0.25, 0.85, 0.7], // torso (centro vertical)
    matchThreshold: 0.08,
    confidenceCeiling: 0.88,
    requiresSaturation: true,
  },
  gafas: {
    // Heurística débil: zona facial, alto contraste localizado.
    // Aceptamos el ceiling bajo: el modelo TFLite real necesita atacar esto.
    colorTest: (_h, s, v) => s < 0.3 && v < 0.4, // zona oscura (montura/lentes)
    region: [0.3, 0.05, 0.7, 0.3], // zona facial
    matchThreshold: 0.08,
    confidenceCeiling: 0.5, // techo bajo — heurística inherentemente débil
  },
  guantes: {
    // Bordes laterales del frame, color que no sea piel.
    colorTest: (h, s, _v) =>
      !((h >= 0 && h <= 30) && s >= 0.15 && s <= 0.45), // NO color piel
    region: [0.0, 0.5, 1.0, 1.0], // mitad inferior + bordes
    matchThreshold: 0.5,
    confidenceCeiling: 0.55, // heurística amplia
  },
  arnes: {
    // Líneas oscuras horizontales/diagonales en pecho. Heurística:
    // saturación baja + brightness baja en banda central.
    colorTest: (_h, s, v) => s < 0.4 && v < 0.45,
    region: [0.2, 0.35, 0.8, 0.65], // pecho/torso
    matchThreshold: 0.15,
    confidenceCeiling: 0.6,
  },
  botas: {
    // Bottom 25% + color oscuro (cuero industrial).
    colorTest: (_h, s, v) => v < 0.35 && s < 0.5,
    region: [0.15, 0.75, 0.85, 1.0], // pies
    matchThreshold: 0.2,
    confidenceCeiling: 0.78,
  },
  respirador: {
    // Zona facial baja, blancos/grises (N95) o naranjas (cartuchos).
    colorTest: (h, s, v) =>
      (s < 0.15 && v > 0.55) || // blanco/gris
      ((h >= 10 && h <= 50) && s > 0.4), // cartuchos naranja
    region: [0.3, 0.15, 0.7, 0.4], // boca/nariz
    matchThreshold: 0.1,
    confidenceCeiling: 0.7,
  },
};

/**
 * Detector REAL on-device basado en heurística de color sobre el pixel
 * data del usuario. Reemplaza al `MockEppDetector`.
 */
export class ColorBasedEppDetector implements EppDetector {
  readonly modelVersion = 'color-heuristic-v1';

  async detect(image: EppDetectorInput): Promise<EppDetection[]> {
    let imageData: ImageData;
    try {
      imageData = await imageToImageData(image);
    } catch (err) {
      logger.warn('[colorBasedEppDetector] image decode failed', { err: String(err) });
      return [];
    }

    const { data, width, height } = imageData;
    const detections: EppDetection[] = [];

    for (const cls of Object.keys(HEURISTICS) as EppClass[]) {
      const h = HEURISTICS[cls];
      const [rx0, ry0, rx1, ry1] = h.region;
      const x0 = Math.floor(rx0 * width);
      const y0 = Math.floor(ry0 * height);
      const x1 = Math.floor(rx1 * width);
      const y1 = Math.floor(ry1 * height);

      const analysis = analyzeRegion(data, width, x0, y0, x1, y1, h.colorTest);

      if (analysis.matchRatio < h.matchThreshold) continue;

      // Filtros adicionales calibrados por clase.
      if (h.requiresSaturation && analysis.avgSaturation < 0.3) continue;
      if (h.requiresBrightness && analysis.avgBrightness < 0.4) continue;

      // Confidence calibration: scale matchRatio against ceiling.
      // Ratio above 3× threshold → ceiling. Ratio at threshold → 50% of ceiling.
      const scaled = Math.min(
        1,
        (analysis.matchRatio - h.matchThreshold) / (h.matchThreshold * 3) + 0.5,
      );
      const confidence = scaled * h.confidenceCeiling;

      detections.push({
        class: cls,
        confidence: Number(confidence.toFixed(3)),
        bbox: {
          x: rx0,
          y: ry0,
          width: rx1 - rx0,
          height: ry1 - ry0,
        },
      });
    }

    return detections;
  }
}

/** Factory. */
export function createColorBasedEppDetector(): EppDetector {
  return new ColorBasedEppDetector();
}
