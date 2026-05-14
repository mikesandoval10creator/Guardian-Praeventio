// Praeventio Guard — Wire UI: <SlmAcquisitionPrompt />
//
// "Estilo videojuego": al primer launch (o cuando un cooldown expira)
// mostramos un modal que avisa: "Para usar la IA sin internet en
// emergencias, necesitamos descargar X MB. WiFi recomendado.
// [Descargar ahora / Después / Solo modo online]".
//
// El componente es controlado por el caller: recibe el `AcquisitionStatus`
// computado por `getAcquisitionStatus()` y dispara los 3 callbacks
// (accept / postpone / decline). El callback de accept dispara la
// descarga real — este componente solo presenta UX + progreso.

import { useTranslation } from 'react-i18next';
import {
  Download,
  WifiOff,
  Wifi,
  Smartphone,
  CloudOff,
  Cpu,
  ShieldCheck,
  Clock,
  X,
  AlertTriangle,
} from 'lucide-react';
import type {
  AcquisitionStatus,
  NetworkAdvisory,
} from '../../services/slm/slmAcquisitionService.js';

interface SlmAcquisitionPromptProps {
  status: AcquisitionStatus;
  /** Advisory de la red actual (caller llama `detectNetworkAdvisory`). */
  networkAdvisory: NetworkAdvisory;
  /** Mostrado solo si state==='downloading' — 0..1. */
  downloadProgress?: number;
  /** Bytes descargados hasta ahora (para mostrar "X MB / Y MB"). */
  downloadedBytes?: number;
  /** Iniciar descarga (caller orquesta `slmRuntime.loadModel`). */
  onAccept: () => void;
  /** "Después" — cooldown 24h por default. */
  onPostpone: () => void;
  /** "Solo modo online, no preguntar de nuevo". */
  onDecline: () => void;
  /** Cerrar sin decidir (X button) — equivale a postpone. */
  onDismiss?: () => void;
}

const NETWORK_META: Record<
  NetworkAdvisory,
  { Icon: typeof Wifi; label: string; cls: string; warn: boolean }
> = {
  wifi: {
    Icon: Wifi,
    label: 'WiFi detectado',
    cls: 'text-emerald-700 dark:text-emerald-300',
    warn: false,
  },
  cellular: {
    Icon: Smartphone,
    label: 'Datos móviles',
    cls: 'text-amber-700 dark:text-amber-300',
    warn: true,
  },
  metered_unknown: {
    Icon: Smartphone,
    label: 'Conexión medida (Data Saver)',
    cls: 'text-amber-700 dark:text-amber-300',
    warn: true,
  },
  offline: {
    Icon: CloudOff,
    label: 'Sin conexión',
    cls: 'text-rose-700 dark:text-rose-300',
    warn: true,
  },
  unknown: {
    Icon: Wifi,
    label: 'Tipo de red no detectado',
    cls: 'text-stone-600 dark:text-stone-400',
    warn: false,
  },
};

