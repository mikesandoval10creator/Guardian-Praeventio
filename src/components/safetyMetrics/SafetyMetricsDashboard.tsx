// Praeventio Guard — Wire UI #79: <SafetyMetricsDashboard />
//
// Dashboard ejecutivo TRIR + LTIFR + DART + SIFR + Severity + benchmark
// vs industria + tendencia vs período anterior. Cierra Fase D.10.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldAlert,
  Skull,
  Activity,
} from 'lucide-react';
import {
  buildSafetyMetricsReport,
  analyzeTrend,
  compareTrirVsIndustry,
  compareLtifrVsIndustry,
  type IncidentCounts,
  type ExposureInput,
  type IndustryBenchmark,
  type SafetyMetricsReport,
  type TrendDirection,
} from '../../services/safetyMetrics/osha.js';

interface SafetyMetricsDashboardProps {
  counts: IncidentCounts;
  exposure: ExposureInput;
  periodLabel?: string;
  /** Si se pasa, compara métricas con período anterior. */
  previous?: SafetyMetricsReport;
  /** Industry benchmark a comparar (defaults all_industries_us). */
  industry?: IndustryBenchmark;
}

const TREND_TONE: Record<TrendDirection, { Icon: typeof TrendingUp; color: string }> = {
  improving: { Icon: TrendingDown, color: 'text-emerald-600' },
  stable: { Icon: Minus, color: 'text-secondary-token' },
  worsening: { Icon: TrendingUp, color: 'text-rose-600' },
};

function formatRate(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(decimals);
}

interface MetricCardProps {
  label: string;
  value: number;
  unit: string;
  trend?: TrendDirection;
  trendPercent?: number;
  benchmarkValue?: number;
  testIdSuffix: string;
}

