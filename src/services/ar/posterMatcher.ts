// SPDX-License-Identifier: MIT
//
// Poster Matcher — wrapper sobre MediaPipe `ImageEmbedder` para
// comparar frames de cámara contra el catálogo de afiches de seguridad.
//
// 2026-05-16 (Sprint G — AR Poster Scan):
// Flujo:
//
//   1. App pide al matcher inicializarse (lazy, una vez por sesión)
//   2. Cámara entrega frames (HTMLVideoElement)
//   3. Cada N ms (default ~200ms = 5fps), el matcher computa embedding
//      del frame y compara con catálogo via cosine similarity
//   4. Si una entrada del catálogo supera el threshold, devuelve
//      `{poster, similarity}` para que la UI muestre la animación
//
// Decisión: MediaPipe `ImageEmbedder` corre 100% local (WASM o GPU),
// sin red. Genera embeddings deterministicos del modelo MobileNetV3
// small (~4MB). Compatible offline → consistente con la directiva
// "no integrar organismos" + visión SLM local del usuario.
//
// Pattern matches `useMediaPipePose.ts` (Sprint 33): lazy import,
// local-first WASM, fallback a CDN, cleanup explícito.

import {
  cosineSimilarity,
  type PosterDefinition,
} from './posterCatalog.js';

// URLs del modelo ImageEmbedder.
// Local-first: `public/models/mediapipe/embedder/mobilenet_v3_small.tflite`
// Si no existe, cae a Google Storage (Apache 2.0, free, sin auth).
// Codex fix 2026-05-16: el prebuild downloader (mismo que usa
// useMediaPipePose.ts) deja los WASM directamente en `/models/mediapipe`,
// no en una subcarpeta `/wasm`. Antes apuntaba a `/wasm/` y fallaba en
// deployments offline aunque el modelo SÍ existiera. Alineado con
// useMediaPipePose.ts:59.
const LOCAL_WASM_BASE = '/models/mediapipe';
const CDN_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';

const LOCAL_MODEL_URL = '/models/mediapipe/embedder/mobilenet_v3_small.tflite';
const CDN_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite';

/**
 * Resultado del match — incluye latency para telemetría/UX (mostrar
 * "match en 150ms" como feedback).
 */
export interface PosterMatchResult {
  poster: PosterDefinition;
  similarity: number;
  /** Latencia ms del compute embedding + match. */
  latencyMs: number;
}

/**
 * Opciones del matcher (todas opcionales, defaults razonables).
 */
export interface PosterMatcherOptions {
  /** Threshold mínimo de similarity para considerar match. Default 0.85. */
  thresholdSimilarity?: number;
  /**
   * Modo de ejecución MediaPipe:
   *   - 'IMAGE' (default): para imágenes estáticas o capturas singles
   *   - 'VIDEO': para streams de video con timestamps (más eficiente)
   */
  runningMode?: 'IMAGE' | 'VIDEO';
  /** Inyectable para tests — fetch alternativo. */
  fetch?: typeof fetch;
}

/**
 * Singleton wrapper sobre el ImageEmbedder. Crear el embedder es caro
 * (~50-200ms init + carga modelo 4MB). Mantenemos UNA instancia por
 * sesión y la reutilizamos en cada frame.
 */
class PosterMatcher {
  private embedder: unknown = null;
  private initPromise: Promise<unknown> | null = null;
  private readonly thresholdSimilarity: number;
  private readonly runningMode: 'IMAGE' | 'VIDEO';
  private isClosed = false;

  constructor(opts: PosterMatcherOptions = {}) {
    this.thresholdSimilarity = opts.thresholdSimilarity ?? 0.85;
    this.runningMode = opts.runningMode ?? 'IMAGE';
  }

