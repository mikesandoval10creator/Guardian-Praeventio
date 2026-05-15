// Praeventio Guard — Wire UI: <LeadershipTrailCard />
//
// Surface el `summarizeDecisionTrail()` del supervisionDecisionTrail
// service: total decisiones, distribución por kind, top 5 impacto, %
// outcome positivo.
//
// NO castiga. Mide qué decisiones preventivas tienen mayor impacto en
// la reducción real de riesgo. Alineado con doc usuario §276-277.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass, TrendingUp, CheckCircle2 } from 'lucide-react';
import {
  summarizeDecisionTrail,
  type SupervisionDecision,
} from '../../services/leadership/supervisionDecisionTrail.js';

interface LeadershipTrailCardProps {
  decisions: SupervisionDecision[];
}

export function LeadershipTrailCard({ decisions }: LeadershipTrailCardProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeDecisionTrail(decisions), [decisions]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="leadership-trail-card"
      aria-label={t('leadership.aria', 'Historial de decisiones de supervisión') as string}
    >
      <header className="flex items-center gap-2">
        <Compass className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token">
          {t('leadership.title', 'Liderazgo preventivo')}
        </h2>
        <span
          className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums"
          data-testid="leadership-total"
        >
          {summary.total} {t('leadership.decisions', 'decisiones')}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div
          className="bg-surface-elevated rounded p-2"
          data-testid="leadership-with-outcome"
        >
          <p className="text-[10px] uppercase text-secondary-token">
            {t('leadership.withOutcome', 'Con resultado')}
          </p>
          <p className="text-xl font-black tabular-nums text-sky-600">
            {summary.withOutcome}
          </p>
        </div>
        <div
          className="bg-surface-elevated rounded p-2"
          data-testid="leadership-positive-rate"
        >
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" aria-hidden="true" />
            {t('leadership.positiveRate', '% positivo')}
          </p>
          <p className="text-xl font-black tabular-nums text-emerald-600">
            {summary.positiveOutcomeRate}%
          </p>
        </div>
      </div>

      {summary.topImpactDecisions.length > 0 && (
        <div data-testid="leadership-top-impact" className="space-y-1">
          <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-secondary-token">
            <TrendingUp className="w-3 h-3" aria-hidden="true" />
            {t('leadership.topImpact', 'Top 5 impacto preventivo')}
          </h3>
          <ul className="space-y-1">
            {summary.topImpactDecisions.map(({ decision, score }) => (
              <li
                key={decision.id}
                data-testid={`leadership-impact-${decision.id}`}
                className="flex items-start gap-2 bg-surface-elevated rounded p-2 text-[11px]"
              >
                <span className="font-mono text-violet-600 font-bold tabular-nums shrink-0">
                  {score}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-primary-token capitalize truncate">
                    {decision.kind.replace(/_/g, ' ')}
                  </p>
                  <p className="text-secondary-token truncate">{decision.rationale}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.total === 0 && (
        <p
          className="text-[11px] text-secondary-token italic"
          data-testid="leadership-empty"
        >
          {t(
            'leadership.empty',
            'Aún no hay decisiones registradas en este período.',
          )}
        </p>
      )}
    </section>
  );
}