function MetricCard({
  label,
  value,
  unit,
  trend,
  trendPercent,
  benchmarkValue,
  testIdSuffix,
}: MetricCardProps) {
  const trendTone = trend ? TREND_TONE[trend] : null;

  return (
    <div
      className="bg-surface-elevated rounded p-2 space-y-1"
      data-testid={`safety-metric-${testIdSuffix}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase text-secondary-token font-bold">{label}</p>
        {trend && trendTone && (
          <span
            className={`flex items-center gap-0.5 text-[10px] font-bold ${trendTone.color}`}
            data-testid={`safety-metric-trend-${testIdSuffix}`}
          >
            <trendTone.Icon className="w-3 h-3" aria-hidden="true" />
            {trendPercent !== undefined && `${Math.abs(trendPercent)}%`}
          </span>
        )}
      </div>
      <p className="text-2xl font-black tabular-nums">{formatRate(value)}</p>
      <p className="text-[9px] uppercase text-secondary-token">{unit}</p>
      {benchmarkValue !== undefined && (
        <p
          className="text-[10px] tabular-nums"
          data-testid={`safety-metric-benchmark-${testIdSuffix}`}
        >
          <span
            className={
              value < benchmarkValue ? 'text-emerald-600' : 'text-rose-600'
            }
          >
            {value < benchmarkValue ? '▼' : '▲'}
          </span>{' '}
          benchmark {formatRate(benchmarkValue)}
        </p>
      )}
    </div>
  );
}

export function SafetyMetricsDashboard({
  counts,
  exposure,
  periodLabel,
  previous,
  industry = 'all_industries_us',
}: SafetyMetricsDashboardProps) {
  const { t } = useTranslation();

  const report = useMemo(
    () => buildSafetyMetricsReport(counts, exposure, periodLabel),
    [counts, exposure, periodLabel],
  );

  const trends = useMemo(() => {
    if (!previous) return null;
    return {
      trir: analyzeTrend(report, previous, 'trir'),
      ltifr: analyzeTrend(report, previous, 'ltifr'),
      dart: analyzeTrend(report, previous, 'dart'),
      sifr: analyzeTrend(report, previous, 'sifr'),
      severity: analyzeTrend(report, previous, 'severityRate'),
      fatality: analyzeTrend(report, previous, 'fatalityRate'),
    };
  }, [report, previous]);

  const trirVsBench = useMemo(
    () => compareTrirVsIndustry(report.trir, industry),
    [report.trir, industry],
  );
  const ltifrVsBench = useMemo(
    () => compareLtifrVsIndustry(report.ltifr, industry),
    [report.ltifr, industry],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="safety-metrics-dashboard"
      aria-label={t('safetyMetrics.aria', 'Dashboard métricas SST') as string}
    >
      <header className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('safetyMetrics.title', 'Métricas SST')}
        </h2>
        {periodLabel && (
          <span
            className="ml-auto text-[10px] uppercase font-bold text-secondary-token"
            data-testid="safety-metrics-period"
          >
            {periodLabel}
          </span>
        )}
      </header>

      <p className="text-[10px] text-secondary-token">
        {t('safetyMetrics.exposureLabel', 'Horas trabajadas')}:{' '}
        <span className="font-bold tabular-nums">
          {report.totalHoursWorked.toLocaleString()}
        </span>{' '}
        · {t('safetyMetrics.benchmark', 'Benchmark')}: {industry}
      </p>

      <div className="grid grid-cols-3 gap-2">
        <MetricCard
          label="TRIR"
          value={report.trir}
          unit={t('safetyMetrics.per200kh', 'por 200k h') as string}
          trend={trends?.trir.direction}
          trendPercent={trends?.trir.deltaPercent}
          benchmarkValue={trirVsBench.benchmark}
          testIdSuffix="trir"
        />
        <MetricCard
          label="LTIFR"
          value={report.ltifr}
          unit={t('safetyMetrics.perMh', 'por 1M h') as string}
          trend={trends?.ltifr.direction}
          trendPercent={trends?.ltifr.deltaPercent}
          benchmarkValue={ltifrVsBench.benchmark}
          testIdSuffix="ltifr"
        />
        <MetricCard
          label="DART"
          value={report.dart}
          unit={t('safetyMetrics.per200kh', 'por 200k h') as string}
          trend={trends?.dart.direction}
          trendPercent={trends?.dart.deltaPercent}
          testIdSuffix="dart"
        />
        <MetricCard
          label="SIFR"
          value={report.sifr}
          unit={t('safetyMetrics.perMh', 'por 1M h') as string}
          trend={trends?.sifr.direction}
          trendPercent={trends?.sifr.deltaPercent}
          testIdSuffix="sifr"
        />
        <MetricCard
          label={t('safetyMetrics.severity', 'Severity') as string}
          value={report.severityRate}
          unit={t('safetyMetrics.daysPer200kh', 'días/200k h') as string}
          trend={trends?.severity.direction}
          trendPercent={trends?.severity.deltaPercent}
          testIdSuffix="severity"
        />
        <MetricCard
          label={t('safetyMetrics.fatality', 'Fatality') as string}
          value={report.fatalityRate}
          unit={t('safetyMetrics.perMh', 'por 1M h') as string}
          trend={trends?.fatality.direction}
          trendPercent={trends?.fatality.deltaPercent}
          testIdSuffix="fatality"
        />
      </div>

      {report.fatalityRate > 0 && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px] font-bold"
          data-testid="safety-metrics-fatality-warning"
        >
          <Skull className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'safetyMetrics.fatalityWarning',
              'Período con fatalidad(es) registrada(s) — revisión obligatoria con comité directivo.',
            )}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-secondary-token bg-surface-elevated rounded p-2">
        <Activity className="w-3 h-3 shrink-0" aria-hidden="true" />
        <span>
          {t('safetyMetrics.disclaimer', 'TRIR/DART base OSHA 200k h. LTIFR/SIFR base ILO 1M h.')}
        </span>
      </div>
    </section>
  );
}
