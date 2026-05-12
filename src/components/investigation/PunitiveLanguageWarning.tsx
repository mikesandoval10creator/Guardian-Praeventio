// Praeventio Guard — Wire UI #15: <PunitiveLanguageWarning />
//
// Cuando el prevencionista escribe el informe de investigación, este
// componente analiza el texto en tiempo real y advierte si contiene
// lenguaje punitivo, con sugerencias de reformulación sistémica.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { analyzePunitiveLanguage } from '../../services/rootCause/noBlameInvestigation.js';

interface PunitiveLanguageWarningProps {
  text: string;
  onAcknowledge?: () => void;
}

export function PunitiveLanguageWarning({ text, onAcknowledge }: PunitiveLanguageWarningProps) {
  const { t } = useTranslation();
  const report = useMemo(() => analyzePunitiveLanguage(text), [text]);

  if (!report.needsRewrite) {
    return (
      <div
        className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2"
        data-testid="punitive-language-ok"
      >
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          {t('punitive.ok', 'Lenguaje sistémico — sin marcadores punitivos detectados.')}
        </p>
      </div>
    );
  }

  return (
    <aside
      className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3"
      role="alert"
      data-testid="punitive-language-warning"
      aria-label={t('punitive.aria', 'Advertencia de lenguaje punitivo') as string}
    >
      <header className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <h3 className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
          {t('punitive.title', 'Lenguaje punitivo detectado')}
        </h3>
      </header>

      <div className="mb-2">
        <p className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80 mb-1">
          {t('punitive.phrasesLabel', 'Frases marcadas')}
        </p>
        <ul className="text-xs flex flex-wrap gap-1">
          {report.flaggedPhrases.map((p, i) => (
            <li
              key={i}
              className="inline-block px-2 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 font-mono"
            >
              "{p}"
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80 mb-1">
          {t('punitive.suggestionsLabel', 'Sugerencias de reformulación')}
        </p>
        <ul className="text-xs leading-snug space-y-1">
          {report.suggestions.map((s, i) => (
            <li key={i} className="text-amber-800 dark:text-amber-200">
              → {s}
            </li>
          ))}
        </ul>
      </div>

      {onAcknowledge && (
        <button
          type="button"
          onClick={onAcknowledge}
          data-testid="punitive-acknowledge"
          className="mt-3 text-[11px] underline font-semibold text-amber-700 dark:text-amber-300"
        >
          {t('punitive.acknowledge', 'Entendido — reescribiré el texto')}
        </button>
      )}
    </aside>
  );
}
