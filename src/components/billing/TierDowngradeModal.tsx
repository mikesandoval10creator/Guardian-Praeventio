import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { TierId } from "../../services/pricing/tiers";
import {
  archiveTierDowngrade,
  exportThenArchiveTierDowngrade,
  loadTierDowngradePreview,
  type TierDowngradeCategory,
  type TierDowngradePreview,
} from "../../services/billing/tierDowngradeClient";

export interface TierDowngradeModalProps {
  fromTier: TierId;
  toTier: TierId;
  toTierLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ExceedingCategory {
  key: TierDowngradeCategory;
  excess: number;
  description: string;
}

export function TierDowngradeModal({
  fromTier,
  toTier,
  toTierLabel,
  onConfirm,
  onCancel,
}: TierDowngradeModalProps): React.ReactElement {
  const [preview, setPreview] = useState<TierDowngradePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCategory, setPendingCategory] =
    useState<TierDowngradeCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshPreview = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadTierDowngradePreview(toTier);
      setPreview(next);
      setError(null);
    } catch {
      setPreview(null);
      setError("tier_downgrade_preview_failed");
    } finally {
      setLoading(false);
    }
  }, [toTier]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const exceeding = useMemo<ExceedingCategory[]>(() => {
    if (!preview) return [];
    const categories: ExceedingCategory[] = [];
    const workers = preview.overages.workers;
    if (workers.count > 0) {
      const faenas = workers.projects.length;
      categories.push({
        key: "workers",
        excess: workers.count,
        description: `${workers.count} trabajadores exceden el límite en ${faenas} ${faenas === 1 ? "faena" : "faenas"} (máximo ${workers.capPerProject} por faena).`,
      });
    }
    const projects = preview.overages.projects;
    if (projects.count > 0) {
      categories.push({
        key: "projects",
        excess: projects.count,
        description: `Tienes ${projects.current} proyectos activos; el tier objetivo permite ${projects.cap}. Sobran ${projects.count}.`,
      });
    }
    return categories;
  }, [preview]);

  const hasOverages = exceeding.length > 0;
  const busy = loading || pendingCategory !== null;

  const runAction = async (
    category: TierDowngradeCategory,
    action: "archive" | "export",
  ): Promise<void> => {
    setPendingCategory(category);
    setError(null);
    setSuccess(null);
    try {
      const result =
        action === "export"
          ? await exportThenArchiveTierDowngrade(category, toTier)
          : await archiveTierDowngrade(category, toTier);
      setSuccess(`${result.archivedCount} registros archivados correctamente.`);
      await refreshPreview();
    } catch {
      setError("tier_downgrade_archive_failed");
    } finally {
      setPendingCategory(null);
    }
  };

  const canConfirm = Boolean(preview) && !busy && !error && !hasOverages;

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
            Bajar de {fromTier} a {toTierLabel ?? toTier}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Praeventio calcula en el servidor qué registros activos exceden la
            capacidad del nuevo tier. Nada se elimina: las acciones solo
            archivan y conservan trazabilidad.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {loading ? (
            <p
              data-testid="tier-downgrade-loading"
              className="text-sm text-zinc-500"
            >
              Calculando excedentes reales…
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="text-sm text-rose-600 dark:text-rose-400"
            >
              No se pudo completar la acción. Revisa tu conexión e
              inténtalo nuevamente.
            </p>
          ) : null}

          {success ? (
            <p
              role="status"
              className="text-sm text-emerald-600 dark:text-emerald-400"
            >
              {success}
            </p>
          ) : null}

          {!loading && preview && !hasOverages ? (
            <p
              data-testid="tier-downgrade-no-overages"
              className="text-sm text-emerald-600 dark:text-emerald-400"
            >
              El uso activo cabe dentro del nuevo tier. Puedes confirmar la
              bajada.
            </p>
          ) : null}

          {!loading
            ? exceeding.map((category) => (
                <div
                  key={category.key}
                  data-testid={`tier-downgrade-category-${category.key}`}
                  className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-4"
                >
                  <p className="text-sm font-semibold">
                    {category.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid={`tier-downgrade-archive-${category.key}`}
                      onClick={() => void runAction(category.key, "archive")}
                      disabled={busy}
                      className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider"
                    >
                      {pendingCategory === category.key
                        ? "Archivando…"
                        : `Archivar más antiguos (${category.excess})`}
                    </button>
                    <button
                      type="button"
                      data-testid={`tier-downgrade-export-${category.key}`}
                      onClick={() => void runAction(category.key, "export")}
                      disabled={busy}
                      className="px-3 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider"
                    >
                      Descargar export + archivar
                    </button>
                  </div>
                </div>
              ))
            : null}
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
          <button
            type="button"
            data-testid="tier-downgrade-cancel"
            onClick={onCancel}
            disabled={pendingCategory !== null}
            className="px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 disabled:opacity-50 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="tier-downgrade-confirm"
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-bold ${
              canConfirm
                ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                : "bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed"
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
