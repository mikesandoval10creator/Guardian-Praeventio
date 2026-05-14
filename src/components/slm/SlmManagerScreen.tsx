// Praeventio Guard — Sprint 56 (stream-slm-shell).
//
// `<SlmManagerScreen />` — pantalla "Asistente IA" donde el usuario
// administra TODO lo relacionado con su modelo offline sin salir de la
// app. Reemplaza cualquier instrucción de "abrir HuggingFace en el
// navegador" — los enlaces externos están explícitamente prohibidos.
//
// Capacidades:
//   - Ver qué modelo tiene descargado (id, nombre, licencia, tamaño).
//   - Ver progreso si una descarga está activa o pausada.
//   - Cambiar de modelo (Qwen vs Phi-3) en el listado, si el modelo
//     destino tiene `expectedSha256` (no gated). El cambio dispara un
//     `accept()` para ese modelo nuevo; el modelo antiguo queda en
//     caché por si el usuario lo quiere de vuelta.
//   - Borrar el modelo descargado (libera espacio).
//   - Reintentar / pausar / reanudar (delega al hook).
//
// La pantalla NO renderiza enlaces externos (sin <a href> a HF). El
// único "viaje" del usuario es dentro del shell.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cpu,
  Download,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  HardDrive,
} from 'lucide-react';

import { useSlmAcquisition } from '../../hooks/useSlmAcquisition';
import { MODEL_REGISTRY } from '../../services/slm/registry';
import {
  formatBytesHuman,
  type AcquisitionStatus,
} from '../../services/slm/slmAcquisitionService';
import { deleteCachedModel } from '../../services/slm/cache/modelCache';
import type { ModelDescriptor } from '../../services/slm/types';

export interface SlmManagerScreenProps {
  /**
   * El user-tier determina qué modelos están seleccionables. Si se
   * omite, todos los modelos no-gated están disponibles.
   */
  allowedModelIds?: readonly string[];
}

function modelIsSelectable(
  m: ModelDescriptor,
  allowed?: readonly string[],
): boolean {
  if (m.gated) return false;
  if (!allowed) return true;
  return allowed.includes(m.id);
}

