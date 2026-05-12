// Praeventio Guard — Wire UI #51: <PdcaSummaryCard />
//
// Muestra distribución de no-conformidades por fase PDCA + tasa de
// eficacia + reincidencias.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import {
  buildPDCASummary,
  type NonConformity,
  type PDCAPhase,
} from '../../services/pdca/pdcaCycle.js';

interface PdcaSummaryCardProps {
  items: NonConformity[];
}

const PHASE_ORDER: PDCAPhase[] = ['plan', 'do', 'check', 'act'];
const PHASE_COLOR: Record<PDCAPhase, string> = {
  plan: 'bg-sky-500',
  do: 'bg-amber-500',
  check: 'bg-violet-500',
  act: 'bg-emerald-500',
};

export function PdcaSummaryCard({ items }: PdcaSummaryCardProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => buildPDCASummary(items), [items]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="pdca-summary-card"
      aria-label={t('pdca.aria', 'Resumen PDCA') as string}
    >
      <header className="flex items-center gap-2">
        <RefreshCw className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('pdca.title', 'Ciclo PDCA')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token tabular-nums">
          {summary.total} {t('pdca.total', 'NCs')}
        </span>
      </header>

      <div className="grid grid-cols-4 gap-2">
        {PHASE_ORDER.map((phase) => (
          <div
            key={phase}
            data-testid={`pdca-phase-${phase}`}
            className="bg-surface-elevated rounded p-2 text-center"
          >
            <div
              className={`w-6 h-6 mx-auto rounded-full ${PHASE_COLOR[phase]} mb-1`}
              aria-hidden="true"
            />
            <p className="text-[10px] uppercase font-bold">{phase}</p>
            <p className="text-lg font-black tabular-nums">{summary.byPhase[phase]}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center text-xs">
        <span>
          <span className="text-secondary-token">
            {t('pdca.effectiveness', 'Eficacia verificada')}:
          </span>{' '}
          <span
            className="font-black tabular-nums text-emerald-600"
            data-testid="pdca-effectiveness-rate"
          >
            {summary.effectivenessRate}%
          </span>
        </span>
        {summary.reoccurrences > 0 && (
          <span
            className="flex items-center gap-1 text-rose-600 text-[11px] font-bold"
            data-testid="pdca-reoccurrences"
          >
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {summary.reoccurrences} {t('pdca.reoccurrences', 'reincidencias')}
          </span>
        )}
      </div>
    </section>
  );
}
