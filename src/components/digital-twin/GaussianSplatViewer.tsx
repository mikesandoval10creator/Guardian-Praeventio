// Praeventio Guard — Fase D parcial: Visor 3D Gaussian Splat de la faena.
//
// Componente shell que:
//   1. Recibe una `SplatCapture` (la canónica del proyecto).
//   2. Evalúa calidad y muestra warnings si aplica.
//   3. Renderiza presets de cámara cardinal.
//   4. Lista overlays de simulación (rutas, puntos encuentro, riesgos).
//   5. Lazy-carga el engine `playcanvas` SOLO cuando el usuario abre el
//      visor 3D — evita penalizar el bundle inicial.
//
// NOTA: el render WebGL real (canvas con engine playcanvas) está
// detrás de un `<button>` "Abrir visor 3D" que dynamically importa el
// código pesado. Hasta que se haga click, el componente es ~5KB.
//
// Si playcanvas no está instalado, el visor muestra un placeholder
// con instrucciones para activar la funcionalidad.

import { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, AlertTriangle, Box, Play, MapPin, Route, Loader2 } from 'lucide-react';
import {
  evaluateSplatQuality,
  buildCardinalPresets,
  pathLength,
  estimateEvacuationTimeSec,
  type SplatCapture,
  type SplatOverlay,
  type CameraPreset,
} from '../../services/digitalTwin/gaussianSplatRegistry.js';

interface GaussianSplatViewerProps {
  capture: SplatCapture | null;
  overlays?: SplatOverlay[];
  /** Si el caller maneja la integración del engine playcanvas. */
  onRender3D?: (capture: SplatCapture, preset: CameraPreset) => void;
}

