// Praeventio Guard — Wire UI Sprint 42 F.20: Post-drill result review.
//
// Complementa al DrillsCompliancePanel existente: este componente
// renderiza el análisis de UN simulacro ejecutado — tiempo de
// respuesta, participación, brechas observadas, recomendaciones.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Timer, Users, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  evaluateDrillResult,
  type DrillResult,
  type DrillReadinessReport,
} from '../../services/drillsManager/drillsManager.js';

interface DrillResultReviewCardProps {
  result: DrillResult;
  /** Si se pasa un report pre-computado, se prefiere sobre el cálculo. */
  precomputedReport?: DrillReadinessReport;
}

const LEVEL_TONE = {
  excellent: { bg: 'bg-emerald-500/10', color: 'text-emerald-600', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  good: { bg: 'bg-teal-500/10', color: 'text-teal-600', badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
  needs_improvement: { bg: 'bg-amber-500/10', color: 'text-amber-600', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  critical: { bg: 'bg-rose-500/10', color: 'text-rose-600', badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
} as const;

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function DrillResultReviewCard({
  result,
  precomputedReport,
}: DrillResultReviewCardProps) {
  const { t } = useTranslation();
  const report = useMemo(
    () => precomputedReport ?? evaluateDrillResult(result),
    [result, precomputedReport],
  );
  const tone = LEVEL_TONE[report.level];
  const speedIsBetter = report.speedDeficitPercent < 0;

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${tone.bg}`}
      data-testid={`drill-result-${result.id}`}
      aria-label={t('drillResult.aria', 'Revisión simulacro') as string}
    >
      <header className="flex items-center gap-2">
        {report.level === 'excellent' || report.level === 'good' ? (
          <CheckCircle2 className={`w-5 h-5 ${tone.color}`} aria-hidden="true" />
        ) : (
          <AlertCircle className={`w-5 h-5 ${tone.color}`} aria-hidden="true" />
        )}
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t(`drillResult.kind.${result.drillKind}`, result.drillKind)}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`drill-result-level-${result.id}`}
        >
          {report.level}
        </span>
      </header>

      <div className="text-[10px] text-secondary-token tabular-nums">
        {result.executedAt.slice(0, 16).replace('T', ' ')}
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-surface rounded p-2" data-testid={`drill-result-participation-${result.id}`}>
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <Users className="w-3 h-3" aria-hidden="true" />
            {t('drillResult.participation', 'Participación')}
          </p>
          <p className="text-xl font-black tabular-nums">{report.participationRate}%</p>
          <p className="text-[9px] text-secondary-token">
            {result.participantCount}/{result.expectedCount}
          </p>
        </div>
        <div className="bg-surface rounded p-2" data-testid={`drill-result-speed-${result.id}`}>
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <Timer className="w-3 h-3" aria-hidden="true" />
            {t('drillResult.responseTime', 'Tiempo respuesta')}
          </p>
          <p className="text-xl font-black tabular-nums">
            {formatDuration(result.responseTimeSeconds)}
          </p>
          <p
            className={`text-[9px] font-bold ${speedIsBetter ? 'text-emerald-600' : 'text-rose-600'}`}
          >
            {speedIsBetter ? '↓' : '↑'}
            {Math.abs(report.speedDeficitPercent)}% {t('drillResult.vsBenchmark', 'vs benchmark')}
          </p>
        </div>
      </div>

      {result.requiredExternal && (
        <p
          className="text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded"
          data-testid={`drill-result-external-${result.id}`}
        >
          {t('drillResult.externalNeeded', 'Requirió intervención externa.')}
        </p>
      )}

      {result.observedGaps.length > 0 && (
        <div data-testid={`drill-result-gaps-${result.id}`}>
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('drillResult.observedGaps', 'Brechas observadas')}
          </h3>
          <ul className="space-y-1">
            {result.observedGaps.map((gap, i) => (
              <li
                key={i}
                className="text-[11px] bg-surface-elevated rounded px-2 py-1"
                data-testid={`drill-result-gap-${result.id}-${i}`}
              >
                • {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.recommendations.length > 0 && (
        <div data-testid={`drill-result-recommendations-${result.id}`}>
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('drillResult.recommendations', 'Recomendaciones')}
          </h3>
          <ul className="space-y-1">
            {report.recommendations.map((r, i) => (
              <li
                key={i}
                className="text-[11px] bg-surface-elevated rounded px-2 py-1"
                data-testid={`drill-result-rec-${result.id}-${i}`}
              >
                → {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
