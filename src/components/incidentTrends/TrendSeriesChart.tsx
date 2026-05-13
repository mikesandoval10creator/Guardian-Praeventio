// Praeventio Guard — Wire UI S45: <TrendSeriesChart />
//
// Visualización presentacional de una serie temporal de incidentes:
// barras simples + dirección + outliers + comparación período-a-período.
// El padre llama a `buildTrendSeries` + `comparePeriods` + `detectOutliers`
// y pasa los resultados como props. NO usa librerías de chart externas —
// SVG manual para mantener bundle ligero (Brecha B principle).

import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import type {
  TrendSeries,
  PeriodComparison,
  OutlierPoint,
} from '../../services/incidentTrends/trendAnalyzer.js';

interface TrendSeriesChartProps {
  series: TrendSeries;
  comparison?: PeriodComparison;
  outliers?: OutlierPoint[];
}

const DIRECTION_META: Record<
  TrendSeries['direction'],
  { label: string; tone: string; Icon: typeof TrendingUp }
> = {
  rising: {
    label: 'En aumento',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    Icon: TrendingUp,
  },
  falling: {
    label: 'En descenso',
    tone: 'bg-teal-50 text-teal-700 border-teal-200',
    Icon: TrendingDown,
  },
  stable: {
    label: 'Estable',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: Minus,
  },
};

export function TrendSeriesChart({
  series,
  comparison,
  outliers = [],
}: TrendSeriesChartProps) {
  const meta = DIRECTION_META[series.direction];
  const { Icon } = meta;
  const maxCount = series.points.reduce((m, p) => Math.max(m, p.count), 1);
  const outlierBuckets = new Set(outliers.map((o) => o.bucket));

  return (
    <section
      className={`rounded-2xl border p-4 space-y-3 ${meta.tone}`}
      data-testid="incidentTrends.chart"
      aria-label="Tendencia de incidentes"
    >
      <header className="flex items-center gap-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <h2
          className="text-sm font-black uppercase tracking-wide"
          data-testid="incidentTrends.directionLabel"
        >
          {meta.label}
        </h2>
        <span className="ml-auto text-[10px] uppercase font-bold tabular-nums">
          {series.granularity} · slope {series.slope.toFixed(2)}
        </span>
      </header>

      {comparison && (
        <p
          className="text-xs"
          data-testid="incidentTrends.comparison"
        >
          Actual <strong>{comparison.currentTotal}</strong> vs anterior{' '}
          <strong>{comparison.previousTotal}</strong>{' '}
          (<span data-testid="incidentTrends.delta">{comparison.deltaPercent}%</span>)
        </p>
      )}

      {series.points.length === 0 ? (
        <p
          className="text-xs italic opacity-70"
          data-testid="incidentTrends.empty"
        >
          Sin datos en el período.
        </p>
      ) : (
        <ul
          className="flex items-end gap-1 h-24"
          data-testid="incidentTrends.bars"
        >
          {series.points.map((p) => {
            const heightPct = Math.round((p.count / maxCount) * 100);
            const isOutlier = outlierBuckets.has(p.bucket);
            return (
              <li
                key={p.bucket}
                data-testid={`incidentTrends.bar.${p.bucket}`}
                className="flex-1 flex flex-col items-center justify-end h-full"
                title={`${p.bucket}: ${p.count}`}
              >
                <div
                  className={`w-full rounded-t ${
                    isOutlier ? 'bg-rose-500' : 'bg-teal-500/70'
                  }`}
                  style={{ height: `${Math.max(2, heightPct)}%` }}
                  aria-label={`${p.bucket}: ${p.count} incidente(s)`}
                />
              </li>
            );
          })}
        </ul>
      )}

      {outliers.length > 0 && (
        <ul
          className="space-y-1"
          data-testid="incidentTrends.outliersList"
        >
          {outliers.map((o) => (
            <li
              key={o.bucket}
              data-testid={`incidentTrends.outlier.${o.bucket}`}
              className="text-[11px] flex items-center gap-1"
            >
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              <span className="font-bold">{o.bucket}</span>
              <span className="opacity-70">
                · {o.count} incidente(s) · z={Number.isFinite(o.zScore) ? o.zScore.toFixed(2) : '∞'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
