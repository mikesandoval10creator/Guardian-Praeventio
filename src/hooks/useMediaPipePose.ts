/**
 * useMediaPipePose — hook que envuelve `@mediapipe/tasks-vision` Pose Landmarker
 * para extraer 33 landmarks 3D de una imagen estática del trabajador.
 *
 * Estrategia:
 *   - Lazy import del SDK (`import('@mediapipe/tasks-vision')`) en la primera
 *     llamada a `analyzeImage`. Evita penalizar el bundle inicial.
 *   - Inicialización única del `PoseLandmarker` (singleton dentro del hook).
 *   - El modelo `.task` se sirve actualmente desde el CDN público de Google.
 *     Bundlearlo localmente queda para Ola 5 Bucket O.
 *   - `runningMode: 'IMAGE'` con una sola pose detectada (numPoses: 1).
 *   - Cleanup en `useEffect` cleanup → `landmarker.close()` libera la WASM
 *     instance.
 *
 * El conversor matemático puro (landmarks → REBA/RULA inputs) vive en
 * `src/services/ergonomics/landmarksToScore.ts` y es lo único testeable
 * sin browser env.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────
// Tipos públicos (declarados localmente para no acoplar consumidores
// al SDK de MediaPipe — el SDK se carga solo bajo demanda).
// ─────────────────────────────────────────────────────────────────────

export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseAnalysisResult {
  /** 33 landmarks normalizados (0..1 en x,y; z relativo). */
  landmarks: PoseLandmark[];
  /** Coordenadas métricas (metros) si MediaPipe pudo estimarlas. */
  worldLandmarks?: PoseLandmark[];
  timestamp: number;
}

export interface UseMediaPipePoseReturn {
  isReady: boolean;
  loadingProgress: number;
  analyzeImage(
    image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageData
  ): Promise<PoseAnalysisResult>;
  error: string | null;
}

// Local-first hosting (Bucket PP.2):
//   1. Probamos `/models/mediapipe/` (servido desde nuestro origen — habilita
//      offline/PWA y evita egress hacia jsdelivr/Google por GDPR / ley 19.628).
//   2. Si el HEAD probe local devuelve 404 (e.g. el dev no corrió
//      `node scripts/download-mediapipe-models.mjs`), caemos al CDN público.
// Los assets locales los provee `scripts/download-mediapipe-models.mjs`,
// invocado por `npm run prebuild`.
const LOCAL_WASM_BASE = '/models/mediapipe';
const LOCAL_MODEL_URL = '/models/mediapipe/pose_landmarker_lite.task';
const CDN_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const CDN_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * HEAD probe contra el path local. Si responde 2xx, asumimos que el
 * prebuild bajó los assets y los servimos desde nuestro origen. Si
 * falla (404, network error en SSR/test), retornamos false → fallback
 * al CDN. El probe se hace una sola vez por sesión (memoizado por el
 * caller, ver `ensureLandmarker`).
 */
async function probeLocalAssets(): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const r = await fetch(LOCAL_MODEL_URL, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

export function useMediaPipePose(): UseMediaPipePoseReturn {
  const landmarkerRef = useRef<unknown>(null);
  const initPromiseRef = useRef<Promise<unknown> | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Cleanup: cierra el landmarker al desmontar.
  useEffect(() => {
    return () => {
      const lm = landmarkerRef.current as { close?: () => void } | null;
      if (lm && typeof lm.close === 'function') {
        try {
          lm.close();
        } catch (e) {
          logger.warn('useMediaPipePose: error closing landmarker', e);
        }
      }
      landmarkerRef.current = null;
      initPromiseRef.current = null;
    };
  }, []);

  // Inicialización lazy. Reutiliza la promise si ya está en curso.
  const ensureLandmarker = useCallback(async (): Promise<unknown> => {
    if (landmarkerRef.current) return landmarkerRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    const promise = (async () => {
      setLoadingProgress(10);
      setError(null);
      try {
        // Lazy import — chunk separado, no penaliza bundle inicial.
        const mp = await import('@mediapipe/tasks-vision');
        setLoadingProgress(30);

        // Local-first: intentamos servir WASM + modelo desde nuestro
        // origen. Si fallan (dev no corrió prebuild) caemos al CDN.
        const localOk = await probeLocalAssets();
        const wasmBase = localOk ? LOCAL_WASM_BASE : CDN_WASM_BASE;
        const modelUrl = localOk ? LOCAL_MODEL_URL : CDN_MODEL_URL;
        if (!localOk) {
          logger.info(
            'useMediaPipePose: assets locales no encontrados en /models/mediapipe/, usando CDN. Corré `npm run prebuild` para hosting local.',
          );
        }
        setLoadingProgress(50);

        const vision = await mp.FilesetResolver.forVisionTasks(wasmBase);
        setLoadingProgress(70);

        const landmarker = await mp.PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelUrl,
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          numPoses: 1,
        });
        setLoadingProgress(100);
        setIsReady(true);
        landmarkerRef.current = landmarker;
        return landmarker;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('useMediaPipePose: failed to initialize', e);
        setError(msg);
        initPromiseRef.current = null;
        throw e;
      }
    })();

    initPromiseRef.current = promise;
    return promise;
  }, []);

  const analyzeImage = useCallback(
    async (
      image:
        | HTMLImageElement
        | HTMLVideoElement
        | HTMLCanvasElement
        | ImageData
    ): Promise<PoseAnalysisResult> => {
      const lm = (await ensureLandmarker()) as {
        detect: (img: unknown) => {
          landmarks: PoseLandmark[][];
          worldLandmarks?: PoseLandmark[][];
        };
      };

      // PoseLandmarker.detect espera una imagen "list of poses".
      const result = lm.detect(image);
      const first = result.landmarks?.[0];
      if (!first || first.length === 0) {
        throw new Error(
          'MediaPipe no detectó ninguna pose en la imagen. Asegura que el trabajador esté visible de cuerpo entero.'
        );
      }

      return {
        landmarks: first,
        worldLandmarks: result.worldLandmarks?.[0],
        timestamp: Date.now(),
      };
    },
    [ensureLandmarker]
  );

  return { isReady, loadingProgress, analyzeImage, error };
}
