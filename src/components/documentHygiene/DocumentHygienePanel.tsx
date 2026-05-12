// Praeventio Guard — Wire UI #37: <DocumentHygienePanel />
//
// Vista de salud documental con detección de fantasmas, sin uso y
// candidatos a purga.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileX, FileQuestion, Trash2, FileWarning } from 'lucide-react';
import {
  detectUnusedDocuments,
  detectGhostDocuments,
  suggestPurges,
  type DocumentRecord,
} from '../../services/documentHygiene/documentHygieneEngine.js';

interface DocumentHygienePanelProps {
  documents: DocumentRecord[];
  onArchive?: (docId: string) => void;
  onReview?: (docId: string) => void;
}

export function DocumentHygienePanel({
  documents,
  onArchive,
  onReview,
}: DocumentHygienePanelProps) {
  const { t } = useTranslation();
  const unused = useMemo(() => detectUnusedDocuments(documents), [documents]);
  const ghosts = useMemo(() => detectGhostDocuments(documents), [documents]);
  const purges = useMemo(() => suggestPurges(documents), [documents]);

  const totalProblems = unused.length + ghosts.length + purges.length;

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="doc-hygiene-panel"
      aria-label={t('docHygiene.aria', 'Higiene documental') as string}
    >
      <header className="flex items-center gap-2">
        <FileWarning className="w-4 h-4 text-amber-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('docHygiene.title', 'Higiene Documental')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token">
          {totalProblems} {t('docHygiene.problemsLabel', 'problemas')}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded p-2 bg-amber-500/10" data-testid="doc-unused-count">
          <p className="text-xl font-black text-amber-700 dark:text-amber-300 tabular-nums">
            {unused.length}
          </p>
          <p className="text-[9px] uppercase opacity-70">{t('docHygiene.unused', 'Sin uso')}</p>
        </div>
        <div className="rounded p-2 bg-rose-500/10" data-testid="doc-ghost-count">
          <p className="text-xl font-black text-rose-700 dark:text-rose-300 tabular-nums">
            {ghosts.length}
          </p>
          <p className="text-[9px] uppercase opacity-70">{t('docHygiene.ghosts', 'Fantasmas')}</p>
        </div>
        <div className="rounded p-2 bg-orange-500/15" data-testid="doc-purge-count">
          <p className="text-xl font-black text-orange-700 dark:text-orange-300 tabular-nums">
            {purges.length}
          </p>
          <p className="text-[9px] uppercase opacity-70">{t('docHygiene.purge', 'A purgar')}</p>
        </div>
      </div>

      {/* Unused */}
      {unused.length > 0 && (
        <div data-testid="doc-unused-list">
          <h3 className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-300 mb-1">
            {t('docHygiene.unusedTitle', 'Documentos sin uso')}
          </h3>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {unused.slice(0, 5).map((u) => (
              <li
                key={u.documentId}
                data-testid={`doc-unused-${u.documentId}`}
                className="flex items-center gap-2 text-xs p-1.5 rounded bg-amber-500/5"
              >
                <FileQuestion className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate">{u.title}</span>
                <span className="text-[10px] opacity-70 uppercase">{u.suggestedAction}</span>
                {onArchive && u.suggestedAction === 'archive' && (
                  <button
                    type="button"
                    onClick={() => onArchive(u.documentId)}
                    data-testid={`doc-archive-${u.documentId}`}
                    className="text-[10px] font-bold underline"
                  >
                    {t('docHygiene.archive', 'Archivar')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ghosts */}
      {ghosts.length > 0 && (
        <div data-testid="doc-ghost-list">
          <h3 className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1">
            {t('docHygiene.ghostTitle', 'Documentos fantasma')}
          </h3>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {ghosts.slice(0, 5).map((g) => (
              <li
                key={g.documentId}
                data-testid={`doc-ghost-${g.documentId}`}
                className="flex items-center gap-2 text-xs p-1.5 rounded bg-rose-500/5"
              >
                <FileX className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate">{g.title}</span>
                {onReview && (
                  <button
                    type="button"
                    onClick={() => onReview(g.documentId)}
                    data-testid={`doc-review-${g.documentId}`}
                    className="text-[10px] font-bold underline"
                  >
                    {t('docHygiene.review', 'Revisar')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Purges */}
      {purges.length > 0 && (
        <div data-testid="doc-purge-list">
          <h3 className="text-[10px] uppercase font-bold text-orange-700 dark:text-orange-300 mb-1">
            {t('docHygiene.purgeTitle', 'Candidatos a purga')}
          </h3>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {purges.slice(0, 5).map((p) => (
              <li
                key={p.documentId}
                data-testid={`doc-purge-${p.documentId}`}
                className="flex items-center gap-2 text-xs p-1.5 rounded bg-orange-500/5"
              >
                <Trash2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate">{p.title}</span>
                <span className="text-[10px] opacity-70 uppercase">{p.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
