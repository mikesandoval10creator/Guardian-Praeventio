// Praeventio Guard — F.29 page wrapper.
//
// Indicadores de Tendencia de Incidentes + Leading Indicators.
// Time series sobre `incidents` filtrados por proyecto. El endpoint
// (`/api/sprint-k/:projectId/incidents/trends`) agrega y normaliza;
// esta vista solo presenta — patrón consistente con el resto de
// pages Sprint K.
//
// Filosofía F.29:
//   - El gráfico de línea muestra severidad ponderada por bucket, no
//     conteo crudo. Un solo SIF pesa más que 5 low-severity y debe
//     dominar visualmente la tendencia. Si un proyecto tiene
//     near-miss-ratio alto + closure-rate alto pero la línea
//     ponderada sube, la cultura de reporte funciona PERO la
//     severidad real está empeorando — un dashboard de "cantidad" no
//     captura eso.
//   - Trend direction (mejorando/estable/empeorando) viene de
//     regresión lineal en server; el cliente solo pinta el color. Si
//     trendConfidence < 0.2 mostramos chip con cautela ("baja
//     confianza") para no dramatizar señal ruidosa.
//   - Leading indicators: near-miss ratio (good if high — más reporte
//     bottom-up), closure rate (good if high — SGSST responde),
//     average days open (good if low — velocidad de respuesta). La
//     paleta refleja la dirección "buena" en cada caso para que un
//     escaneo rápido del card sea correcto.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  WifiOff,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertCircle,
  Clock,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useIncidentTrends,
  type IncidentTrendWindow,
  type IncidentTrendGroup,
  type IncidentTrendDirection,
  type IncidentTrendBucket,
} from '../hooks/useSprintK';

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers
// ────────────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS: { value: IncidentTrendWindow; label: string }[] = [
  { value: '3m', label: '3 meses' },
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
];

const GROUP_OPTIONS: { value: IncidentTrendGroup; label: string }[] = [
  { value: 'month', label: 'Mes' },
  { value: 'week', label: 'Semana' },
];

const TREND_META: Record<
  IncidentTrendDirection,
  {
    label: string;
    color: string;
    bg: string;
    border: string;
    Icon: typeof TrendingUp;
  }
> = {
  improving: {
    label: 'Mejorando',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    Icon: TrendingDown,
  },
  stable: {
    label: 'Estable',
    color: 'text-zinc-600 dark:text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/30',
    Icon: Activity,
  },
  worsening: {
    label: 'Empeorando',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    Icon: TrendingUp,
  },
};

/**
 * Paleta determinística para el breakdown por kind. Cuando el endpoint
 * reporta categorías nuevas, las mapeamos cíclicamente; el orden de los
 * `Object.entries` queda estable porque está sorteado en el bucket
 * builder, así que el mismo proyecto siempre ve los mismos colores.
 */
const KIND_COLORS = [
  'bg-teal-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-indigo-500',
  'bg-pink-500',
];

function kindColorFor(index: number): string {
  return KIND_COLORS[index % KIND_COLORS.length];
}

// ────────────────────────────────────────────────────────────────────────
// SVG sparkline — sin dependencias. Tremor no está en el bundle
// (verificado en package.json); preferimos SVG nativo a agregar 80KB
// gzipped por un solo chart. Eje X = label, eje Y = severityWeighted.
// ────────────────────────────────────────────────────────────────────────

interface SparklineProps {
  buckets: IncidentTrendBucket[];
  trend: IncidentTrendDirection;
}

