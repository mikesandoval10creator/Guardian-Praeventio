// Sprint 28 H25 — Tier downgrade flow UI.
//
// `calculateMonthlyCost` (services/pricing/tiers.ts) THROWS for premium
// tiers and `gratis` when usage > capacity. Before Sprint 28 we surfaced
// that as an opaque error in the toast — the user had to figure out
// what to archive on their own. This modal closes that UX gap:
//
//   1. Surfaces which entity categories exceed the target tier capacity
//      (e.g. "23 proyectos vs. 5 permitidos").
//   2. Offers two actions per category — archive the oldest items, or
//      download an export before archiving.
//
// The actual archive/export logic lives in a follow-up sprint; this
// component only emits a `tier-downgrade-archive-requested`
// CustomEvent the rest of the app can subscribe to. Keeps the PR small
// and the component pure (no imports from the archive service yet).

import React from 'react';
import type { TierId } from '../../services/pricing/tiers';

export interface TierDowngradeUsage {
  /** Total workers currently assigned across all of the org's projects. */
  workers: number;
  /** Total projects the org owns (active + archived). */
  projects: number;
  /**
   * Sprint 31 OO — Country-specific jurisdictions currently active for
   * the tenant (ISO 45001 excluded). When downgrading from
   * `global-titanio` to a single-jurisdicción tier, we must surface
   * which extra jurisdictions will be deactivated.
   */
  jurisdictions?: string[];
}

export interface TierDowngradeCapacity {
  /** Worker cap of the target (lower) tier. */
  workers: number;
  /** Project cap of the target (lower) tier. */
  projects: number;
  /**
   * Sprint 31 OO — Max country-specific jurisdictions the target tier
   * supports (ISO 45001 excluded). 1 for nacional tiers, Infinity for
   * `global-titanio`.
   */
  jurisdictions?: number;
}

export interface TierDowngradeArchiveRequest {
  category: 'workers' | 'projects' | 'jurisdictions';
  action: 'archive-oldest' | 'export-then-archive';
  fromTier: TierId;
  toTier: TierId;
  /** Number of entities that must be archived to reach target capacity. */
  excess: number;
  /**
   * Sprint 31 OO — When `category === 'jurisdictions'` this lists the
   * jurisdiction codes that will be deactivated on downgrade.
   */
  jurisdictionsToDeactivate?: string[];
}

export interface TierDowngradeModalProps {
  fromTier: TierId;
  toTier: TierId;
  /** Display label for the destination tier (e.g. "Comité Paritario"). */
  toTierLabel?: string;
  currentUsage: TierDowngradeUsage;
  targetCapacity: TierDowngradeCapacity;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ExceedingCategory {
  key: 'workers' | 'projects' | 'jurisdictions';
  label: string;
  current: number;
  cap: number;
  excess: number;
  /** Sprint 31 OO — concrete list (only set for jurisdictions). */
  itemsToDeactivate?: string[];
}

function buildExceedingCategories(
  usage: TierDowngradeUsage,
  capacity: TierDowngradeCapacity,
): ExceedingCategory[] {
  const out: ExceedingCategory[] = [];
  if (usage.workers > capacity.workers) {
    out.push({
      key: 'workers',
      label: 'trabajadores',
      current: usage.workers,
      cap: capacity.workers,
      excess: usage.workers - capacity.workers,
    });
  }
  if (usage.projects > capacity.projects) {
    out.push({
      key: 'projects',
      label: 'proyectos',
      current: usage.projects,
      cap: capacity.projects,
      excess: usage.projects - capacity.projects,
    });
  }
  // Sprint 31 OO — jurisdiction overage on downgrade out of Global Titanio.
  const jurisCap = capacity.jurisdictions;
  const jurisList = usage.jurisdictions ?? [];
  if (typeof jurisCap === 'number' && jurisList.length > jurisCap) {
    const cap = Number.isFinite(jurisCap) ? jurisCap : jurisList.length;
    const excess = jurisList.length - cap;
    // The first `cap` entries are kept (assumed primary/native first);
    // everything else gets deactivated. Caller controls ordering.
    const itemsToDeactivate = jurisList.slice(cap);
    out.push({
      key: 'jurisdictions',
      label: 'jurisdicciones',
      current: jurisList.length,
      cap,
      excess,
      itemsToDeactivate,
    });
  }
  return out;
}

/**
 * Emits the cross-component event so the app shell (or a future
 * archive service) can react. We use `CustomEvent` rather than a
 * context callback because the consumer (archive service) will be
 * wired by a separate Sprint — this keeps the modal isolated.
 */
function emitArchiveRequested(detail: TierDowngradeArchiveRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<TierDowngradeArchiveRequest>(
      'tier-downgrade-archive-requested',
      { detail },
    ),
  );
}

