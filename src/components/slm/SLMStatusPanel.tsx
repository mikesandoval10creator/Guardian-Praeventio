// Sprint 20 — Bucket Lambda — T-1.5
//
// `<SLMStatusPanel>` is the operator-facing dashboard for the on-device
// Small Language Model. Reads from the SLM registry + IndexedDB cache to
// surface, in one frame:
//
//   • which model is currently active (name, license, footprint),
//   • how much device storage that model is occupying,
//   • the current download / readiness state,
//   • a single primary action ("Descargar" / "Cambiar modelo" / "Reintentar").
//
// Aesthetic direction: editorial / scientific-instrumentation. Hairline
// rules, small-caps metadata labels, monospaced numerics for the storage
// readout. No hex hardcoded — every color derives from project tokens
// (teal/petroleum/gold scales declared in `src/index.css`). The panel is
// single-column on mobile (stack of metadata blocks) and a 2-column grid
// on desktop (metadata left, action surface right).
//
// What this component deliberately does NOT do:
//   • It does not download anything. The button fires `onDownload` (or
//     `onChangeModel`) so the parent screen owns the side effect.
//   • It does not own the registry. `SLMModelPicker` is responsible for
//     letting the operator pick between models. This panel reflects the
//     *current* model only.
//
// Accessibility: the whole panel is `role="region"` with a Spanish aria
// label; the live progress text is `aria-live="polite"` so screen readers
// announce download progress without stealing focus.

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CloudDownload, RefreshCw, ShieldCheck, AlertTriangle, Cpu, HardDrive } from 'lucide-react';
import { getDefaultModel, getModelById } from '../../services/slm/registry';
import { getCachedModelBytes } from '../../services/slm/cache/modelCache';
import type { ModelDescriptor } from '../../services/slm/types';

/**
 * Discrete states the panel can be in. We model these explicitly rather
 * than as booleans so the rendering is a single switch — cleaner than
 * three independent booleans that can pretend to be in conflicting
 * states (e.g. `isDownloading=true && error=true`).
 */
