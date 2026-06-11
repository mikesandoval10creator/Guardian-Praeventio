// Épica Rubros SII — slice 4: "¿cómo se compara mi proyecto con otros del
// mismo rubro?" dashboard card.
//
// Reads GET /api/sii/:projectId/rubro-benchmarks (server-side k-anonymity —
// see src/server/routes/rubroBenchmarks.ts) and renders:
//   • your own value vs the rubro's median and p25–p75 band per metric, OR
//   • the honest below-threshold message when fewer than N projects of the
//     same SII sector contribute.
//
// Best-effort widget (same contract as the sibling dashboard widgets):
// any fetch/availability failure renders nothing — benchmarks must never
// break the dashboard. The response is aggregate-only by server contract;
// this card renders no identifier other than the caller's own rubro.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { apiAuthHeaders } from '../../lib/apiAuth';
import { logger } from '../../utils/logger';
import {
  RUBRO_METRIC_IDS,
  type MetricDistribution,
  type RubroMetricId,
} from '../../services/sii/rubroBenchmarks';

interface RubroBenchmarksResponse {
  available: boolean;
  reason?: string;
  eligible?: boolean;
  requiredProjects?: number;
  requiredTenants?: number;
  rubro?: { siiCode: number | null; descripcion: string | null; sectorId: string };
  mine?: Partial<Record<RubroMetricId, number | null>>;
  k?: number;
  kTenants?: number;
  perMetric?: Partial<Record<RubroMetricId, MetricDistribution | null>>;
}

const METRIC_FALLBACK_LABELS: Record<RubroMetricId, string> = {
  incidentes12m: 'Incidentes (últimos 12 meses)',
  hallazgosAbiertosPct: 'Hallazgos abiertos (%)',
  obligacionesAlDiaPct: 'Obligaciones al día (%)',
};

const PCT_METRICS: ReadonlySet<RubroMetricId> = new Set([
  'hallazgosAbiertosPct',
  'obligacionesAlDiaPct',
]);

function fmt(value: number | null | undefined, metric: RubroMetricId, noData: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return noData;
  const rounded = Math.round(value * 10) / 10;
  return PCT_METRICS.has(metric) ? `${rounded}%` : String(rounded);
}

export function RubroBenchmarksCard() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const [data, setData] = useState<RubroBenchmarksResponse | null>(null);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sii/${projectId}/rubro-benchmarks`, {
          headers: { ...(await apiAuthHeaders()) },
        });
        if (!res.ok) return; // best-effort: widget hides itself
        const body = (await res.json()) as RubroBenchmarksResponse;
        if (!cancelled) setData(body);
      } catch (err) {
        // Never break the dashboard for a benchmark widget.
        logger.warn('rubro_benchmarks_fetch_failed', { err: String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId || !data || !data.available || !data.rubro) return null;

  const noData = t('rubro_benchmarks.no_data', 's/d');
  const rubroLabel = data.rubro.descripcion ?? data.rubro.sectorId;

  return (
    <section className="rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-mode border border-default-token bg-surface">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="w-4 h-4 text-emerald-500 shrink-0" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-tight">
          {t('rubro_benchmarks.title', 'Comparación con tu rubro')}
        </h2>
      </div>
      <p className="text-xs text-secondary-token mb-3">
        {t('rubro_benchmarks.your_rubro', 'Tu rubro')}: {rubroLabel}
      </p>

      {!data.eligible ? (
        <p className="text-xs text-muted-token">
          {t(
            'rubro_benchmarks.not_enough',
            'Aún no hay suficientes proyectos de tu rubro para comparar (se requieren al menos {{n}}).',
            { n: data.requiredProjects ?? 5 },
          )}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {RUBRO_METRIC_IDS.map((metric) => {
              const dist = data.perMetric?.[metric] ?? null;
              return (
                <div
                  key={metric}
                  className="rounded-lg border border-default-token p-2 flex flex-col gap-1"
                >
                  <span className="text-[10px] uppercase tracking-wide text-muted-token">
                    {t(`rubro_benchmarks.metric_${metric}`, METRIC_FALLBACK_LABELS[metric])}
                  </span>
                  <span className="text-xs text-secondary-token">
                    {t('rubro_benchmarks.mine', 'Tú')}:{' '}
                    <strong
                      className="text-primary-token"
                      data-testid={`rubro-benchmark-mine-${metric}`}
                    >
                      {fmt(data.mine?.[metric], metric, noData)}
                    </strong>
                  </span>
                  <span className="text-xs text-secondary-token">
                    {t('rubro_benchmarks.median', 'Mediana')}:{' '}
                    <strong
                      className="text-primary-token"
                      data-testid={`rubro-benchmark-median-${metric}`}
                    >
                      {fmt(dist?.median, metric, noData)}
                    </strong>
                  </span>
                  <span
                    className="text-[10px] text-muted-token"
                    data-testid={`rubro-benchmark-range-${metric}`}
                  >
                    {dist
                      ? `${t('rubro_benchmarks.range', 'p25–p75')}: ${fmt(dist.p25, metric, noData)}–${fmt(dist.p75, metric, noData)}`
                      : noData}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-token mt-2">
            {t(
              'rubro_benchmarks.privacy_note',
              'Datos agregados y anónimos de {{k}} proyectos del mismo rubro SII.',
              { k: data.k ?? 0 },
            )}
          </p>
        </>
      )}
    </section>
  );
}
