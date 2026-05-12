// Praeventio Guard — Wire UI #50: <ResidualRiskCard />
//
// Muestra el riesgo residual de un assessment: score inicial,
// reducción por controles, score residual, y si requiere aceptación
// formal.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Stamp } from 'lucide-react';
import {
  computeResidualRisk,
  type RiskAssessment,
  type AppliedControl,
  type RiskLevel,
} from '../../services/residualRisk/residualRiskEngine.js';

interface ResidualRiskCardProps {
  assessment: RiskAssessment;
  controls: AppliedControl[];
  onRequestAcceptance?: (riskId: string) => void;
}

const LEVEL_TONE: Record<RiskLevel, { color: string; bg: string; badge: string }> = {
  low: {
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  medium: {
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  high: {
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  },
  extreme: {
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
};

export function ResidualRiskCard({
  assessment,
  controls,
  onRequestAcceptance,
}: ResidualRiskCardProps) {
  const { t } = useTranslation();
  const report = useMemo(
    () => computeResidualRisk(assessment, controls),
    [assessment, controls],
  );
  const residualTone = LEVEL_TONE[report.residualLevel];
  const initialTone = LEVEL_TONE[report.initialLevel];

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${residualTone.bg}`}
      data-testid={`residual-risk-card-${assessment.riskId}`}
      aria-label={t('residualRisk.aria', 'Riesgo residual') as string}
    >
      <header className="flex items-center gap-2">
        <Activity className={`w-4 h-4 ${residualTone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide truncate">
          {assessment.category}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${residualTone.badge}`}
          data-testid={`residual-level-${assessment.riskId}`}
        >
          {report.residualLevel.toUpperCase()}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface rounded p-2">
          <p className="text-[10px] uppercase text-secondary-token mb-1">
            {t('residualRisk.initial', 'Inicial')}
          </p>
          <p className={`text-xl font-black ${initialTone.color}`}>{report.initialScore}</p>
          <p className="text-[9px] uppercase">{report.initialLevel}</p>
        </div>
        <div className="bg-surface rounded p-2">
          <p className="text-[10px] uppercase text-secondary-token mb-1">
            {t('residualRisk.reduction', 'Reducción')}
          </p>
          <p className="text-xl font-black text-sky-500">−{report.controlReduction}</p>
          <p className="text-[9px] uppercase">
            {controls.length} {t('residualRisk.controls', 'controles')}
          </p>
        </div>
        <div className="bg-surface rounded p-2">
          <p className="text-[10px] uppercase text-secondary-token mb-1">
            {t('residualRisk.residual', 'Residual')}
          </p>
          <p className={`text-xl font-black ${residualTone.color}`}>{report.residualScore}</p>
          <p className="text-[9px] uppercase">{report.residualLevel}</p>
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-secondary-token">
        <span>
          {t('residualRisk.kind', 'Tipo')}:{' '}
          <span className="font-bold uppercase">{assessment.riskKind}</span>
        </span>
        <span>
          {t('residualRisk.nextReview', 'Próxima revisión')}:{' '}
          <span className="font-bold tabular-nums">{report.nextReviewInDays}d</span>
        </span>
      </div>

      {report.requiresFormalAcceptance && (
        <div
          className="flex items-center gap-2 bg-amber-500/10 p-2 rounded text-[11px] text-amber-700 dark:text-amber-300"
          data-testid={`residual-acceptance-${assessment.riskId}`}
        >
          <Stamp className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {t(
              'residualRisk.acceptanceRequired',
              'Riesgo residual alto: requiere aceptación formal documentada',
            )}
          </span>
          {onRequestAcceptance && (
            <button
              type="button"
              onClick={() => onRequestAcceptance(assessment.riskId)}
              data-testid={`residual-acceptance-btn-${assessment.riskId}`}
              className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold hover:bg-amber-600"
            >
              {t('residualRisk.requestSignature', 'Solicitar firma')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