export type SLMStatus =
  | { kind: 'idle' }
  | { kind: 'downloading'; pct: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface SLMStatusPanelProps {
  /**
   * Registry id of the model the panel should describe. Falls back to the
   * registry default (`phi-3-mini`) when omitted, so the panel can render
   * usefully on first launch before any user choice.
   */
  modelId?: string;
  /** Current model lifecycle state. Defaults to `idle`. */
  status?: SLMStatus;
  /**
   * Fired when the operator presses the primary action while the model is
   * not yet cached. Optional — if omitted the button is disabled.
   */
  onDownload?: (modelId: string) => void;
  /**
   * Fired when the operator presses the secondary action ("Cambiar
   * modelo"). Optional — typically wired to a parent that swaps in the
   * `<SLMModelPicker>`.
   */
  onChangeModel?: () => void;
}

/** Format bytes as a human-readable size with a single decimal. */
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/** Pretty label for a license tag — surfaces the license risk visually. */
function licenseToneClass(license: ModelDescriptor['license']): string {
  switch (license) {
    case 'MIT':
    case 'Apache-2.0':
      return 'bg-teal-100 text-teal-800 dark:bg-petroleum-700 dark:text-gold-200 border-teal-300 dark:border-gold-600';
    case 'Gemma':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100 border-amber-400 dark:border-amber-500';
    default:
      return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700';
  }
}

/** Map a status to an iconic glyph + accent class for the status pill. */
function statusBadge(status: SLMStatus) {
  switch (status.kind) {
    case 'idle':
      return {
        Icon: CloudDownload,
        label: 'No descargado',
        tone: 'text-teal-700 dark:text-gold-300 bg-teal-50 dark:bg-petroleum-800',
        ring: 'ring-1 ring-teal-300/60 dark:ring-gold-500/30',
      };
    case 'downloading':
      return {
        Icon: RefreshCw,
        label: `Descargando ${Math.round(status.pct)}%`,
        tone: 'text-teal-800 dark:text-gold-200 bg-teal-100 dark:bg-petroleum-700',
        ring: 'ring-1 ring-teal-400 dark:ring-gold-400',
      };
    case 'ready':
      return {
        Icon: ShieldCheck,
        label: 'Listo',
        tone: 'text-teal-900 dark:text-gold-100 bg-teal-200/70 dark:bg-petroleum-600',
        ring: 'ring-1 ring-teal-500 dark:ring-gold-500',
      };
    case 'error':
      return {
        Icon: AlertTriangle,
        label: `Error: ${status.message}`,
        tone: 'text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900',
        ring: 'ring-1 ring-amber-500 dark:ring-amber-400',
      };
  }
}

/**
 * Render the SLM status panel.
 *
 * The panel uses a stable two-region layout (metadata + action surface)
 * even when the action is disabled — collapsing it would shift the page
 * every time the status changed, which is jarring.
 */
export function SLMStatusPanel({
  modelId,
  status = { kind: 'idle' },
  onDownload,
  onChangeModel,
}: SLMStatusPanelProps): React.ReactElement {
  const model: ModelDescriptor =
    (modelId ? getModelById(modelId) : undefined) ?? getDefaultModel();

  // Storage usage — read once and on model switch. We do *not* poll: the
  // cache is invalidated through downloads, which reload the parent.
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCachedModelBytes(model.id)
      .then((bytes) => {
        if (!cancelled) setStorageBytes(bytes);
      })
      .catch(() => {
        if (!cancelled) setStorageBytes(0);
      });
    return () => {
      cancelled = true;
    };
  }, [model.id]);

  const badge = statusBadge(status);
  const isCached = storageBytes !== null && storageBytes > 0;
  const primaryLabel = isCached ? 'Cambiar modelo' : 'Descargar modelo';
  const primaryHandler = isCached ? onChangeModel : onDownload;
  const primaryDisabled = !primaryHandler || status.kind === 'downloading';

  return (
    <section
      role="region"
      aria-label="Estado del modelo SLM offline"
      data-testid="slm-status-panel"
      className="
        relative overflow-hidden
        rounded-2xl
        border border-teal-300/70 dark:border-petroleum-600
        bg-teal-50 dark:bg-petroleum-800
        text-teal-900 dark:text-gold-50
        shadow-sm
      "
    >
      {/* Hairline editorial rule along the top edge — gives the panel a
          documented, instrument-like feel without crowding the content. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-400/70 dark:via-gold-400/60 to-transparent"
      />

      <header className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-teal-700 dark:text-gold-400">
            Modelo on-device
          </p>
          <h2 className="mt-1 text-base sm:text-lg font-semibold text-teal-900 dark:text-gold-50 truncate">
            {model.name}
          </h2>
        </div>

        <span
          className={`
            inline-flex items-center gap-1.5 shrink-0
            rounded-full px-2.5 py-1 text-xs font-medium
            ${badge.tone} ${badge.ring}
          `}
          aria-live="polite"
          data-testid="slm-status-badge"
        >
          <badge.Icon
            className={`w-3.5 h-3.5 ${status.kind === 'downloading' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{badge.label}</span>
        </span>
      </header>

      {/* Metadata + action region — stack on mobile, 2 cols ≥ md. */}
      <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-end">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 font-mono text-[11px]">
          <div>
            <dt className="text-[9px] uppercase tracking-[0.16em] font-sans font-semibold text-teal-700/80 dark:text-gold-400/80 mb-0.5 flex items-center gap-1">
              <HardDrive className="w-3 h-3" aria-hidden="true" /> Tamaño
            </dt>
            <dd className="text-sm font-semibold text-teal-900 dark:text-gold-100">
              {humanBytes(model.size)}
            </dd>
          </div>

          <div>
            <dt className="text-[9px] uppercase tracking-[0.16em] font-sans font-semibold text-teal-700/80 dark:text-gold-400/80 mb-0.5 flex items-center gap-1">
              <Cpu className="w-3 h-3" aria-hidden="true" /> Backend
            </dt>
            <dd className="text-sm font-semibold text-teal-900 dark:text-gold-100">
              {model.preferredBackend}
            </dd>
          </div>

          <div>
            <dt className="text-[9px] uppercase tracking-[0.16em] font-sans font-semibold text-teal-700/80 dark:text-gold-400/80 mb-0.5">
              Licencia
            </dt>
            <dd>
              <span
                className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold tracking-wide ${licenseToneClass(model.license)}`}
                data-testid="slm-status-license"
              >
                {model.license}
              </span>
            </dd>
          </div>

          <div>
            <dt className="text-[9px] uppercase tracking-[0.16em] font-sans font-semibold text-teal-700/80 dark:text-gold-400/80 mb-0.5">
              Almacenamiento
            </dt>
            <dd
              className="text-sm font-semibold text-teal-900 dark:text-gold-100"
              data-testid="slm-status-storage"
            >
              {storageBytes === null ? '—' : humanBytes(storageBytes)}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col items-stretch md:items-end gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            disabled={primaryDisabled}
            onClick={() => {
              if (!primaryHandler) return;
              if (isCached) onChangeModel?.();
              else onDownload?.(model.id);
            }}
            data-testid="slm-status-primary"
            className="
              inline-flex items-center justify-center gap-2
              rounded-full px-4 py-2 text-sm font-semibold tracking-wide
              bg-teal-500 text-white hover:bg-teal-600
              dark:bg-gold-500 dark:text-petroleum-900 dark:hover:bg-gold-400
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
              focus:outline-none focus:ring-2 focus:ring-teal-400 dark:focus:ring-gold-300 focus:ring-offset-2 focus:ring-offset-teal-50 dark:focus:ring-offset-petroleum-800
            "
          >
            {isCached ? <RefreshCw className="w-4 h-4" aria-hidden="true" /> : <CloudDownload className="w-4 h-4" aria-hidden="true" />}
            {primaryLabel}
          </motion.button>

          {status.kind === 'downloading' && (
            <div
              className="w-full md:w-44 h-1.5 rounded-full bg-teal-200 dark:bg-petroleum-700 overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(status.pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progreso de descarga"
            >
              <motion.div
                className="h-full bg-teal-500 dark:bg-gold-400"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, Math.max(0, status.pct))}%` }}
                transition={{ ease: 'easeOut', duration: 0.4 }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default SLMStatusPanel;
