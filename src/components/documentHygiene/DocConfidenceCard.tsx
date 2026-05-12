// Praeventio Guard — Wire UI #46: <DocConfidenceCard />
//
// Muestra el score de confianza documental (0-100) + factores que lo
// componen, para que el prevencionista entienda por qué un documento
// es confiable o no.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck2, FileWarning, FileX2 } from 'lucide-react';
import {
  computeDocumentConfidence,
  type DocumentRecord,
} from '../../services/documentHygiene/documentHygieneEngine.js';

interface DocConfidenceCardProps {
  document: DocumentRecord;
  nowIso?: string;
}

export function DocConfidenceCard({ document, nowIso }: DocConfidenceCardProps) {
  const { t } = useTranslation();
  const conf = useMemo(
    () => computeDocumentConfidence(document, nowIso),
    [document, nowIso],
  );

  const tone =
    conf.level === 'high'
      ? {
          icon: FileCheck2,
          color: 'text-emerald-500',
          bg: 'bg-emerald-500/10',
          badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        }
      : conf.level === 'medium'
        ? {
            icon: FileWarning,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10',
            badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          }
        : {
            icon: FileX2,
            color: 'text-rose-500',
            bg: 'bg-rose-500/10',
            badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
          };

  const Icon = tone.icon;

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`doc-confidence-${document.id}`}
      aria-label={t('docHygiene.aria', 'Confianza documental') as string}
    >
      <header className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token truncate" title={document.title}>
          {document.title}
        </h2>
        <span
          className={`ml-auto inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`doc-confidence-level-${document.id}`}
        >
          {conf.level.toUpperCase()}
        </span>
      </header>

      <div className="flex items-baseline gap-2">
        <p
          className="text-2xl font-black tabular-nums"
          data-testid={`doc-confidence-score-${document.id}`}
        >
          {conf.score}
        </p>
        <p className="text-xs text-secondary-token">
          / 100 {t('docHygiene.scoreLabel', 'puntos de confianza')}
        </p>
      </div>

      <div className={`rounded-lg ${tone.bg} p-2`}>
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
          {t('docHygiene.factorsTitle', 'Factores')}
        </h3>
        <ul className="space-y-1" data-testid={`doc-confidence-factors-${document.id}`}>
          {conf.factors.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-[11px]"
              data-testid={`doc-confidence-factor-${document.id}-${i}`}
            >
              <span className="flex-1 truncate">{f.factor}</span>
              <span
                className={`tabular-nums font-bold ${
                  f.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {f.delta >= 0 ? `+${f.delta}` : f.delta}
              </span>
            </li>
          ))}
          {conf.factors.length === 0 && (
            <li className="text-[11px] text-secondary-token italic">
              {t('docHygiene.noFactors', 'Sin factores positivos ni negativos detectados.')}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