  /**
   * Inicialización lazy. Llamar antes del primer matchFrame() o dejar
   * que matchFrame() lo haga automáticamente.
   *
   * Es seguro llamarlo varias veces concurrentemente — usa una
   * promise compartida.
   *
   * Codex fix 2026-05-16: si el usuario sale del scanner mientras
   * createFromOptions() todavía está cargando el modelo, `close()` ya
   * habrá puesto `isClosed=true` pero la init en curso aún terminará y
   * asignaba el embedder. Resultado: el GPU/WASM resource quedaba
   * inalcanzable (leak). Ahora, post-create, si ya está cerrada,
   * cerramos el embedder recién creado y retornamos null sin asignarlo.
   */
  async init(): Promise<void> {
    if (this.embedder) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const mp = await import('@mediapipe/tasks-vision');

      // Local-first probe.
      const localOk = await this.probeLocalAssets();
      const wasmBase = localOk ? LOCAL_WASM_BASE : CDN_WASM_BASE;
      const modelUrl = localOk ? LOCAL_MODEL_URL : CDN_MODEL_URL;

      const vision = await mp.FilesetResolver.forVisionTasks(wasmBase);
      const embedder = await mp.ImageEmbedder.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'GPU',
        },
        runningMode: this.runningMode,
        l2Normalize: true, // imprescindible para cosine similarity precisa
        quantize: false,
      });

      // Codex fix: si el caller cerró el matcher mientras esperábamos
      // a createFromOptions, NO almacenes el embedder — ciérralo ya
      // que de otro modo queda dangling sin owner.
      if (this.isClosed) {
        try {
          (embedder as { close?: () => void }).close?.();
        } catch {
          /* no-op */
        }
        return null;
      }

      this.embedder = embedder;
      return embedder;
    })();

    try {
      await this.initPromise;
    } catch (e) {
      this.initPromise = null;
      throw e;
    }
  }

  /**
   * Computa el embedding de un frame (video, canvas, image).
   * Devuelve el vector como array de floats.
   *
   * Si el embedder no está listo, llama init() primero.
   */
  async computeEmbedding(
    input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  ): Promise<number[]> {
    if (this.isClosed) {
      throw new Error('PosterMatcher: instancia cerrada');
    }
    await this.init();
    const embedder = this.embedder as {
      embed: (img: unknown) => { embeddings: Array<{ floatEmbedding?: number[] }> };
      embedForVideo: (
        img: unknown,
        timestamp: number,
      ) => { embeddings: Array<{ floatEmbedding?: number[] }> };
    };

    let result: { embeddings: Array<{ floatEmbedding?: number[] }> };
    if (this.runningMode === 'VIDEO') {
      result = embedder.embedForVideo(input, performance.now());
    } else {
      result = embedder.embed(input);
    }
    const floatEmbedding = result.embeddings?.[0]?.floatEmbedding;
    if (!floatEmbedding || floatEmbedding.length === 0) {
      throw new Error('PosterMatcher: el embedder no devolvió embedding');
    }
    return Array.from(floatEmbedding);
  }

  /**
   * End-to-end: toma un frame, computa embedding, lo compara con el
   * catálogo, devuelve el mejor match O null.
   *
   * Solo considera posters CON `referenceEmbedding` pre-computado —
   * los demás se ignoran silenciosamente (no son matcheables sin un
   * pase previo de seeding).
   */
  async matchFrame(
    input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    catalog: readonly PosterDefinition[],
  ): Promise<PosterMatchResult | null> {
    const t0 = performance.now();
    const frameEmbedding = await this.computeEmbedding(input);

    let best: PosterMatchResult | null = null;
    for (const poster of catalog) {
      if (!poster.referenceEmbedding || poster.referenceEmbedding.length === 0) {
        continue;
      }
      const sim = cosineSimilarity(frameEmbedding, poster.referenceEmbedding);
      if (sim >= this.thresholdSimilarity) {
        if (best === null || sim > best.similarity) {
          best = {
            poster,
            similarity: sim,
            latencyMs: performance.now() - t0,
          };
        }
      }
    }
    return best;
  }

  /**
   * Libera recursos GPU del embedder. Llamar al desmontar el
   * componente o cambiar de modo AR.
   */
  close(): void {
    if (this.embedder) {
      try {
        (this.embedder as { close?: () => void }).close?.();
      } catch {
        /* no-op — algunos backends no exponen close */
      }
    }
    this.embedder = null;
    this.initPromise = null;
    this.isClosed = true;
  }

  /**
   * Probe local: verifica si tenemos los assets en `/public/models/`.
   * Si fallan, caemos a CDN. Para dev: corre `npm run prebuild` para
   * hostear localmente.
   */
  private async probeLocalAssets(): Promise<boolean> {
    try {
      const fetchFn = typeof fetch === 'function' ? fetch : null;
      if (!fetchFn) return false;
      const r = await fetchFn(LOCAL_MODEL_URL, { method: 'HEAD' });
      return r.ok;
    } catch {
      return false;
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Singleton lazy + API público
// ────────────────────────────────────────────────────────────────────

let _instance: PosterMatcher | null = null;

/**
 * Acceso al singleton. Crea la instancia la primera vez con las
 * opciones provistas — opciones subsecuentes se ignoran (warning).
 * Si necesitas re-configurar, llama `closePosterMatcher()` primero.
 */
export function getPosterMatcher(opts: PosterMatcherOptions = {}): PosterMatcher {
  if (!_instance) {
    _instance = new PosterMatcher(opts);
  }
  return _instance;
}

/**
 * Cierra el singleton — libera GPU. Llamar al unmount del scanner.
 */
export function closePosterMatcher(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

/**
 * Helper conveniente — equivalente a `getPosterMatcher().matchFrame(...)`.
 */
export async function matchPosterFrame(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  catalog: readonly PosterDefinition[],
  opts?: PosterMatcherOptions,
): Promise<PosterMatchResult | null> {
  const matcher = getPosterMatcher(opts);
  return matcher.matchFrame(input, catalog);
}

// Re-export para que callers no tengan que importar 2 archivos.
export { cosineSimilarity } from './posterCatalog.js';
export type { PosterDefinition } from './posterCatalog.js';
export { PosterMatcher };
