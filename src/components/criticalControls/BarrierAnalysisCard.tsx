// Praeventio Guard — Wire UI #66: <BarrierAnalysisCard />
//
// Análisis de capas/barreras vivas por categoría de riesgo. Flag si
// es barrera única + listado por nivel ISO 45001.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, AlertTriangle } from 'lucide-react';
import {
  buildBarrierAnalysis,
  type BarrierAnalysis,
} from '../../services/criticalControls/controlRobustness.js';
import type {
  CriticalControl,
  ControlLevel,
  ControlValidation,
} from '../../services/criticalControls/criticalControlsLibrary.js';

interface BarrierAnalysisCardProps {
  riskCategory: string;
  catalog: CriticalControl[];
  validations: ControlValidation[];
}

const LEVEL_ORDER: ControlLevel[] = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'epp',
];

const LEVEL_COLOR: Record<ControlLevel, string> = {
  elimination: 'bg-emerald-500',
  substitution: 'bg-teal-500',
  engineering: 'bg-sky-500',
  administrative: 'bg-amber-500',
  epp: 'bg-orange-500',
};

export function BarrierAnalysisCard({
  riskCategory,
  catalog,
  validations,
}: BarrierAnalysisCardProps) {
  const { t } = useTranslation();
  const analysis: BarrierAnalysis = useMemo(
    () => buildBarrierAnalysis(riskCategory, catalog, validations),
    [riskCategory, catalog, validations],
  );

  return (
    <section
      className={`rounded-2xl border p-4 shadow-mode space-y-3 ${
        analysis.isSingleBarrier
          ? 'border-rose-500/30 bg-rose-500/5'
          : 'border-default-token bg-surface'
      }`}
      data-testid={`barrier-card-${riskCategory}`}
      aria-label={t('barriers.aria', 'Análisis de barreras') as string}
    >
      <header className="flex items-center gap-2">
        <Shield
          className={`w-4 h-4 ${
            analysis.isSingleBarrier ? 'text-rose-500' : 'text-sky-500'
          }`}
          aria-hidden="true"
        />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {riskCategory}
        </h2>
        <span
          className="ml-auto text-[10px] uppercase font-bold tabular-nums"
          data-testid={`barrier-count-${riskCategory}`}
        >
          {analysis.barrierCount} {t('barriers.layers', 'capas vivas')}
        </span>
      </header>

      {analysis.isSingleBarrier && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid={`barrier-single-${riskCategory}`}
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'barriers.singleWarning',
              'BARRERA ÚNICA: si esta capa falla, el riesgo queda sin contención. Agrega al menos una capa más.',
            )}
          </span>
        </div>
      )}

      <div data-testid={`barrier-layers-${riskCategory}`}>
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
          {t('barriers.byLevel', 'Por nivel ISO 45001')}
        </h3>
        <div className="space-y-1">
          {LEVEL_ORDER.map((lvl) => {
            const count = analysis.layersByLevel[lvl];
            const max = Math.max(1, ...Object.values(analysis.layersByLevel));
            const pct = (count / max) * 100;
            return (
              <div key={lvl} data-testid={`barrier-level-${riskCategory}-${lvl}`}>
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="uppercase font-bold">{lvl}</span>
                  <span className="tabular-nums">{count}</span>
                </div>
                <div className="h-1 bg-surface-elevated rounded overflow-hidden">
                  <div className={`h-full ${LEVEL_COLOR[lvl]}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {analysis.liveBarrierLabels.length > 0 && (
        <details data-testid={`barrier-labels-${riskCategory}`}>
          <summary className="text-[10px] uppercase font-bold text-secondary-token cursor-pointer">
            {t('barriers.liveLabels', 'Barreras vivas')} ({analysis.liveBarrierLabels.length})
          </summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {analysis.liveBarrierLabels.map((label, i) => (
              <li key={i} className="text-[11px] list-disc">
                {label}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
