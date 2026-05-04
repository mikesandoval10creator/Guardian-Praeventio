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

// URL de WASM y modelo. CDN-only por ahora.
const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

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
        setLoadingProgress(40);

        const vision = await mp.FilesetResolver.forVisionTasks(WASM_BASE);
        setLoadingProgress(70);

        const landmarker = await mp.PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
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
