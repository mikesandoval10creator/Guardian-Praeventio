// SPDX-License-Identifier: MIT
//
// ARPosterScanner — Sprint G (2026-05-16) AR Real Vision, caso 4.
//
// Modo AR para escanear afiches de seguridad físicos en la faena y
// recibir animaciones educativas superpuestas. Cumple la directiva
// del usuario:
//
//   "imagina la aplicación ya tiene para poder hacer afiches de
//    seguridad, entonces mediante el ar real, podría dirigir la
//    cámara hacia el afiche de seguridad y genera una animación
//    relacionada, uff que pasada"
//
// Flujo:
//   1. Usuario entra al modo desde /digital-twin/ar (Modo 3)
//   2. Activamos cámara trasera (env-facing)
//   3. Cada ~250ms (configurable) capturamos frame al canvas
//      y corremos el matcher MediaPipe vs catálogo
//   4. Si matchea sobre threshold:
//        - mostramos overlay con animación step-by-step
//        - guardamos PosterAnchor (telemetría + persistencia)
//        - debounce 5s para no re-matchear el mismo poster
//   5. Usuario lee la animación; puede dismiss o esperar al final
//
// IMPORTANTE: este modo NO requiere WebXR — funciona con cualquier
// dispositivo que tenga cámara + browser moderno. Esto es deliberado:
// muchas faenas tienen tablets/celulares sin WebXR pero CON cámara, y
// el valor educativo del poster scan no requiere AR pose tracking.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useProject } from '../../contexts/ProjectContext';
import { useTenantId } from '../../hooks/useTenantId';
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { logger } from '../../utils/logger';
import {
  closePosterMatcher,
  getPosterMatcher,
  type PosterMatchResult,
} from '../../services/ar/posterMatcher';
import {
  POSTER_CATALOG_SEED,
  type PosterAnimationStep,
  type PosterDefinition,
} from '../../services/ar/posterCatalog';
import {
  matrixFromPosition,
  newAnchorId,
  type PosterAnchor,
} from '../../services/ar/arAnchorService';
import {
  Camera,
  X,
  ScanLine,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Pause,
  Play,
  BookOpen,
} from 'lucide-react';

const SCAN_INTERVAL_MS = 250; // 4 escaneos por segundo
const DEBOUNCE_AFTER_MATCH_MS = 5000; // no re-matchear el mismo poster por 5s

export interface ARPosterScannerProps {
  onExit?: () => void;
  /**
   * Catálogo a usar — por defecto el seed completo. Inyectable para
   * tests + para usar catálogo específico de la empresa (tenant-custom).
   */
  catalog?: readonly PosterDefinition[];
}

/**
 * Subcomponente que reproduce la animación step_sequence.
 * Mantiene su propio timer y permite navegar manualmente.
 */
