// Sprint 20 — Bucket Lambda — T-1.5
//
// `<SLMModelPicker>` — comparative selector across the three SLM
// candidates registered in `services/slm/registry.ts`. Each model is
// rendered as a card the operator can pick; the picked model id flows
// out via `onSelect`. The component is a *dumb* picker: it does not
// load, download, or activate a model itself — that is the parent
// screen's responsibility (typically the SLM settings page that wraps
// `<SLMStatusPanel>` next to this).
//
// Visual direction: the cards behave as a radio group (only one can be
// active at a time). Each card carries a category tag — "Recomendado",
// "Ligero (mobile)", "Premium opt-in" — which doubles as the implicit
// taxonomy for the operator. License badges use scaled tokens so a
// premium-licensed model (Gemma) is unmistakably amber-tinted.
//
// Accessibility: rendered as `<fieldset><legend>` so the screen reader
// announces "Seleccionar modelo on-device, group, 3 items". Each card is
// a `<button role="radio">` with `aria-checked` so the radio semantics
// survive the visual treatment.

import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Feather, Crown, ShieldCheck, BadgeCheck } from 'lucide-react';
import { MODEL_REGISTRY, listModelsWithVerifiedHash } from '../../services/slm/registry';
import type { ModelDescriptor } from '../../services/slm/types';

export interface SLMModelPickerProps {
  /**
   * Registry id of the currently selected model. When undefined the
   * picker renders without an active card — useful as a "first-time
   * choice" flow where the operator has not yet committed.
   */
  currentModelId?: string;
  /** Fired when the operator picks a card. Receives the registry id. */
  onSelect: (modelId: string) => void;
}

/**
 * Per-model UX metadata. Lives next to the registry but separate so the
 * registry stays a pure data module — UI labels, taglines, and icons are
 * picker-shaped concerns, not registry-shaped concerns.
 */
interface ModelTag {
  label: string;
  blurb: string;
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** Tone class for the category chip on the card header. */
  tagTone: string;
}

const MODEL_TAGS: Record<string, ModelTag> = {
  'phi-3-mini': {
    label: 'Recomendado',
    blurb:
      'Equilibrio óptimo entre calidad y peso. Permisivo (MIT). Acelerado por WebGPU cuando está disponible.',
    Icon: Sparkles,
    tagTone:
      'bg-teal-500 text-white dark:bg-gold-500 dark:text-petroleum-900',
  },
  'qwen-2.5-0.5b': {
    label: 'Ligero (mobile)',
    blurb:
      'Footprint mínimo para dispositivos con almacenamiento ajustado. Apache-2.0. Corre en wasm-simd universal.',
    Icon: Feather,
    tagTone:
      'bg-teal-100 text-teal-800 dark:bg-petroleum-700 dark:text-gold-200',
  },
  'gemma-2-2b': {
    label: 'Premium opt-in',
    blurb:
      'Mayor calidad de generación. Gemma Terms of Use — requiere aceptación explícita antes de descargar.',
    Icon: Crown,
    tagTone:
      'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  },
};

/** License chip color, mirrored from `SLMStatusPanel` for visual rhyme. */
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

/** Pretty-print bytes (mirrors `SLMStatusPanel.humanBytes`). */
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function SLMModelPicker({
  currentModelId,
  onSelect,
}: SLMModelPickerProps): React.ReactElement {
  // §2.9 defense-in-depth: in production, only offer models with a pinned
  // SHA-256. A gated/unverified model (e.g. Gemma, hash not yet published)
  // fail-closes at load time anyway (slmRuntime.assertVerifiableInProduction),
  // so offering an unpickable card is just confusing. Dev/staging show all.
  const displayModels = import.meta.env.PROD
    ? listModelsWithVerifiedHash()
    : MODEL_REGISTRY;
  return (
    <fieldset
      data-testid="slm-model-picker"
      className="
        rounded-2xl border border-teal-300/70 dark:border-petroleum-600
        bg-white/70 dark:bg-petroleum-800/60
        backdrop-blur-[2px]
        p-4 sm:p-5
      "
    >
      <legend className="px-2 text-xs uppercase tracking-[0.18em] font-semibold text-teal-700 dark:text-gold-400">
        Seleccionar modelo on-device
      </legend>

      <div className="mt-2 grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {displayModels.map((model) => {
          const tag = MODEL_TAGS[model.id];
          const checked = currentModelId === model.id;

          return (
            <motion.button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={checked}
              data-testid={`slm-model-card-${model.id}`}
              onClick={() => onSelect(model.id)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={`
                group text-left
                relative overflow-hidden
                rounded-xl border
                bg-teal-50 dark:bg-petroleum-700
                border-teal-300 dark:border-petroleum-600
                p-4 sm:p-5
                transition-shadow
                hover:shadow-[0_6px_24px_-12px_rgba(77,182,172,0.45)]
                dark:hover:shadow-[0_6px_24px_-12px_rgba(212,175,55,0.45)]
                focus:outline-none focus:ring-2 focus:ring-teal-400 dark:focus:ring-gold-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-petroleum-800
                ${checked ? 'ring-2 ring-teal-500 dark:ring-gold-500' : ''}
              `}
            >
              {/* Active marker — a small bookmark in the upper-right that
                  appears only when this card is the current selection. */}
              {checked && (
                <span
                  aria-hidden="true"
                  className="absolute top-3 right-3 inline-flex items-center justify-center w-6 h-6 rounded-full bg-teal-500 text-white dark:bg-gold-500 dark:text-petroleum-900"
                >
                  <BadgeCheck className="w-4 h-4" />
                </span>
              )}

              {/* Category tag — one-line keyword for scanning. */}
              {tag && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tag.tagTone}`}
                >
                  <tag.Icon className="w-3 h-3" aria-hidden="true" />
                  {tag.label}
                </span>
              )}

              <h3 className="mt-3 text-sm sm:text-base font-semibold text-teal-900 dark:text-gold-50">
                {model.name}
              </h3>

              {tag?.blurb && (
                <p className="mt-1.5 text-xs leading-relaxed text-teal-800/80 dark:text-gold-100/70">
                  {tag.blurb}
                </p>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div>
                  <dt className="text-[9px] font-sans uppercase tracking-[0.14em] text-teal-700/80 dark:text-gold-400/80">
                    Tamaño
                  </dt>
                  <dd className="text-sm font-semibold text-teal-900 dark:text-gold-100">
                    {humanBytes(model.size)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[9px] font-sans uppercase tracking-[0.14em] text-teal-700/80 dark:text-gold-400/80">
                    Backend
                  </dt>
                  <dd className="text-sm font-semibold text-teal-900 dark:text-gold-100">
                    {model.preferredBackend}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex items-center gap-2">
                <ShieldCheck className="w-3 h-3 text-teal-700 dark:text-gold-400" aria-hidden="true" />
                <span
                  className={`inline-flex items-center rounded border px-1.5 py-[1px] text-[10px] font-semibold tracking-wide ${licenseToneClass(model.license)}`}
                  data-testid={`slm-model-license-${model.id}`}
                >
                  {model.license}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default SLMModelPicker;
