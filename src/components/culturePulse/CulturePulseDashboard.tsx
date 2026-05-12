// Praeventio Guard — Wire UI #18: <CulturePulseDashboard />
//
// Dashboard ejecutivo de cultura preventiva: índice global + drill-down
// por área + alerta de cultura punitiva.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, AlertOctagon } from 'lucide-react';
import {
  computePulseIndex,
  buildAreaPulses,
  type PulseSurveyResponse,
} from '../../services/culturePulse/safetyCulturePulse.js';

interface CulturePulseDashboardProps {
  responses: PulseSurveyResponse[];
  onAreaClick?: (area: string) => void;
}

const LEVEL_CLASS = {
  low: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  fair: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  strong: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/50',
};

export function CulturePulseDashboard({ responses, onAreaClick }: CulturePulseDashboardProps) {
  const { t } = useTranslation();
  const global = useMemo(() => computePulseIndex(responses), [responses]);
  const areas = useMemo(() => buildAreaPulses(responses), [responses]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="culture-pulse-dashboard"
      aria-label={t('culture.aria', 'Pulse de cultura preventiva') as string}
    >
      <header>
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide flex items-center gap-2">
          <Heart className="w-4 h-4 text-rose-500" aria-hidden="true" />
          {t('culture.title', 'Cultura Preventiva')}
        </h2>
      </header>

      {/* Índice global */}
      <div
        className={`rounded-lg border-2 p-3 ${LEVEL_CLASS[global.level]}`}
        data-testid="culture-pulse-global"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase">{t('culture.global', 'Índice global')}</span>
          <span className="text-3xl font-black tabular-nums">{global.cultureIndex}</span>
        </div>
        <p className="text-[11px]">
          {t('culture.responses', `Basado en ${global.totalResponses} respuestas`, {
            n: global.totalResponses,
          }).replace('{{n}}', String(global.totalResponses))}
        </p>
        {global.punitiveCulturedFlagged && (
          <div
            className="mt-2 flex items-center gap-1 text-xs font-bold p-2 rounded bg-rose-500/20"
            data-testid="culture-pulse-punitive-flag"
          >
            <AlertOctagon className="w-4 h-4" aria-hidden="true" />
            {t('culture.punitiveFlag', 'Posible cultura punitiva — escalar gerencia.')}
          </div>
        )}
      </div>

      {/* Drill-down por área */}
      {areas.length > 1 && (
        <div>
          <h3 className="text-xs font-bold text-primary-token uppercase mb-2">
            {t('culture.byArea', 'Por área')}
          </h3>
          <ul className="space-y-1.5">
            {areas.map((a) => (
              <li key={a.area}>
                <button
                  type="button"
                  onClick={() => onAreaClick?.(a.area)}
                  disabled={!onAreaClick}
                  data-testid={`culture-area-${a.area}`}
                  className={`w-full text-left rounded border px-2 py-1.5 flex items-center justify-between ${LEVEL_CLASS[a.index.level]} ${onAreaClick ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}
                >
                  <span className="text-xs font-bold">{a.area}</span>
                  <span className="text-xs font-black tabular-nums">{a.index.cultureIndex}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Breakdown por pregunta */}
      <div>
        <h3 className="text-xs font-bold text-primary-token uppercase mb-2">
          {t('culture.byQuestion', 'Por pregunta')}
        </h3>
        <ul className="space-y-1 text-xs">
          {(Object.keys(global.byQuestion) as Array<keyof typeof global.byQuestion>).map((q) => (
            <li key={q} className="flex items-center justify-between text-secondary-token">
              <span className="capitalize">{q.replace(/_/g, ' ')}</span>
              <span className="font-bold tabular-nums">{global.byQuestion[q].toFixed(1)} / 5</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
