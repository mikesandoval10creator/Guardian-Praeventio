// Praeventio Guard — Wire UI #75: <Iso45001Catalog />
//
// Catálogo de 10 controles ISO 45001:2018 baseline con referencia a
// cláusula. Clicking a control opens the Iso45001DetailDrawer (F2 B1).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookCheck } from 'lucide-react';
import { ISO_45001_CONTROLS } from '../../services/regulatory/iso45001.js';
import { Iso45001DetailDrawer } from './Iso45001DetailDrawer';

interface Iso45001CatalogProps {
  /** Set de IDs cubiertos por el SGSST de la empresa para marcar checked. */
  coveredControlIds?: Set<string>;
  onControlClick?: (controlId: string) => void;
}

export function Iso45001Catalog({
  coveredControlIds,
  onControlClick,
}: Iso45001CatalogProps) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  const coverage = coveredControlIds
    ? Math.round((coveredControlIds.size / ISO_45001_CONTROLS.length) * 100)
    : null;

  const handleClick = (id: string) => {
    setOpenId(id);
    onControlClick?.(id);
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="iso45001-catalog"
      aria-label={t('iso45001.aria', 'Catálogo ISO 45001') as string}
    >
      <header className="flex items-center gap-2">
        <BookCheck className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          ISO 45001:2018
        </h2>
        {coverage !== null && (
          <span
            className="ml-auto text-xs uppercase font-bold tabular-nums"
            data-testid="iso45001-coverage"
          >
            {coverage}% {t('iso45001.coverage', 'cobertura')}
          </span>
        )}
      </header>

      <ul className="space-y-1" data-testid="iso45001-list">
        {ISO_45001_CONTROLS.map((c) => {
          const covered = coveredControlIds?.has(c.id);
          return (
            <li
              key={c.id}
              data-testid={`iso45001-control-${c.id}`}
              className={`flex items-center gap-2 p-2 rounded ${
                covered ? 'bg-emerald-500/10' : 'bg-surface-elevated'
              }`}
            >
              <button
                type="button"
                onClick={() => handleClick(c.id)}
                className="flex-1 text-left min-w-0"
                data-testid={`iso45001-btn-${c.id}`}
              >
                <p className="text-xs uppercase text-secondary-token font-bold">
                  §{c.iso45001Clause}
                </p>
                <p className="text-xs truncate">{c.title}</p>
              </button>
              {covered && (
                <span
                  className="text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                  data-testid={`iso45001-covered-${c.id}`}
                >
                  ✓
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <Iso45001DetailDrawer controlId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