function TrendSparkline({ buckets, trend }: SparklineProps) {
  if (buckets.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-default-token bg-surface p-8 text-sm text-secondary-token"
        data-testid="incident-trends-chart-empty"
      >
        Sin datos para graficar
      </div>
    );
  }

  const maxWeight = Math.max(1, ...buckets.map((b) => b.severityWeighted));
  const width = 600;
  const height = 160;
  const paddingX = 24;
  const paddingY = 16;
  const innerW = width - paddingX * 2;
  const innerH = height - paddingY * 2;
  const stepX =
    buckets.length > 1 ? innerW / (buckets.length - 1) : 0;

  const points = buckets.map((b, i) => {
    const x = paddingX + i * stepX;
    const y = paddingY + innerH - (b.severityWeighted / maxWeight) * innerH;
    return { x, y, label: b.label, weight: b.severityWeighted };
  });

  // Linea poligonal + area sombreada.
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    buckets.length > 1
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(paddingY + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(paddingY + innerH).toFixed(1)} Z`
      : '';

  const strokeColor =
    trend === 'worsening'
      ? '#e11d48' // rose-600
      : trend === 'improving'
        ? '#059669' // emerald-600
        : '#0d9488'; // teal-600
  const areaColor =
    trend === 'worsening'
      ? 'rgba(225, 29, 72, 0.12)'
      : trend === 'improving'
        ? 'rgba(5, 150, 105, 0.12)'
        : 'rgba(13, 148, 136, 0.12)';

  return (
    <div
      className="rounded-xl border border-default-token bg-surface p-3"
      data-testid="incident-trends-chart"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-40"
        role="img"
        aria-label="Serie de severidad ponderada por bucket"
      >
        {areaPath && <path d={areaPath} fill={areaColor} stroke="none" />}
        <path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p) => (
          <circle
            key={`${p.label}-${p.x}`}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={strokeColor}
          >
            <title>{`${p.label}: ${p.weight}`}</title>
          </circle>
        ))}
      </svg>
      {/* Etiquetas debajo — solo extremos cuando hay muchas para no
          chocar visualmente. */}
      <div
        className="mt-1 flex justify-between text-[10px] text-secondary-token"
        data-testid="incident-trends-chart-labels"
      >
        <span>{buckets[0].label}</span>
        {buckets.length > 2 && <span>{buckets[Math.floor(buckets.length / 2)].label}</span>}
        <span>{buckets[buckets.length - 1].label}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export function IncidentTrends() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [window, setWindow] = useState<IncidentTrendWindow>('12m');
  const [group, setGroup] = useState<IncidentTrendGroup>('month');

  const trendsResp = useIncidentTrends(projectId, { window, group });

  const data = trendsResp.data;
  const buckets = useMemo(() => data?.buckets ?? [], [data]);

  // Agregar breakdown por kind a través de todos los buckets para la
  // visualización de "stack". Sorted desc por total para que las
  // categorías dominantes aparezcan primero.
  const kindAggregate = useMemo(() => {
    const agg = new Map<string, number>();
    for (const b of buckets) {
      for (const [k, v] of Object.entries(b.byKind)) {
        agg.set(k, (agg.get(k) ?? 0) + v);
      }
    }
    return Array.from(agg.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);
  }, [buckets]);

  const totalKindCount = kindAggregate.reduce((acc, k) => acc + k.count, 0);

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="incident-trends-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <BarChart3
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentTrends.page.title', 'Tendencia de Incidentes')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'incidentTrends.page.selectProject',
              'Selecciona un proyecto para ver la serie de incidentes y leading indicators.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const trendMeta = data ? TREND_META[data.trend] : null;
  const lowConfidence =
    !!data && data.trendConfidence > 0 && data.trendConfidence < 0.2;

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="incident-trends-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <BarChart3 className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentTrends.page.title', 'Tendencia de Incidentes')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'incidentTrends.page.subtitle',
              'F.29 — Serie temporal + leading indicators (near-miss ratio, closure rate, días promedio).',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="incident-trends-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase font-bold text-secondary-token">
            {t('incidentTrends.filter.window', 'Ventana:')}
          </span>
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setWindow(opt.value)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                window === opt.value
                  ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-default-token text-secondary-token hover:text-primary-token'
              }`}
              data-testid={`incident-trends-window-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase font-bold text-secondary-token">
            {t('incidentTrends.filter.group', 'Agrupar:')}
          </span>
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setGroup(opt.value)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                group === opt.value
                  ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-default-token text-secondary-token hover:text-primary-token'
              }`}
              data-testid={`incident-trends-group-${opt.value}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / error */}
      {trendsResp.loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="incident-trends-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {trendsResp.error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="incident-trends-error"
          role="alert"
        >
          {t(
            'incidentTrends.error',
            'No se pudo cargar la tendencia: {{msg}}',
            { msg: trendsResp.error.message },
          )}
        </div>
      )}

      {!trendsResp.loading && !trendsResp.error && data && (
        <>
          {/* Hero: chart + trend chip */}
          <section
            className="space-y-3"
            data-testid="incident-trends-hero"
            aria-label="Serie y dirección de tendencia"
          >
            <div className="flex flex-wrap items-center gap-3">
              {trendMeta && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-bold ${trendMeta.color} ${trendMeta.bg} ${trendMeta.border}`}
                  data-testid="incident-trends-direction"
                >
                  <trendMeta.Icon className="w-4 h-4" aria-hidden="true" />
                  {t(`incidentTrends.trend.${data.trend}`, trendMeta.label)}
                </span>
              )}
              <span
                className="text-xs text-secondary-token"
                data-testid="incident-trends-total"
              >
                {t(
                  'incidentTrends.total',
                  '{{count}} incidentes en la ventana',
                  { count: data.totalIncidents },
                )}
              </span>
              {lowConfidence && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400"
                  data-testid="incident-trends-low-confidence"
                >
                  <AlertCircle className="w-3 h-3" aria-hidden="true" />
                  {t('incidentTrends.lowConfidence', 'Baja confianza')}
                </span>
              )}
            </div>
            <TrendSparkline buckets={buckets} trend={data.trend} />
          </section>

          {/* Leading indicators row */}
          <section
            aria-label="Leading indicators"
            data-testid="incident-trends-leading"
            className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <LeadingCard
              testId="incident-trends-leading-near-miss"
              Icon={ShieldAlert}
              label={t('incidentTrends.leading.nearMiss', 'Near-miss ratio')}
              hint={t(
                'incidentTrends.leading.nearMissHint',
                'Más reporte bottom-up = mejor cultura preventiva.',
              )}
              value={`${Math.round(data.leading.nearMissRatio * 100)}%`}
              good={data.leading.nearMissRatio >= 0.3}
            />
            <LeadingCard
              testId="incident-trends-leading-closure"
              Icon={CheckCircle2}
              label={t('incidentTrends.leading.closure', 'Closure rate')}
              hint={t(
                'incidentTrends.leading.closureHint',
                '% de incidents cerrados. Alto = SGSST responde rápido.',
              )}
              value={`${Math.round(data.leading.closureRate * 100)}%`}
              good={data.leading.closureRate >= 0.7}
            />
            <LeadingCard
              testId="incident-trends-leading-days"
              Icon={Clock}
              label={t('incidentTrends.leading.daysOpen', 'Días promedio abierto')}
              hint={t(
                'incidentTrends.leading.daysOpenHint',
                'Solo cerrados. Bajo = respuesta rápida.',
              )}
              value={data.leading.averageDaysOpen.toFixed(1)}
              good={data.leading.averageDaysOpen <= 15 && data.leading.averageDaysOpen > 0}
            />
          </section>

          {/* Breakdown por kind */}
          {kindAggregate.length > 0 && (
            <section
              aria-label="Breakdown por tipo"
              data-testid="incident-trends-by-kind"
              className="rounded-2xl border border-default-token bg-surface p-4"
            >
              <h2 className="text-sm font-black uppercase tracking-tight text-primary-token">
                {t('incidentTrends.byKind.title', 'Distribución por tipo')}
              </h2>
              <p className="mt-1 text-[11px] text-secondary-token">
                {t(
                  'incidentTrends.byKind.subtitle',
                  'Conteo crudo en la ventana actual (no ponderado).',
                )}
              </p>
              {/* Stack horizontal */}
              <div
                className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-muted"
                data-testid="incident-trends-by-kind-stack"
              >
                {kindAggregate.map((entry, idx) => {
                  const pct =
                    totalKindCount > 0 ? (entry.count / totalKindCount) * 100 : 0;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={entry.kind}
                      className={kindColorFor(idx)}
                      style={{ width: `${pct}%` }}
                      title={`${entry.kind}: ${entry.count}`}
                      data-testid={`incident-trends-by-kind-segment-${entry.kind}`}
                    />
                  );
                })}
              </div>
              {/* Leyenda */}
              <ul
                className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2"
                data-testid="incident-trends-by-kind-legend"
              >
                {kindAggregate.map((entry, idx) => (
                  <li
                    key={entry.kind}
                    className="flex items-center gap-2 text-xs"
                    data-testid={`incident-trends-by-kind-${entry.kind}`}
                  >
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${kindColorFor(idx)}`}
                      aria-hidden="true"
                    />
                    <span className="truncate text-secondary-token">{entry.kind}</span>
                    <span className="ml-auto font-mono tabular-nums font-bold text-primary-token">
                      {entry.count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Empty state — endpoint OK pero sin incidents en la ventana */}
          {data.totalIncidents === 0 && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-8 text-center"
              data-testid="incident-trends-no-data"
            >
              <BarChart3
                className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                aria-hidden="true"
              />
              <p className="text-sm text-secondary-token italic">
                {t(
                  'incidentTrends.empty',
                  'No hay incidentes registrados en esta ventana.',
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// LeadingCard — sub-component for a single leading indicator
// ────────────────────────────────────────────────────────────────────────

interface LeadingCardProps {
  testId: string;
  Icon: typeof CheckCircle2;
  label: string;
  hint: string;
  value: string;
  good: boolean;
}

function LeadingCard({ testId, Icon, label, hint, value, good }: LeadingCardProps) {
  return (
    <div
      className={`rounded-xl border bg-surface p-3 shadow-mode ${
        good
          ? 'border-emerald-500/30'
          : 'border-default-token'
      }`}
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={`w-4 h-4 ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-secondary-token'}`}
          aria-hidden="true"
        />
        <span className="text-[11px] uppercase font-bold text-secondary-token">
          {label}
        </span>
      </div>
      <p
        className={`mt-2 font-mono text-2xl font-black tabular-nums ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary-token'}`}
        data-testid={`${testId}-value`}
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] leading-tight text-secondary-token">{hint}</p>
    </div>
  );
}

export default IncidentTrends;
