// Praeventio Guard — Wire UI #8a: <SiteBookViewer />
//
// Read-only viewer for the Libro de Obra Digital. Renders entries by
// year + sequence, with badges for kind/status and corrections linked.
//
// Used in: new route `/sitebook/:projectId`.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BookText, Lock, FileEdit, Paperclip } from 'lucide-react';
import type {
  SiteBookEntry,
  SiteBookEntryKind,
  SiteBookEntryStatus,
} from '../../services/siteBook/siteBookService.js';

interface SiteBookViewerProps {
  entries: SiteBookEntry[];
  onEntryClick?: (entry: SiteBookEntry) => void;
}

const KIND_LABEL: Record<SiteBookEntryKind, string> = {
  inspection: 'Inspección',
  incident: 'Incidente',
  near_miss: 'Casi accidente',
  visit: 'Visita',
  change: 'Cambio',
  instruction: 'Instrucción',
  stoppage: 'Paralización',
  resumption: 'Reanudación',
  document_delivery: 'Entrega doc.',
  finding_closure: 'Cierre hallazgo',
  training_event: 'Capacitación',
  observation: 'Observación',
};

const STATUS_CLASS: Record<SiteBookEntryStatus, string> = {
  open: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  signed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  corrected: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export function SiteBookViewer({ entries, onEntryClick }: SiteBookViewerProps) {
  const { t } = useTranslation();

  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) => b.year - a.year || b.sequenceNumber - a.sequenceNumber,
      ),
    [entries],
  );

  if (sorted.length === 0) {
    return (
      <div
        className="rounded-2xl border border-default-token bg-surface p-8 text-center text-secondary-token"
        data-testid="sitebook-viewer-empty"
      >
        <BookText className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
        <p className="text-sm">
          {t('sitebook.empty', 'Sin entradas en el libro todavía.')}
        </p>
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface shadow-mode"
      data-testid="sitebook-viewer"
      aria-label={t('sitebook.aria', 'Libro de Obra Digital') as string}
    >
      <header className="px-4 py-3 border-b border-default-token flex items-center gap-2">
        <BookText className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('sitebook.title', 'Libro de Obra Digital')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token tabular-nums">
          {sorted.length} {t('sitebook.entries', 'entradas')}
        </span>
      </header>

      <ul className="divide-y divide-default-token">
        {sorted.map((entry) => {
          const StatusIcon = entry.status === 'signed' ? Lock : FileEdit;
          const clickable = Boolean(onEntryClick);
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onEntryClick?.(entry)}
                disabled={!clickable}
                data-testid={`sitebook-entry-${entry.folio}`}
                className={`w-full text-left px-4 py-3 ${clickable ? 'hover:bg-surface-elevated cursor-pointer' : 'cursor-default'} transition-colors`}
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs font-bold text-primary-token">
                    {entry.folio}
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-300">
                    {KIND_LABEL[entry.kind]}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${STATUS_CLASS[entry.status]}`}
                  >
                    <StatusIcon className="w-3 h-3" aria-hidden="true" />
                    {entry.status}
                  </span>
                  {entry.evidenceUrls && entry.evidenceUrls.length > 0 && (
                    <span className="text-[10px] text-muted-token inline-flex items-center gap-1">
                      <Paperclip className="w-3 h-3" aria-hidden="true" />
                      {entry.evidenceUrls.length}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-token ml-auto tabular-nums">
                    {entry.occurredAt.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <p className="text-sm text-primary-token leading-snug line-clamp-2">
                  {entry.description}
                </p>
                {entry.correctsEntryFolio && (
                  <p className="text-[10px] mt-1 text-rose-700 dark:text-rose-300">
                    {t('sitebook.corrects', `Corrige: ${entry.correctsEntryFolio}`, {
                      folio: entry.correctsEntryFolio,
                    })}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
