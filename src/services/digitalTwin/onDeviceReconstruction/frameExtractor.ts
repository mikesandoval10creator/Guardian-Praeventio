// SPDX-License-Identifier: MIT
// Praeventio Guard — §2.28 (2026-05-22) on-device reconstruction module.
//
// Extrae frames de un File de video usando HTMLVideoElement + canvas. Es
// la primera etapa del pipeline ON-DEVICE: ningún byte sale del browser.
//
// Por qué este módulo y no un worker: HTMLVideoElement decodifica
// hardware-accelerated en main thread; OffscreenCanvas se puede sumar
// después si queremos paralelizar el resampling. La extracción es
// linealmente proporcional al `frameCount` solicitado (no procesa todo
// el video, solo los frames seek-points que pedimos).
//
// Privacy: el `File` permanece en memoria del browser. No se hace upload
// del video. El caller decide qué hacer con los frames (point cloud,
// análisis IA local, etc.).

import { logger } from '../../../utils/logger';

export interface ExtractedFrame {
  /** Índice del frame [0, frameCount). */
  index: number;
  /** Timestamp del frame dentro del video (segundos). */
  timestampS: number;
  /** ImageData del frame — pixeles RGBA. */
  imageData: ImageData;
  /** Ancho del frame en píxeles. */
  width: number;
  /** Alto del frame en píxeles. */
  height: number;
}

export interface ExtractFramesOptions {
  /**
   * Cantidad de frames a extraer. Default 30. Cada frame es un
   * keyframe distribuido uniformemente en la duración del video.
   *
   * Trade-off: más frames → mejor reconstrucción, más memoria + CPU.
   * Para celulares modernos 30-60 frames es seguro; 200+ frames con
   * 720p ≈ 1 GB RAM y suele crashear.
   */
  frameCount?: number;
  /**
   * Ancho máximo de cada frame (downsampling). Default 640 px. El
   * downsampling acelera todo el pipeline downstream sin perder
   * información estructural útil para mesh paramétrico.
   */
  maxWidth?: number;
  /**
   * Callback de progreso (0-1) — el caller lo conecta a una UI bar.
   */
  onProgress?: (ratio: number) => void;
  /**
   * Signal opcional para cancelar la extracción (caller puede abortar
   * desde un "Cancelar" button).
   */
  abortSignal?: AbortSignal;
}

const DEFAULT_FRAME_COUNT = 30;
const DEFAULT_MAX_WIDTH = 640;

/**
 * Extrae N frames distribuidos uniformemente de un File de video.
 *
 * Algoritmo:
 *   1. Crear `<video>` element off-DOM con `URL.createObjectURL(file)`.
 *   2. Esperar `loadedmetadata` para obtener `duration` + `videoWidth/Height`.
 *   3. Computar timestamps targetT[i] = (i + 0.5) * duration / frameCount.
 *      (offset +0.5 evita frames negros al inicio/fin típicos).
 *   4. Para cada target, hacer `video.currentTime = t` + esperar `seeked`
 *      → drawImage al canvas → getImageData.
 *   5. Liberar el blob URL al final.
 *
 * Lanza si:
 *   - El file no es un video válido (browser no puede decodificarlo).
 *   - El video tiene 0 segundos de duración.
 *   - abortSignal aborta durante la extracción.
 *
 * Best-effort robusto contra encodings raros: tira pero con mensaje
 * claro para que el caller pueda mostrar toast.
 */
export async function extractFramesFromVideo(
  file: File,
  options: ExtractFramesOptions = {},
): Promise<ExtractedFrame[]> {
  const frameCount = Math.max(1, Math.min(options.frameCount ?? DEFAULT_FRAME_COUNT, 300));
  const maxWidth = Math.max(64, options.maxWidth ?? DEFAULT_MAX_WIDTH);
  const onProgress = options.onProgress;
  const abortSignal = options.abortSignal;

  if (typeof document === 'undefined') {
    throw new Error('extractFramesFromVideo: requiere DOM (HTMLVideoElement).');
  }

  const blobUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = blobUrl;

  const cleanup = () => {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      /* noop */
    }
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      /* noop */
    }
  };

  try {
    // Esperar metadata (duration + dimensions disponibles).
    await waitForEvent(video, 'loadedmetadata', abortSignal);

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(
        `Video duration inválida (${duration}). El archivo puede estar corrupto o tener encoding no soportado.`,
      );
    }

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    if (srcW < 16 || srcH < 16) {
      throw new Error(`Video resolution muy pequeña (${srcW}×${srcH}).`);
    }

    // Downsample preservando aspect ratio.
    const scale = Math.min(1, maxWidth / srcW);
    const w = Math.max(16, Math.round(srcW * scale));
    const h = Math.max(16, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Canvas 2D context no disponible — no se pueden extraer frames.');
    }

    const frames: ExtractedFrame[] = [];

    for (let i = 0; i < frameCount; i += 1) {
      if (abortSignal?.aborted) {
        throw new DOMException('extractFramesFromVideo aborted', 'AbortError');
      }
      // Distribución uniforme con offset +0.5 (avoid edge frames).
      const t = ((i + 0.5) / frameCount) * duration;
      video.currentTime = t;
      try {
        await waitForEvent(video, 'seeked', abortSignal, 2000);
      } catch (err) {
        // Si un seek falla, continúa con el siguiente — pipeline robusto
        // ante encodings que tienen seek-points ralos.
        logger.warn('[frameExtractor] seek failed, skipping frame', { i, t, err: String(err) });
        continue;
      }

      try {
        ctx.drawImage(video, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        frames.push({
          index: i,
          timestampS: t,
          imageData,
          width: w,
          height: h,
        });
      } catch (err) {
        // CORS / tainted canvas — file de Storage o Blob local NO deberían
        // tener este problema, pero si pasa loggeamos para audit.
        logger.warn('[frameExtractor] getImageData failed', { i, err: String(err) });
      }

      onProgress?.((i + 1) / frameCount);
    }

    if (frames.length === 0) {
      throw new Error(
        'Ningún frame se pudo extraer del video. El encoding puede no soportar seek (ej: webm sin keyframes).',
      );
    }

    return frames;
  } finally {
    cleanup();
  }
}

/**
 * Espera un evento DOM en `target`. Resolve cuando dispara, reject si
 * el signal aborta o si pasa `timeoutMs`. Útil para await de
 * `loadedmetadata` / `seeked` de un video.
 */
function waitForEvent(
  target: HTMLElement,
  eventName: string,
  abortSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Event | string) => {
      cleanup();
      reject(new Error(`waitForEvent(${eventName}) failed: ${String(err)}`));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException(`waitForEvent(${eventName}) aborted`, 'AbortError'));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener('error', onError as EventListener);
      abortSignal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
    };

    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener('error', onError as EventListener, { once: true });
    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => onError(`timeout ${timeoutMs}ms`), timeoutMs);
    }
  });
}