export function TierDowngradeModal({
  fromTier,
  toTier,
  toTierLabel,
  currentUsage,
  targetCapacity,
  onConfirm,
  onCancel,
}: TierDowngradeModalProps): React.ReactElement {
  const exceeding = buildExceedingCategories(currentUsage, targetCapacity);
  const hasOverages = exceeding.length > 0;

  const handleArchiveOldest = (cat: ExceedingCategory): void => {
    // TODO(sprint-29): wire to the archive service. For now we only
    // emit the intent so the rest of the app (toast, audit log) can
    // observe it and the test can assert on it.
    emitArchiveRequested({
      category: cat.key,
      action: 'archive-oldest',
      fromTier,
      toTier,
      excess: cat.excess,
      jurisdictionsToDeactivate: cat.itemsToDeactivate,
    });
  };

  const handleExportThenArchive = (cat: ExceedingCategory): void => {
    // TODO(sprint-29): wire export pipeline (CSV / PDF) before archive.
    emitArchiveRequested({
      category: cat.key,
      action: 'export-then-archive',
      fromTier,
      toTier,
      excess: cat.excess,
      jurisdictionsToDeactivate: cat.itemsToDeactivate,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tier-downgrade-modal-title"
      data-testid="tier-downgrade-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-zinc-200 dark:border-zinc-800">
          <h2
            id="tier-downgrade-modal-title"
            className="text-xl font-black uppercase tracking-widest"
          >
            Bajar a tier {toTierLabel ?? toTier}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Antes de cambiar de plan revisa qué entidades exceden la capacidad
            del nuevo tier. Las que sobren deberán archivarse para completar el
            cambio.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!hasOverages ? (
            <p
              data-testid="tier-downgrade-no-overages"
              className="text-sm text-emerald-600 dark:text-emerald-400"
            >
              Tu uso actual cabe dentro del nuevo tier. Puedes confirmar el
              cambio sin archivar nada.
            </p>
          ) : (
            exceeding.map((cat) => (
              <div
                key={cat.key}
                data-testid={`tier-downgrade-category-${cat.key}`}
                className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4"
              >
                <p className="text-sm font-semibold">
                  Tienes {cat.current} {cat.label} pero el tier objetivo permite{' '}
                  {cat.cap}. Sobran {cat.excess}.
                </p>
                {cat.key === 'jurisdictions' && cat.itemsToDeactivate?.length ? (
                  <ul
                    data-testid="tier-downgrade-jurisdictions-list"
                    className="mt-2 flex flex-wrap gap-1.5"
                  >
                    {cat.itemsToDeactivate.map((j) => (
                      <li
                        key={j}
                        className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 text-[11px] font-semibold uppercase tracking-wider"
                      >
                        {j}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid={`tier-downgrade-archive-${cat.key}`}
                    onClick={() => handleArchiveOldest(cat)}
                    className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold uppercase tracking-wider"
                  >
                    {cat.key === 'jurisdictions'
                      ? `Archivar data por jurisdicción (${cat.excess})`
                      : `Archivar más antiguos (${cat.excess})`}
                  </button>
                  <button
                    type="button"
                    data-testid={`tier-downgrade-export-${cat.key}`}
                    onClick={() => handleExportThenArchive(cat)}
                    className="px-3 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 text-white text-xs font-bold uppercase tracking-wider"
                  >
                    Descargar export + archivar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
          <button
            type="button"
            data-testid="tier-downgrade-cancel"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="tier-downgrade-confirm"
            onClick={onConfirm}
            disabled={hasOverages}
            className={`px-4 py-2 rounded-lg text-sm font-bold ${
              hasOverages
                ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
          >
            Confirmar bajada
          </button>
        </div>
      </div>
    </div>
  );
}

export default TierDowngradeModal;