export function GaussianSplatViewer({
  capture,
  overlays = [],
  onRender3D,
}: GaussianSplatViewerProps) {
  const { t } = useTranslation();
  const [selectedPreset, setSelectedPreset] = useState<CameraPreset | null>(null);
  const [is3DOpen, setIs3DOpen] = useState(false);
  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const quality = useMemo(
    () => (capture ? evaluateSplatQuality(capture) : null),
    [capture],
  );
  const presets = useMemo(
    () => (capture ? buildCardinalPresets(capture.extentMeters) : []),
    [capture],
  );

  // Lazy load engine al abrir el visor
  useEffect(() => {
    if (!is3DOpen || engineState !== 'idle') return;
    setEngineState('loading');
    let aborted = false;
    (async () => {
      try {
        // Dynamic import — falla limpio si playcanvas no está instalado.
        // Variable + @vite-ignore para que Vite no falle en tiempo de bundle
        // cuando el paquete optional no está presente.
        const pkgName = 'playcanvas';
        const mod = await import(/* @vite-ignore */ pkgName).catch(() => null);
        if (aborted) return;
        if (!mod) {
          setEngineState('unavailable');
          return;
        }
        setEngineState('ready');
      } catch {
        if (!aborted) setEngineState('unavailable');
      }
    })();
    return () => {
      aborted = true;
    };
  }, [is3DOpen, engineState]);

  if (!capture) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-6 text-center text-secondary-token"
        data-testid="splat-viewer-empty"
      >
        <Box className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <p className="text-sm font-semibold mb-1">
          {t('splat.noCapture', 'Sin captura 3D de la faena')}
        </p>
        <p className="text-xs">
          {t(
            'splat.captureHint',
            'Sube una captura .ply o .splat para habilitar el visor del Digital Twin.',
          )}
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="splat-viewer"
      aria-label={t('splat.aria', 'Visor 3D Gaussian Splat') as string}
    >
      <header className="flex items-center gap-2">
        <Box className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('splat.title', 'Digital Twin — Captura 3D')}
        </h2>
        {quality && (
          <span
            className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${
              quality.level === 'excellent' || quality.level === 'good'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : quality.level === 'fair'
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
            data-testid="splat-quality-badge"
          >
            {quality.level.toUpperCase()} · {quality.qualityScore}/100
          </span>
        )}
      </header>

      {/* Metadata captura */}
      <div className="grid grid-cols-2 gap-2 text-xs text-secondary-token">
        <div>
          <span className="text-[10px] uppercase opacity-70">
            {t('splat.splatCount', 'Splats')}
          </span>
          <p className="font-bold tabular-nums">
            {(capture.splatCount / 1_000_000).toFixed(1)}M
          </p>
        </div>
        <div>
          <span className="text-[10px] uppercase opacity-70">
            {t('splat.extent', 'Cobertura')}
          </span>
          <p className="font-bold tabular-nums">{capture.extentMeters}m</p>
        </div>
      </div>

      {/* Quality issues */}
      {quality && quality.issues.length > 0 && (
        <ul className="space-y-1" data-testid="splat-quality-issues">
          {quality.issues.map((issue, i) => (
            <li
              key={i}
              className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1"
            >
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Camera presets */}
      <div>
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1.5">
          {t('splat.cameras', 'Cámaras')}
        </h3>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid={`splat-preset-${p.id}`}
              onClick={() => {
                setSelectedPreset(p);
                if (onRender3D) onRender3D(capture, p);
              }}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold border ${
                selectedPreset?.id === p.id
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-surface-elevated border-default-token text-secondary-token hover:bg-surface'
              }`}
            >
              <Camera className="w-3 h-3" aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Simulation overlays */}
      {overlays.length > 0 && (
        <div data-testid="splat-overlays">
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1.5">
            {t('splat.simulations', 'Simulaciones / Overlays')} ({overlays.length})
          </h3>
          <ul className="space-y-1">
            {overlays.map((o) => {
              const Icon =
                o.kind === 'evacuation_path' ? Route : o.kind === 'meeting_point' ? MapPin : Box;
              const isPath = o.kind === 'evacuation_path';
              const length = isPath ? pathLength(o.coords) : 0;
              return (
                <li
                  key={o.id}
                  data-testid={`splat-overlay-${o.id}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <Icon
                    className="w-3 h-3 shrink-0"
                    style={{ color: o.color }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 min-w-0">{o.label}</span>
                  {isPath && (
                    <span className="text-[10px] opacity-70 tabular-nums">
                      {length}m · ~{estimateEvacuationTimeSec(length)}s
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 3D viewer (lazy) */}
      <div className="pt-2 border-t border-default-token">
        {!is3DOpen && quality?.isViewable && (
          <button
            type="button"
            data-testid="splat-open-3d"
            onClick={() => setIs3DOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600"
          >
            <Play className="w-3 h-3" aria-hidden="true" />
            {t('splat.openViewer', 'Abrir visor 3D')}
          </button>
        )}

        {is3DOpen && engineState === 'loading' && (
          <div
            data-testid="splat-engine-loading"
            className="flex items-center justify-center gap-2 p-3 text-xs text-secondary-token"
          >
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {t('splat.loadingEngine', 'Cargando motor 3D...')}
          </div>
        )}

        {is3DOpen && engineState === 'unavailable' && (
          <div
            data-testid="splat-engine-unavailable"
            className="rounded-md bg-amber-500/10 border border-amber-500/30 text-xs p-3 space-y-1"
          >
            <p className="font-bold text-amber-700 dark:text-amber-300">
              {t('splat.engineMissing', 'Motor 3D no instalado')}
            </p>
            <p className="text-amber-600 dark:text-amber-300/80">
              {t(
                'splat.engineMissingHint',
                'Agrega `playcanvas` y `@playcanvas/react` para activar el visor. El registro determinístico funciona sin esa dep.',
              )}
            </p>
          </div>
        )}

        {is3DOpen && engineState === 'ready' && (
          <canvas
            ref={canvasRef}
            data-testid="splat-canvas"
            className="w-full aspect-video rounded-md bg-black"
            aria-label={t('splat.canvasAria', 'Canvas 3D del visor') as string}
          />
        )}
      </div>
    </section>
  );
}
