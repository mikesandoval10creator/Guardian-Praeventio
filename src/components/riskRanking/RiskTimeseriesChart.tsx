// Praeventio Guard — Plan 3.12 wire orphan: timeseries chart for the
// risk-ranking surface. Renders a 30-day sparkline of findings/day with
// critical-severity highlighted.
//
// Uses recharts (already a project dep, see package.json). Palette aligned
// with the user's preferences (teal #4db6ac primary, rose for critical).
// Respects dark mode via design-token classes.

import { Loader2, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useProject } from '../../contexts/ProjectContext';
import { useRiskTimeseries } from '../../hooks/useRiskRanking';

export interface RiskTimeseriesChartProps {
  /** Window in days. Default 30. */
  days?: number;
  /** Override projectId. If absent, reads from ProjectContext. */
  projectId?: string;
  /** Compact mode — half height, no header. Default false. */
  compact?: boolean;
}

export function RiskTimeseriesChart({
  days = 30,
  projectId: projectIdProp,
  compact = false,
}: RiskTimeseriesChartProps) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = projectIdProp ?? selectedProject?.id ?? null;

  const { data, loading, error } = useRiskTimeseries(projectId, days);

  if (!projectId) {
    return null;
  }

  if (loading && !data) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode flex items-center gap-2"
        aria-busy="true"
      >
        <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
        <span className="text-xs text-muted-token">
          {t('risk_timeseries.loading', 'Cargando tendencia…')}
        </span>
      </section>
    );
  }

  if (error || !data || data.series.length === 0) {
    return (
      <section className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode">
        <p className="text-xs text-secondary-token italic">
          {error
            ? t('risk_timeseries.error', 'No se pudo cargar la tendencia.')
            : t('risk_timeseries.empty', 'Sin datos en la ventana seleccionada.')}
        </p>
      </section>
    );
  }

  const height = compact ? 80 : 160;

  // Format date labels short: "MM-DD" (drop the year).
  const series = data.series.map((p) => ({
    ...p,
    label: p.date.slice(5),
  }));

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-3 sm:p-4 shadow-mode"
      data-testid="risk-timeseries-chart"
      aria-label={t('risk_timeseries.aria', 'Tendencia de riesgos') as string}
    >
      {!compact && (
        <header className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-teal-500" aria-hidden="true" />
          <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
            {t('risk_timeseries.title', `Tendencia ${days} días`, { days })}
          </h2>
        </header>
      )}
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={series}
            margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="riskRankingTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4db6ac" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#4db6ac" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="riskRankingCritical" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
            </defs>
            {!compact && (
              <CartesianGrid stroke="#27272a" strokeOpacity={0.15} strokeDasharray="3 3" />
            )}
            <XAxis
              dataKey="label"
              stroke="#71717a"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
              hide={compact}
            />
            <YAxis
              stroke="#71717a"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={28}
              hide={compact}
            />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                borderRadius: 8,
                border: '1px solid rgba(113,113,122,0.3)',
              }}
              labelStyle={{ fontWeight: 700 }}
              formatter={(value, name) => {
                const v = typeof value === 'number' ? value : Number(value);
                const labels: Record<string, string> = {
                  count: t('risk_timeseries.total', 'Total') as string,
                  critical: t('risk_timeseries.critical', 'Críticos') as string,
                };
                return [String(v), labels[String(name)] ?? String(name)];
              }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#4db6ac"
              strokeWidth={1.5}
              fill="url(#riskRankingTotal)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="critical"
              stroke="#f43f5e"
              strokeWidth={1.5}
              fill="url(#riskRankingCritical)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
