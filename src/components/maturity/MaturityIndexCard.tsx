// Praeventio Guard — Sprint 41 F.26: <MaturityIndexCard />
//
// Visualiza el reporte de PreventionMaturityIndex:
//   - Gauge del nivel (1..5)
//   - Bradley Curve diagram (5 estaciones, la actual resaltada)
//   - Sub-scores por categoría
//   - 3 next steps visibles

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  MaturityReport,
  MaturityRecommendation,
  MaturityCategory,
  MaturityLevelNumber,
} from '../../services/maturity/preventionMaturityIndex.js';

interface MaturityIndexCardProps {
  report: MaturityReport;
  recommendations: MaturityRecommendation[];
}

const LEVEL_LABELS: Record<MaturityLevelNumber, string> = {
  1: 'Reactivo',
  2: 'Cumplimiento',
  3: 'Proactivo',
  4: 'Sistémico',
  5: 'Autónomo',
};

const LEVEL_COLOR: Record<MaturityLevelNumber, string> = {
  1: 'bg-rose-500/80 text-white',
  2: 'bg-amber-500/80 text-white',
  3: 'bg-sky-500/80 text-white',
  4: 'bg-teal-500/80 text-white',
  5: 'bg-emerald-500/80 text-white',
};

const CATEGORY_LABEL: Record<MaturityCategory, string> = {
  foundation: 'Base normativa',
  measurement: 'Medición',
  behavior: 'Comportamiento',
  leadership: 'Liderazgo',
  integration: 'Integración',
};

export function MaturityIndexCard({
  report,
  recommendations,
}: MaturityIndexCardProps) {
  const { t } = useTranslation();
  const levels: MaturityLevelNumber[] = useMemo(() => [1, 2, 3, 4, 5], []);
  const overallPct = Math.round(report.overallScore * 100);

  return (
    <article
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="maturity-index-card"
      aria-label={t('maturity.aria', 'Índice de Madurez Preventiva') as string}
    >
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('maturity.title', 'Madurez Preventiva')}
        </h2>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-bold ${LEVEL_COLOR[report.level]}`}
          data-testid="maturity-level-badge"
        >
          Nivel {report.level} · {LEVEL_LABELS[report.level]}
        </span>
      </header>

      {/* Overall-score bar (distinct from the page's circular level gauge;
          renamed from `maturity-gauge` to avoid a testid collision when this
          card is mounted inside <MaturityIndicator />). */}
      <div className="mb-4" data-testid="maturity-score-bar">
        <div className="flex items-end justify-between mb-1">
          <span className="text-xs text-secondary-token">
            {t('maturity.overall', 'Score global')}
          </span>
          <span className="text-lg font-black text-primary-token">
            {overallPct}%
          </span>
        </div>
        <div
          className="h-2 w-full rounded-full bg-default-token/40 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overallPct}
        >
          <div
            className="h-full bg-gradient-to-r from-rose-500 via-amber-500 via-sky-500 via-teal-500 to-emerald-500"
            style={{ width: `${overallPct}%` }}
          />
        </div>
      </div>

      {/* Bradley Curve */}
      <div className="mb-4" data-testid="maturity-bradley-curve">
        <p className="text-[10px] uppercase tracking-wide text-secondary-token mb-1">
          {t('maturity.bradley', 'Bradley Curve')}
        </p>
        <ol className="flex items-stretch gap-1">
          {levels.map((lv) => {
            const active = lv === report.level;
            return (
              <li key={lv} className="flex-1">
                <div
                  data-testid={`bradley-step-${lv}`}
                  className={`text-center text-[10px] font-semibold py-2 rounded-md border ${
                    active
                      ? `${LEVEL_COLOR[lv]} border-transparent`
                      : 'border-default-token bg-surface text-secondary-token'
                  }`}
                >
                  <div className="text-base font-black leading-none">{lv}</div>
                  <div className="mt-0.5">{LEVEL_LABELS[lv]}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Sub-scores */}
      <div className="mb-4" data-testid="maturity-category-scores">
        <p className="text-[10px] uppercase tracking-wide text-secondary-token mb-1">
          {t('maturity.categories', 'Sub-scores por categoría')}
        </p>
        <ul className="space-y-1">
          {(Object.keys(report.categoryScores) as MaturityCategory[]).map(
            (cat) => {
              const score = report.categoryScores[cat];
              const pct = Math.round(score * 100);
              const isWeakest = cat === report.weakestArea;
              return (
                <li
                  key={cat}
                  className="flex items-center gap-2"
                  data-testid={`category-${cat}`}
                >
                  <span
                    className={`w-28 text-xs ${isWeakest ? 'font-bold text-rose-700 dark:text-rose-300' : 'text-primary-token'}`}
                  >
                    {CATEGORY_LABEL[cat]}
                  </span>
                  <div className="flex-1 h-1.5 bg-default-token/40 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${isWeakest ? 'bg-rose-500' : 'bg-teal-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs tabular-nums text-secondary-token">
                    {pct}%
                  </span>
                </li>
              );
            },
          )}
        </ul>
      </div>

      {/* Next steps */}
      <div data-testid="maturity-next-steps">
        <p className="text-[10px] uppercase tracking-wide text-secondary-token mb-1">
          {t('maturity.next_steps', 'Próximos pasos para subir 1 nivel')}
        </p>
        <ol className="space-y-1 list-decimal list-inside">
          {recommendations.map((rec, idx) => (
            <li
              key={`${rec.category}-${idx}`}
              data-testid={`next-step-${idx}`}
              className="text-xs text-primary-token leading-snug"
            >
              <span className="font-semibold">
                {CATEGORY_LABEL[rec.category]}:
              </span>{' '}
              {rec.action}
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}
