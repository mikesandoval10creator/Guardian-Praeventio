// Praeventio Guard — Wire UI #41: <FiveSAuditForm />
//
// Formulario interactivo de auditoría 5S. Cada item se puntúa 0/1/2 y
// al terminar se calcula el score por dimensión + overall.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, ClipboardCheck, Save } from 'lucide-react';
import {
  getFiveSChecklist,
  buildFiveSAuditReport,
  type FiveSAuditResponse,
  type FiveSAuditReport,
  type FiveSDimension,
} from '../../services/fiveS/fiveSAudit.js';

interface FiveSAuditFormProps {
  zoneId: string;
  onSubmit: (report: FiveSAuditReport) => Promise<void> | void;
}

const DIM_LABEL: Record<FiveSDimension, string> = {
  seiri: 'Seiri — Clasificar',
  seiton: 'Seiton — Organizar',
  seiso: 'Seiso — Limpiar',
  seiketsu: 'Seiketsu — Estandarizar',
  shitsuke: 'Shitsuke — Disciplinar',
};

const RATING_LABEL: Record<0 | 1 | 2, string> = {
  0: 'No',
  1: 'Parcial',
  2: 'Sí',
};

export function FiveSAuditForm({ zoneId, onSubmit }: FiveSAuditFormProps) {
  const { t } = useTranslation();
  const checklist = getFiveSChecklist();
  const [ratings, setRatings] = useState<Record<string, 0 | 1 | 2>>(() => {
    const initial: Record<string, 0 | 1 | 2> = {};
    for (const item of checklist) initial[item.id] = 0;
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Items agrupados por dimensión
  const byDimension: Record<FiveSDimension, typeof checklist> = {
    seiri: [],
    seiton: [],
    seiso: [],
    seiketsu: [],
    shitsuke: [],
  };
  for (const item of checklist) byDimension[item.dimension].push(item);

  function setRating(itemId: string, rating: 0 | 1 | 2) {
    setRatings((prev) => ({ ...prev, [itemId]: rating }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const responses: FiveSAuditResponse[] = Object.entries(ratings).map(
        ([itemId, rating]) => ({ itemId, rating }),
      );
      const report = buildFiveSAuditReport(zoneId, responses);
      await onSubmit(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="five-s-audit-form"
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      aria-label={t('fiveS.aria', 'Auditoría 5S') as string}
    >
      <header className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('fiveS.title', 'Auditoría 5S')} — {zoneId}
        </h2>
      </header>

      {(Object.keys(byDimension) as FiveSDimension[]).map((dim) => (
        <div key={dim} data-testid={`five-s-dim-${dim}`}>
          <h3 className="text-xs font-bold text-primary-token uppercase mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            {DIM_LABEL[dim]}
          </h3>
          <ul className="space-y-2">
            {byDimension[dim].map((item) => (
              <li key={item.id} data-testid={`five-s-item-${item.id}`}>
                <p className="text-xs text-primary-token leading-snug mb-1">{item.label}</p>
                <div className="inline-flex gap-1 text-[11px]">
                  {[0, 1, 2].map((r) => {
                    const active = ratings[item.id] === r;
                    const colors = {
                      0: active
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                        : 'border-default-token text-secondary-token',
                      1: active
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                        : 'border-default-token text-secondary-token',
                      2: active
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                        : 'border-default-token text-secondary-token',
                    } as Record<0 | 1 | 2, string>;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRating(item.id, r as 0 | 1 | 2)}
                        data-testid={`five-s-rating-${item.id}-${r}`}
                        className={`px-3 py-1 rounded border font-bold ${colors[r as 0 | 1 | 2]}`}
                      >
                        {RATING_LABEL[r as 0 | 1 | 2]}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {error && (
        <p
          role="alert"
          data-testid="five-s-error"
          className="text-xs text-rose-700 dark:text-rose-300 bg-rose-500/10 px-2 py-1 rounded"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        data-testid="five-s-submit"
        className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-50"
      >
        <Save className="w-3 h-3" aria-hidden="true" />
        {submitting
          ? t('fiveS.saving', 'Guardando...')
          : t('fiveS.submit', 'Finalizar auditoría')}
      </button>
    </form>
  );
}