function PosterAnimationOverlay({
  poster,
  onClose,
}: {
  poster: PosterDefinition;
  onClose: () => void;
}) {
  const steps: PosterAnimationStep[] =
    poster.animation.kind === 'step_sequence' && poster.animation.steps
      ? poster.animation.steps
      : [];

  const [currentStep, setCurrentStep] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-avance del timer.
  useEffect(() => {
    if (paused) return;
    if (steps.length === 0) return;
    const step = steps[currentStep];
    if (!step) return;
    const timer = window.setTimeout(() => {
      if (currentStep < steps.length - 1) {
        setCurrentStep((s) => s + 1);
      }
    }, step.durationMs);
    return () => window.clearTimeout(timer);
  }, [currentStep, paused, steps]);

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-4">
      <div className="w-full max-w-md bg-zinc-900 border-2 border-teal-400/40 rounded-2xl p-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-teal-300 shrink-0" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-teal-300">
                Afiche detectado
              </p>
            </div>
            <h2 className="text-base font-bold text-white truncate">{poster.title}</h2>
            <p className="text-[10px] text-zinc-400">{poster.regulationRef}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Barra de progreso */}
        <div className="flex gap-1 mb-3" aria-label="Progreso pasos">
          {steps.map((s, i) => (
            <div
              key={s.order}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < currentStep
                  ? 'bg-teal-500'
                  : i === currentStep
                    ? 'bg-teal-400 animate-pulse'
                    : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Step actual */}
        {step && (
          <div className="bg-black/40 rounded-xl p-4 min-h-[140px] flex items-center">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-full bg-teal-500/20 border-2 border-teal-400/50 flex items-center justify-center">
                <span className="text-teal-200 font-bold text-sm">{step.order}</span>
              </div>
              <p className="text-sm text-white leading-relaxed">{step.text}</p>
            </div>
          </div>
        )}

        {/* Controles */}
        <div className="flex items-center justify-between mt-4 gap-2">
          <button
            type="button"
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            disabled={currentStep === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/20 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Reanudar' : 'Pausar'}
            className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
          {!isLast ? (
            <button
              type="button"
              onClick={() => setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-teal-500/30 text-teal-200 text-xs font-bold hover:bg-teal-500/40 transition-colors"
            >
              Siguiente
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-teal-500/30 text-teal-200 text-xs font-bold hover:bg-teal-500/40 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Listo
            </button>
          )}
        </div>

        {/* Tags */}
        {poster.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {poster.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full bg-white/5 text-[9px] text-zinc-400 uppercase tracking-wider"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ARPosterScanner({ onExit, catalog }: ARPosterScannerProps) {
  const { user } = useFirebase();
  const { tenantId } = useTenantId();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  // Catálogo efectivo — solo posters con embedding pre-computado se
  // pueden matchear; los otros aparecen en el listado pero no en el
  // loop de matching.
  //
  // Codex fix 2026-05-16: antes filtrábamos POSTER_CATALOG_SEED y
  // descartábamos posters tenant-custom (que es justo el caso de uso
  // documentado del prop `catalog`). Ahora filtramos `source` directo
  // por `referenceEmbedding` — los posters custom con embedding propio
  // pasan; los que apuntan a un seed-id con embedding propio también.
  const matchableCatalog = useMemo(() => {
    const source = catalog ?? POSTER_CATALOG_SEED;
    return source.filter(
      (p) => Array.isArray(p.referenceEmbedding) && p.referenceEmbedding.length > 0,
    );
  }, [catalog]);

  const fullCatalog = useMemo(() => catalog ?? POSTER_CATALOG_SEED, [catalog]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const lastMatchAtRef = useRef<number>(0);
  const lastMatchIdRef = useRef<string | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [matcherReady, setMatcherReady] = useState(false);
  // Codex fix 2026-05-16: antes solo logueábamos el error de init y
  // dejábamos `matcherReady=false` permanente — el usuario veía
  // "Cargando matcher IA..." para siempre. Ahora el error se muestra
  // como tarjeta tipo `cameraError` con CTA de retry.
  const [matcherError, setMatcherError] = useState<string | null>(null);
  const [matcherInitNonce, setMatcherInitNonce] = useState(0);
  const [matchedPoster, setMatchedPoster] = useState<PosterDefinition | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [lastSimilarity, setLastSimilarity] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  // Camera setup.
  useEffect(() => {
    let cancelled = false;
    const setupCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Cámara no disponible en este navegador.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            /* play() rejected — quizá user gesture requerido */
          });
        }
        setCameraReady(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('ARPosterScanner: camera setup failed', err);
        setCameraError(msg);
      }
    };
    void setupCamera();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Matcher init (warm-up del modelo).
  // Codex fix 2026-05-16: ahora setMatcherError() en lugar de solo
  // loggear — sin esto el usuario veía "Cargando matcher IA..." para
  // siempre cuando el modelo no carga (típico: sin CDN ni assets
  // locales). `matcherInitNonce` permite retry sin remontar.
  useEffect(() => {
    let cancelled = false;
    const initMatcher = async () => {
      try {
        setMatcherError(null);
        const matcher = getPosterMatcher({
          thresholdSimilarity: 0.85,
          runningMode: 'IMAGE',
        });
        await matcher.init();
        if (!cancelled) setMatcherReady(true);
      } catch (err) {
        logger.error('ARPosterScanner: matcher init failed', err);
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setMatcherError(msg);
        }
      }
    };
    void initMatcher();
    return () => {
      cancelled = true;
      // Cerramos el matcher al salir del scanner.
      closePosterMatcher();
    };
  }, [matcherInitNonce]);

  // Guardar/actualizar PosterAnchor cuando matchea.
  // El path Firestore: tenants/{tid}/ar_anchors/{id}
  //
  // Codex fix 2026-05-16: antes creábamos UN NUEVO documento con
  // newAnchorId('poster') por cada match exitoso (incluso después del
  // debounce de 5s). Resultado: scanCount estaba siempre en 1 por
  // anchor + el historial AR del proyecto se llenaba de duplicados.
  // Ahora hacemos query previa por (projectId, posterId): si existe,
  // incrementamos scanCount + actualizamos GPS/timestamp. Si no, creamos.
  const savePosterAnchor = useCallback(
    async (poster: PosterDefinition, similarity: number) => {
      if (!tenantId || !projectId || !user) return;
      const nowIso = new Date().toISOString();
      const colRef = collection(db, `tenants/${tenantId}/ar_anchors`);
      try {
        const existingSnap = await getDocs(
          query(
            colRef,
            where('projectId', '==', projectId),
            where('kind', '==', 'poster'),
            where('posterId', '==', poster.id),
            limit(1),
          ),
        );
        const gps = await captureGpsOrZero();

        if (!existingSnap.empty) {
          const docSnap = existingSnap.docs[0]!;
          const existing = docSnap.data() as PosterAnchor;
          await updateDoc(docSnap.ref, {
            scanCount: (existing.scanCount ?? 0) + 1,
            updatedAt: nowIso,
            gps, // refresca posición — el poster puede haber sido movido
            tags: [`sim:${similarity.toFixed(3)}`],
          });
          return;
        }

        const anchor: PosterAnchor = {
          id: newAnchorId('poster'),
          kind: 'poster',
          projectId,
          tenantId,
          createdByUid: user.uid,
          createdAt: nowIso,
          updatedAt: nowIso,
          gps,
          matrix: matrixFromPosition(0, 0, 0),
          label: poster.title,
          posterId: poster.id,
          scanCount: 1,
          tags: [`sim:${similarity.toFixed(3)}`],
        };
        await setDoc(doc(colRef, anchor.id), anchor);
      } catch (err) {
        logger.warn('ARPosterScanner: failed to persist anchor', err);
        // No bloqueamos UX — la animación se muestra igual.
      }
    },
    [tenantId, projectId, user],
  );

  // Loop de escaneo.
  useEffect(() => {
    if (!cameraReady || !matcherReady || paused || matchedPoster) return;
    if (!videoRef.current || !canvasRef.current) return;
    if (matchableCatalog.length === 0) {
      // Sin embeddings pre-computados, el loop no haría nada útil.
      return;
    }

    const tick = async () => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (video.readyState < 2) return; // todavía cargando metadata

      // Codex fix 2026-05-16: la UI muestra un reticle (w-2/3 + aspect-[3/4])
      // donde el usuario alinea el poster. Antes pasábamos el frame
      // COMPLETO al embedder — incluía paredes/máquinas/fondo y degradaba
      // el match porque la imagen de referencia es solo el poster.
      // Ahora recortamos al rectángulo del reticle ANTES de embedearlo.
      //
      // Geometría del reticle: 2/3 del width del video, aspect 3:4
      // (alto = width * 4/3), centrado. El canvas final mantiene esa
      // forma para que el embedder reciba un tile rectangular bien
      // alineado con la imagen de referencia.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cropW = Math.floor(vw * (2 / 3));
      // aspecto 3:4 (más alto que ancho) — el reticle del DOM es así.
      const cropH = Math.min(vh, Math.floor(cropW * (4 / 3)));
      const cropX = Math.floor((vw - cropW) / 2);
      const cropY = Math.floor((vh - cropH) / 2);

      canvas.width = cropW;
      canvas.height = cropH;
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      setScanCount((c) => c + 1);

      try {
        const matcher = getPosterMatcher();
        const result: PosterMatchResult | null = await matcher.matchFrame(
          canvas,
          matchableCatalog,
        );
        if (!result) return;
        setLastSimilarity(result.similarity);

        // Debounce: si el mismo poster matcheó hace <5s, ignorar.
        const now = performance.now();
        if (
          lastMatchIdRef.current === result.poster.id &&
          now - lastMatchAtRef.current < DEBOUNCE_AFTER_MATCH_MS
        ) {
          return;
        }
        lastMatchIdRef.current = result.poster.id;
        lastMatchAtRef.current = now;

        // Trigger UI.
        setMatchedPoster(result.poster);
        void savePosterAnchor(result.poster, result.similarity);
      } catch (err) {
        logger.warn('ARPosterScanner: matcher tick failed', err);
      }
    };

    intervalRef.current = window.setInterval(() => {
      void tick();
    }, SCAN_INTERVAL_MS);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cameraReady, matcherReady, paused, matchedPoster, matchableCatalog, savePosterAnchor]);

  const handleCloseAnimation = () => {
    setMatchedPoster(null);
  };

  const projectMissing = !projectId;
  const matchableCount = matchableCatalog.length;
  const totalCatalog = fullCatalog.length;

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      {/* Header */}
      <div className="pointer-events-auto m-4 flex items-center justify-between bg-black/70 backdrop-blur-md border border-white/10 rounded-2xl p-3">
        <div className="flex items-center gap-2">
          <ScanLine className="w-5 h-5 text-teal-400" />
          <div>
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              Escáner de Afiches
            </p>
            <p className="text-[10px] text-zinc-400">
              {selectedProject?.name ?? 'Sin proyecto'}
              {' · '}
              <span>{matchableCount}/{totalCatalog} afiches matcheables</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label="Salir escáner"
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Video feed con overlay scan-line */}
      <div className="relative flex-1 overflow-hidden mx-4 rounded-2xl bg-zinc-950">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Canvas oculto para captura de frames */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Marco objetivo + animación scan-line */}
        {cameraReady && !matchedPoster && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-2/3 max-w-md aspect-[3/4] border-2 border-teal-400/60 rounded-2xl overflow-hidden">
              {/* Corners */}
              <span className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-teal-400 rounded-tl-xl" />
              <span className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-teal-400 rounded-tr-xl" />
              <span className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-teal-400 rounded-bl-xl" />
              <span className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-teal-400 rounded-br-xl" />
              {/* Scan line */}
              <div
                className="absolute left-0 right-0 h-0.5 bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.7)]"
                style={{
                  animation: 'scan 2s linear infinite',
                }}
              />
            </div>
          </div>
        )}

        {/* Estado: cámara cargando */}
        {!cameraReady && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 bg-black/70 px-4 py-3 rounded-lg">
              <Camera className="w-5 h-5 text-zinc-400 animate-pulse" />
              <p className="text-sm text-white">Iniciando cámara...</p>
            </div>
          </div>
        )}

        {/* Estado: error cámara */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-rose-900/85 border border-rose-400/40 rounded-2xl p-4 max-w-md">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-rose-100">
                    No pudimos abrir la cámara
                  </p>
                  <p className="text-xs text-rose-200/80 mt-1">{cameraError}</p>
                  <p className="text-[10px] text-rose-200/60 mt-2">
                    Verifica permisos del navegador. En iOS Safari, asegúrate de
                    estar usando HTTPS y de no haber bloqueado el sitio.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Estado: sin proyecto activo */}
        {cameraReady && projectMissing && (
          <div className="absolute inset-x-0 bottom-4 mx-4 bg-amber-900/85 border border-amber-400/40 rounded-2xl p-3">
            <p className="text-xs text-amber-100">
              Selecciona un proyecto activo para guardar el historial de escaneos.
              El escáner funciona igual sin proyecto, pero no se persistirán los
              anchors.
            </p>
          </div>
        )}

        {/* Estado: matcher cargando */}
        {cameraReady && !matcherReady && !matcherError && !cameraError && (
          <div className="absolute top-4 right-4 bg-black/70 px-3 py-2 rounded-lg">
            <p className="text-[10px] text-zinc-300">Cargando matcher IA...</p>
          </div>
        )}

        {/* Estado: matcher falló cargar — Codex #4 */}
        {matcherError && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-auto">
            <div className="bg-rose-900/85 border border-rose-400/40 rounded-2xl p-4 max-w-md">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-rose-100">
                    No pudimos cargar el matcher IA
                  </p>
                  <p className="text-xs text-rose-200/80 mt-1">{matcherError}</p>
                  <p className="text-[10px] text-rose-200/60 mt-2">
                    Verifica conexión a Internet o asegúrate de tener los
                    modelos MediaPipe locales en /models/mediapipe/. La cámara
                    sigue funcionando pero el scanner no podrá matchear hasta
                    que el modelo cargue.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  closePosterMatcher();
                  setMatcherReady(false);
                  setMatcherError(null);
                  setMatcherInitNonce((n) => n + 1);
                }}
                className="w-full px-3 py-2 rounded-lg bg-rose-500/30 text-rose-100 text-xs font-bold hover:bg-rose-500/40 transition-colors"
              >
                Reintentar carga
              </button>
            </div>
          </div>
        )}

        {/* Telemetría discreta */}
        {cameraReady && matcherReady && !matchedPoster && (
          <div className="absolute top-4 left-4 bg-black/60 px-3 py-1.5 rounded-lg pointer-events-none">
            <p className="text-[10px] font-mono text-zinc-300">
              {scanCount} frames
              {lastSimilarity !== null && (
                <span className="ml-2 text-zinc-500">
                  · sim {lastSimilarity.toFixed(2)}
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Footer controls */}
      <div className="pointer-events-auto m-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 text-white text-xs font-bold border border-white/10 hover:bg-zinc-700 transition-colors"
        >
          {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          {paused ? 'Reanudar escaneo' : 'Pausar'}
        </button>
        {matchableCount === 0 && (
          <p className="text-[10px] text-amber-300 max-w-xs text-right">
            Catálogo aún sin embeddings pre-computados — el matcher local
            requiere correr `npm run seed:posters` antes de funcionar.
          </p>
        )}
      </div>

      {/* Overlay de animación */}
      {matchedPoster && (
        <PosterAnimationOverlay
          poster={matchedPoster}
          onClose={handleCloseAnimation}
        />
      )}

      {/* CSS para scan-line — keyframe local sin tocar tailwind config */}
      <style>{`
        @keyframes scan {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
      `}</style>
    </div>
  );
}

/**
 * Intenta capturar GPS rápido (timeout 3s). Si falla devuelve 0/0 para
 * no bloquear la persistencia del anchor.
 */
async function captureGpsOrZero(): Promise<{ latitude: number; longitude: number; altitudeM?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ latitude: 0, longitude: 0 });
      return;
    }
    const timer = setTimeout(() => resolve({ latitude: 0, longitude: 0 }), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitudeM: pos.coords.altitude ?? undefined,
        });
      },
      () => {
        clearTimeout(timer);
        resolve({ latitude: 0, longitude: 0 });
      },
      { maximumAge: 60000, timeout: 2500, enableHighAccuracy: false },
    );
  });
}