export function SlmAcquisitionPrompt({
  status,
  networkAdvisory,
  downloadProgress,
  downloadedBytes,
  onAccept,
  onPostpone,
  onDecline,
  onDismiss,
}: SlmAcquisitionPromptProps) {
  const { t } = useTranslation();

  // Don't render anything in terminal/quiet states.
  if (
    status.state === 'ready' ||
    status.state === 'declined' ||
    status.state === 'postponed'
  ) {
    return null;
  }

  const net = NETWORK_META[networkAdvisory];
  const isDownloading = status.state === 'downloading';
  const progressPct = Math.max(
    0,
    Math.min(100, Math.round((downloadProgress ?? 0) * 100)),
  );
  const downloadedMb = downloadedBytes
    ? Math.round(downloadedBytes / (1024 * 1024))
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      data-testid="slm-acquisition-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slm-acq-title"
    >
      <div className="relative w-full max-w-md rounded-2xl border-2 border-teal-500/40 bg-white dark:bg-stone-900 p-5 shadow-2xl">
        {onDismiss && !isDownloading && (
          <button
            type="button"
            onClick={onDismiss}
            data-testid="slm-acq-dismiss"
            aria-label={t('slmAcq.dismiss', 'Cerrar') as string}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        <header className="flex items-start gap-3 mb-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-teal-500/15 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="slm-acq-title"
              className="text-base font-black text-stone-900 dark:text-stone-100"
            >
              {isDownloading
                ? t('slmAcq.titleDownloading', 'Descargando IA offline…')
                : t('slmAcq.titleNew', 'IA sin internet en emergencias')}
            </h2>
            <p className="text-[11px] opacity-70 mt-0.5">
              {t('slmAcq.subtitle', 'Recomendado para faena minera / sin señal')}
            </p>
          </div>
        </header>

        {!isDownloading && (
          <>
            <p className="text-sm text-stone-700 dark:text-stone-300 leading-snug mb-3">
              {t(
                'slmAcq.body',
                'Para que el asistente de IA funcione en una emergencia sin señal, necesitamos descargar el modelo una sola vez. Después queda guardado en este dispositivo.',
              )}
            </p>

            <ul
              className="text-xs space-y-1.5 mb-3 rounded-lg border border-stone-500/20 bg-stone-500/5 p-2.5"
              data-testid="slm-acq-stats"
            >
              <li className="flex items-center gap-2">
                <Download
                  className="w-3.5 h-3.5 text-stone-500 shrink-0"
                  aria-hidden="true"
                />
                <span className="opacity-80">
                  {t('slmAcq.sizeLabel', 'Tamaño')}:
                </span>
                <strong
                  data-testid="slm-acq-size"
                  className="ml-auto font-mono"
                >
                  {status.totalMb} MB
                </strong>
              </li>
              <li className="flex items-center gap-2">
                <net.Icon
                  className={`w-3.5 h-3.5 shrink-0 ${net.cls}`}
                  aria-hidden="true"
                />
                <span className="opacity-80">
                  {t('slmAcq.networkLabel', 'Conexión')}:
                </span>
                <strong
                  data-testid="slm-acq-network"
                  className={`ml-auto ${net.cls}`}
                >
                  {net.label}
                </strong>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck
                  className="w-3.5 h-3.5 text-emerald-600 shrink-0"
                  aria-hidden="true"
                />
                <span className="opacity-80">
                  {t('slmAcq.privacyLabel', 'Privacidad')}:
                </span>
                <strong className="ml-auto text-emerald-700 dark:text-emerald-300">
                  {t('slmAcq.privacyValue', 'Todo se procesa en tu dispositivo')}
                </strong>
              </li>
            </ul>

            {net.warn && networkAdvisory === 'cellular' && (
              <div
                data-testid="slm-acq-cellular-warning"
                className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 mb-3 flex items-start gap-2"
              >
                <AlertTriangle
                  className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                  {t(
                    'slmAcq.cellularWarning',
                    `Estás en datos móviles. La descarga de ${status.totalMb} MB puede consumir tu plan. Recomendamos esperar a WiFi.`,
                    { totalMb: status.totalMb } as Record<string, unknown>,
                  )}
                </p>
              </div>
            )}

            {networkAdvisory === 'offline' && (
              <div
                data-testid="slm-acq-offline-warning"
                className="rounded-md border border-rose-500/40 bg-rose-500/5 p-2.5 mb-3 flex items-start gap-2"
              >
                <WifiOff
                  className="w-4 h-4 text-rose-600 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <p className="text-[11px] text-rose-800 dark:text-rose-200 leading-snug">
                  {t(
                    'slmAcq.offlineWarning',
                    'Estás sin conexión. La descarga comenzará automáticamente cuando recuperes red.',
                  )}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onAccept}
                data-testid="slm-acq-accept"
                disabled={networkAdvisory === 'offline'}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-bold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                {t('slmAcq.acceptBtn', 'Descargar ahora')}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onPostpone}
                  data-testid="slm-acq-postpone"
                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-stone-500/30 bg-white/40 dark:bg-stone-800/40 text-xs font-bold hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('slmAcq.postponeBtn', 'Después')}
                </button>
                <button
                  type="button"
                  onClick={onDecline}
                  data-testid="slm-acq-decline"
                  className="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-lg border border-stone-500/30 bg-white/40 dark:bg-stone-800/40 text-xs font-bold text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  {t('slmAcq.declineBtn', 'Solo modo online')}
                </button>
              </div>
            </div>
          </>
        )}

        {isDownloading && (
          <div data-testid="slm-acq-downloading">
            <p className="text-sm text-stone-700 dark:text-stone-300 leading-snug mb-3">
              {t(
                'slmAcq.downloadingBody',
                'Estamos descargando el modelo. Puedes seguir usando la app — esto continúa en segundo plano.',
              )}
            </p>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400">
                {t('slmAcq.progressLabel', 'Progreso')}
              </span>
              <span className="font-mono text-sm font-bold text-teal-700 dark:text-teal-300">
                {progressPct}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden mb-2">
              <div
                data-testid="slm-acq-progress-fill"
                style={{ width: `${progressPct}%` }}
                className="h-full bg-teal-500 transition-all"
              />
            </div>
            {downloadedBytes !== undefined && (
              <p
                data-testid="slm-acq-progress-bytes"
                className="text-[11px] opacity-70 text-center font-mono"
              >
                {downloadedMb} MB / {status.totalMb} MB
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
