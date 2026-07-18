// Praeventio Guard — Sprint 56 (stream-slm-shell).
//
// `<SlmDownloadFloatingBanner />` es un banner flotante persistente que
// aparece en TODO el shell mientras la descarga del SLM corre en
// segundo plano. Diseño "pill" en bottom-right con barra de progreso,
// bytes descargados/total, y controles para pausar / reanudar /
// reintentar. Tap → abre el modal grande (mismo `SlmAcquisitionPrompt`)
// con todos los detalles.
//
// Decisiones de UX:
//   - El banner desaparece automáticamente cuando state === 'ready' o
//     downloadPhase === 'done'. Sin botón "cerrar": el usuario controla
//     la descarga, no el banner.
//   - En estado 'retrying', el banner muestra un spinner sutil + texto
//     "Reanudando...". El usuario no necesita hacer nada — el backoff
//     exponencial sigue corriendo.
//   - En estado 'failed', mostramos botón "Reintentar" explícito.
//   - Pausar/Reanudar son las únicas acciones inline. Cambios de modelo
//     o cancelación viven en `<SlmManagerScreen />`.
//
// Accesibilidad: role="status" + aria-live="polite" para que screen
// readers anuncien el progreso. Barra con role="progressbar" y atributos
// aria-valuenow/min/max.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Pause, Play, RefreshCw, Loader2 } from 'lucide-react';

import { useSlmAcquisition, type DownloadPhase } from '../../hooks/useSlmAcquisition';
import { formatBytesHuman } from '../../services/slm/slmAcquisitionService';
import { SlmAcquisitionPrompt } from './SlmAcquisitionPrompt';
import { humanErrorMessage } from '../../lib/humanError';


export interface SlmDownloadFloatingBannerProps {
  /**
   * Permite al caller pasar un hook ya instanciado (compartir el mismo
   * estado entre el banner y el modal). Si no se pasa, el banner crea
   * su propia instancia — útil cuando el caller no quiere acoplar.
   *
   * Nota sobre Hooks rules: cuando el caller pasa `acquisition`, el
   * banner skipea su propio `useSlmAcquisition()` para evitar dos
   * suscripciones al state machine. Para no romper la regla de hooks
   * (no-conditional), envolvemos la versión "owned" en
   * `<SlmDownloadFloatingBannerOwned />` y montamos uno u otro.
   */
  acquisition?: ReturnType<typeof useSlmAcquisition>;
}

function SlmDownloadFloatingBannerOwned() {
  const acquisition = useSlmAcquisition();
  return <SlmDownloadFloatingBannerInner acquisition={acquisition} />;
}

function phaseLabel(phase: DownloadPhase, t: (k: string, fb: string) => string): string {
  switch (phase) {
    case 'active':
      return t('slmBanner.phaseActive', 'Descargando IA offline…');
    case 'retrying':
      return t('slmBanner.phaseRetrying', 'Reanudando descarga…');
    case 'paused':
      return t('slmBanner.phasePaused', 'Descarga en pausa');
    case 'failed':
      return t('slmBanner.phaseFailed', 'No se pudo completar');
    default:
      return t('slmBanner.phaseIdle', 'Asistente IA listo');
  }
}

export function SlmDownloadFloatingBanner({
  acquisition,
}: SlmDownloadFloatingBannerProps = {}) {
  if (acquisition) {
    return <SlmDownloadFloatingBannerInner acquisition={acquisition} />;
  }
  return <SlmDownloadFloatingBannerOwned />;
}

interface InnerProps {
  acquisition: ReturnType<typeof useSlmAcquisition>;
}