export function SlmManagerScreen({ allowedModelIds }: SlmManagerScreenProps) {
  const { t } = useTranslation();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const acquisition = useSlmAcquisition({
    modelId: selectedModelId ?? undefined,
  });
  const {
    status,
    networkAdvisory,
    downloadProgress,
    downloadedBytes,
    downloadPhase,
    error,
    accept,
    pause,
    resume,
    retry,
    refresh,
  } = acquisition;

  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  useEffect(() => {
    setDeleteMsg(null);
  }, [selectedModelId]);

  const onDelete = useCallback(async () => {
    if (!status) return;
    setDeleting(true);
    setDeleteMsg(null);
    try {
      await deleteCachedModel(status.modelId);
      setDeleteMsg(t('slmManager.deleteOk', 'Modelo eliminado del dispositivo') as string);
      await refresh();
    } catch (e) {
      setDeleteMsg(
        t('slmManager.deleteFail', 'No se pudo eliminar el modelo') as string,
      );
    } finally {
      setDeleting(false);
    }
  }, [refresh, status, t]);

  return (
    <section
      data-testid="slm-manager-screen"
      aria-labelledby="slm-mgr-title"
      className="p-4 space-y-4"
    >
      <header className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full bg-teal-500/15 flex items-center justify-center">
          <Cpu className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <h2
            id="slm-mgr-title"
            className="text-base font-black text-stone-900 dark:text-stone-100"
          >
            {t('slmManager.title', 'Asistente IA offline')}
          </h2>
          <p className="text-[11px] opacity-70 mt-0.5">
            {t(
              'slmManager.subtitle',
              'Administra qué modelo se ejecuta en tu dispositivo. Todo dentro de la app.',
            )}
          </p>
        </div>
      </header>

      {status && (
        <article
          data-testid="slm-manager-current"
          className="rounded-xl border border-stone-500/20 bg-stone-500/5 p-3"
        >
          <h3 className="text-[11px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-2">
            {t('slmManager.currentLabel', 'Modelo activo')}
          </h3>
          <CurrentModelSummary status={status} t={t} />

          {(downloadPhase === 'active' ||
            downloadPhase === 'retrying' ||
            downloadPhase === 'paused' ||
            downloadPhase === 'failed') && (
            <div data-testid="slm-manager-progress" className="mt-3">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[10px] uppercase font-bold opacity-70">
                  {t('slmManager.progressLabel', 'Progreso')}
                </span>
                <span className="font-mono text-xs">
                  {formatBytesHuman(downloadedBytes)} / {formatBytesHuman(status.totalBytes)}{' '}
                  ({Math.round((downloadProgress ?? 0) * 100)}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-stone-300/40 dark:bg-stone-700/40 overflow-hidden">
                <div
                  data-testid="slm-manager-progress-fill"
                  style={{ width: `${Math.round((downloadProgress ?? 0) * 100)}%` }}
                  className={`h-full transition-all ${
                    downloadPhase === 'failed'
                      ? 'bg-rose-500'
                      : downloadPhase === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-teal-500'
                  }`}
                />
              </div>
              {error && (
                <p
                  data-testid="slm-manager-error"
                  className="mt-1 text-[10px] text-rose-700 dark:text-rose-300"
                >
                  {error}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                {(downloadPhase === 'active' || downloadPhase === 'retrying') && (
                  <button
                    type="button"
                    onClick={pause}
                    data-testid="slm-manager-pause"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-500/30 text-[10px] font-bold"
                  >
                    <Pause className="w-3 h-3" aria-hidden="true" />
                    {t('slmManager.pause', 'Pausar')}
                  </button>
                )}
                {downloadPhase === 'paused' && (
                  <button
                    type="button"
                    onClick={() => {
                      void resume();
                    }}
                    data-testid="slm-manager-resume"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-teal-600 text-white text-[10px] font-bold"
                  >
                    <Play className="w-3 h-3" aria-hidden="true" />
                    {t('slmManager.resume', 'Reanudar')}
                  </button>
                )}
                {downloadPhase === 'failed' && (
                  <button
                    type="button"
                    onClick={() => {
                      void retry();
                    }}
                    data-testid="slm-manager-retry"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-teal-600 text-white text-[10px] font-bold"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                    {t('slmManager.retry', 'Reintentar')}
                  </button>
                )}
              </div>
            </div>
          )}

          {status.state === 'ready' && status.cachedBytes > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void onDelete();
                }}
                data-testid="slm-manager-delete"
                disabled={deleting}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-rose-500/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold hover:bg-rose-500/10 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                {t('slmManager.deleteBtn', 'Eliminar del dispositivo')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void accept();
                }}
                data-testid="slm-manager-redownload"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-500/30 text-[10px] font-bold"
              >
                <Download className="w-3 h-3" aria-hidden="true" />
                {t('slmManager.redownloadBtn', 'Volver a descargar')}
              </button>
              {deleteMsg && (
                <span
                  data-testid="slm-manager-delete-msg"
                  className="text-[10px] opacity-70"
                >
                  {deleteMsg}
                </span>
              )}
            </div>
          )}

          {status.state === 'needs_prompt' &&
            downloadPhase !== 'active' &&
            downloadPhase !== 'retrying' &&
            downloadPhase !== 'paused' &&
            downloadPhase !== 'failed' && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    void accept();
                  }}
                  data-testid="slm-manager-start"
                  disabled={networkAdvisory === 'offline'}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-bold disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('slmManager.startBtn', 'Descargar ahora')}
                </button>
              </div>
            )}
        </article>
      )}

      <article
        data-testid="slm-manager-models"
        className="rounded-xl border border-stone-500/20 bg-white/40 dark:bg-stone-800/40 p-3"
      >
        <h3 className="text-[11px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-2">
          {t('slmManager.availableLabel', 'Modelos disponibles')}
        </h3>
        <ul className="space-y-2">
          {MODEL_REGISTRY.map((m) => {
            const selectable = modelIsSelectable(m, allowedModelIds);
            const isActive = status?.modelId === m.id;
            const total = (m.companionFiles ?? []).reduce(
              (s, c) => s + c.size,
              m.size,
            );
            return (
              <li
                key={m.id}
                data-testid={`slm-manager-model-${m.id}`}
                className={`flex items-start gap-2 p-2 rounded-md border ${
                  isActive
                    ? 'border-teal-500/50 bg-teal-500/5'
                    : 'border-stone-500/20'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-stone-900 dark:text-stone-100 truncate">
                    {m.name}
                  </p>
                  <p className="text-[10px] opacity-70 font-mono">
                    {formatBytesHuman(total)} · {m.license}
                    {m.gated && (
                      <span className="ml-1 text-amber-700 dark:text-amber-300">
                        · {t('slmManager.gated', 'restringido')}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedModelId(m.id);
                  }}
                  disabled={!selectable || isActive}
                  data-testid={`slm-manager-select-${m.id}`}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border border-teal-500/40 text-teal-700 dark:text-teal-300 hover:bg-teal-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isActive
                    ? t('slmManager.active', 'En uso')
                    : t('slmManager.select', 'Seleccionar')}
                </button>
              </li>
            );
          })}
        </ul>
      </article>

      <p
        data-testid="slm-manager-privacy"
        className="text-[10px] opacity-60 flex items-center gap-1"
      >
        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
        {t(
          'slmManager.privacyNote',
          'Todo se procesa en este dispositivo. La app no abre páginas externas para descargar.',
        )}
      </p>
    </section>
  );
}

function CurrentModelSummary({
  status,
  t,
}: {
  status: AcquisitionStatus;
  t: (k: string, fb: string) => string;
}) {
  const stateMeta: Record<
    AcquisitionStatus['state'],
    { Icon: typeof CheckCircle2; label: string; cls: string }
  > = {
    ready: {
      Icon: CheckCircle2,
      label: t('slmManager.state.ready', 'Listo'),
      cls: 'text-emerald-700 dark:text-emerald-300',
    },
    needs_prompt: {
      Icon: AlertTriangle,
      label: t('slmManager.state.needsPrompt', 'Falta descargar'),
      cls: 'text-amber-700 dark:text-amber-300',
    },
    postponed: {
      Icon: AlertTriangle,
      label: t('slmManager.state.postponed', 'Pospuesto'),
      cls: 'text-amber-700 dark:text-amber-300',
    },
    declined: {
      Icon: AlertTriangle,
      label: t('slmManager.state.declined', 'Rechazado por el usuario'),
      cls: 'text-stone-600 dark:text-stone-400',
    },
    downloading: {
      Icon: Download,
      label: t('slmManager.state.downloading', 'Descargando'),
      cls: 'text-teal-700 dark:text-teal-300',
    },
  };
  const meta = stateMeta[status.state];
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5">
        <meta.Icon className={`w-3.5 h-3.5 ${meta.cls}`} aria-hidden="true" />
        <strong
          data-testid="slm-manager-current-state"
          className={`text-xs font-bold ${meta.cls}`}
        >
          {meta.label}
        </strong>
        <span className="text-[11px] opacity-70 ml-1">
          {status.modelId}
        </span>
      </p>
      <p className="text-[11px] opacity-70 flex items-center gap-1">
        <HardDrive className="w-3 h-3" aria-hidden="true" />
        {formatBytesHuman(status.totalBytes)}
      </p>
    </div>
  );
}