function SlmDownloadFloatingBannerInner({ acquisition: own }: InnerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const {
    status,
    networkAdvisory,
    downloadProgress,
    downloadedBytes,
    downloadPhase,
    error,
    pause,
    resume,
    retry,
    postpone,
    decline,
    accept,
  } = own;

  if (!status) return null;
  // Hide cuando ya quedó listo y NO estamos descargando.
  const isWorking =
    status.state === 'downloading' ||
    downloadPhase === 'active' ||
    downloadPhase === 'retrying' ||
    downloadPhase === 'paused' ||
    downloadPhase === 'failed';
  if (!isWorking) return null;

  const progressPct = Math.max(
    0,
    Math.min(100, Math.round((downloadProgress ?? 0) * 100)),
  );
  const downloadedLabel = formatBytesHuman(downloadedBytes ?? 0);
  const totalLabel = formatBytesHuman(status.totalBytes);
  const label = phaseLabel(downloadPhase, (k, fb) => t(k, fb) as string);

  return (
    <>
      <div
        data-testid="slm-floating-banner"
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-40 max-w-xs w-[min(92vw,22rem)] rounded-2xl border-2 border-teal-500/40 bg-white/95 dark:bg-stone-900/95 backdrop-blur-sm shadow-xl p-3"
      >
        <button
          type="button"
          data-testid="slm-floating-banner-open"
          onClick={() => setExpanded(true)}
          aria-label={t('slmBanner.openDetails', 'Ver detalle de descarga') as string}
          className="w-full text-left flex items-center gap-2"
        >
          <div className="shrink-0 w-8 h-8 rounded-full bg-teal-500/15 flex items-center justify-center">
            {downloadPhase === 'retrying' ? (
              <Loader2
                className="w-4 h-4 text-teal-600 dark:text-teal-400 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Cpu
                className="w-4 h-4 text-teal-600 dark:text-teal-400"
                aria-hidden="true"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-stone-900 dark:text-stone-100 truncate">
              {label}
            </p>
            <p
              data-testid="slm-floating-banner-bytes"
              className="text-[10px] opacity-70 font-mono"
            >
              {downloadedLabel} / {totalLabel} ({progressPct}%)
            </p>
          </div>
        </button>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          className="mt-2 w-full h-1.5 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden"
        >
          <div
            data-testid="slm-floating-banner-fill"
            style={{ width: `${progressPct}%` }}
            className={`h-full transition-all ${
              downloadPhase === 'failed'
                ? 'bg-rose-500'
                : downloadPhase === 'paused'
                  ? 'bg-amber-500'
                  : 'bg-teal-500'
            }`}
          />
        </div>

        {error && downloadPhase === 'failed' && (
          <p
            data-testid="slm-floating-banner-error"
            className="mt-2 text-[10px] text-rose-700 dark:text-rose-300"
          >
            {humanErrorMessage(error)}
          </p>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          {(downloadPhase === 'active' || downloadPhase === 'retrying') && (
            <button
              type="button"
              onClick={pause}
              data-testid="slm-floating-banner-pause"
              aria-label={t('slmBanner.pause', 'Pausar descarga') as string}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-500/30 text-[10px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <Pause className="w-3 h-3" aria-hidden="true" />
              {t('slmBanner.pauseBtn', 'Pausar')}
            </button>
          )}
          {downloadPhase === 'paused' && (
            <button
              type="button"
              onClick={() => {
                void resume();
              }}
              data-testid="slm-floating-banner-resume"
              aria-label={t('slmBanner.resume', 'Reanudar descarga') as string}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-teal-600 text-white text-[10px] font-bold hover:brightness-110"
            >
              <Play className="w-3 h-3" aria-hidden="true" />
              {t('slmBanner.resumeBtn', 'Reanudar')}
            </button>
          )}
          {downloadPhase === 'failed' && (
            <button
              type="button"
              onClick={() => {
                void retry();
              }}
              data-testid="slm-floating-banner-retry"
              aria-label={t('slmBanner.retry', 'Reintentar descarga') as string}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-teal-600 text-white text-[10px] font-bold hover:brightness-110"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              {t('slmBanner.retryBtn', 'Reintentar')}
            </button>
          )}
          {networkAdvisory === 'offline' && downloadPhase !== 'paused' && (
            <span
              data-testid="slm-floating-banner-offline-hint"
              className="text-[9px] opacity-60 ml-auto"
            >
              {t('slmBanner.offlineHint', 'Sin red — reanudará al volver')}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <SlmAcquisitionPrompt
          status={status}
          networkAdvisory={networkAdvisory}
          downloadProgress={downloadProgress}
          downloadedBytes={downloadedBytes}
          onAccept={() => {
            void accept();
          }}
          onPostpone={() => {
            postpone();
            setExpanded(false);
          }}
          onDecline={() => {
            decline();
            setExpanded(false);
          }}
          onDismiss={() => setExpanded(false)}
        />
      )}
    </>
  );
}
