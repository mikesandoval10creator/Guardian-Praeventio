// Praeventio Guard — F.30 Aggregate Telemetry panel.
//
// Renders the REAL aggregated operational-telemetry feed served by
// GET /api/sprint-k/:projectId/telemetry/aggregate?window=7d|30d|90d
// (src/server/routes/aggregateTelemetry.ts → collectEvents + aggregateFeed +
// computeVelocities, all reading Firestore telemetry_events for the project).
//
// Privacy: the server NEVER exports PII — only counts + scores. This panel
// shows event counts by kind, by severity, totals, and per-day velocities.
// Empty-state is HONEST: when the window has zero events we say so, we never
// fabricate sample numbers.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Gauge, TrendingUp } from 'lucide-react';
import { useAggregateTelemetry } from '../../hooks/useAggregateTelemetry';
import type {
  AggregationWindow,
  TelemetryEventKind,
} from '../../services/telemetry/aggregator';

interface AggregateTelemetryPanelProps {
  projectId: string | null;
}

const WINDOWS: AggregationWindow[] = ['7d', '30d', '90d'];

// User-facing labels (es-CL) for each telemetry event kind. Defaults keep the
// panel readable even before i18n keys land in the locale files.
const KIND_LABEL: Record<TelemetryEventKind, string> = {
  incident_recorded: 'Incidentes registrados',
  training_completed: 'Capacitaciones completadas',
  epp_delivered: 'EPP entregados',
  inspection_done: 'Inspecciones realizadas',
  permit_issued: 'Permisos emitidos',
  permit_closed: 'Permisos cerrados',
  corrective_action_opened: 'Acciones correctivas abiertas',
  corrective_action_closed: 'Acciones correctivas cerradas',
  sos_triggered: 'SOS activados',
  micro_training_passed: 'Micro-capacitaciones aprobadas',
  audit_export: 'Exportaciones de auditoría',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;
const SEVERITY_LABEL: Record<(typeof SEVERITY_ORDER)[number], string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};
const SEVERITY_COLOR: Record<(typeof SEVERITY_ORDER)[number], string> = {
  critical: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
  high: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  medium: 'text-sky-400 border-sky-500/30 bg-sky-500/10',
  low: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
};

export function AggregateTelemetryPanel({
  projectId,
}: AggregateTelemetryPanelProps) {
  const { t } = useTranslation();
  const [window, setWindow] = useState<AggregationWindow>('7d');
  const { data, loading, error } = useAggregateTelemetry(projectId, window);

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
          <BarChart3 className="w-4 h-4 text-indigo-400" />
        </div>
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-white">
            {t('telemetry.aggregate.title', 'Telemetría operacional agregada')}
          </h3>
          <p className="text-[10px] text-zinc-500">
            {t(
              'telemetry.aggregate.subtitle',
              'Conteos sin datos personales — incidentes, EPP, permisos y más',
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 self-start" role="group" aria-label={t('telemetry.aggregate.windowLabel', 'Ventana de tiempo')}>
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWindow(w)}
            aria-pressed={window === w}
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
              window === w
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (!projectId) {
    body = (
      <p className="text-xs text-zinc-500">
        {t(
          'telemetry.aggregate.noProject',
          'Selecciona un proyecto para ver su telemetría agregada.',
        )}
      </p>
    );
  } else if (loading) {
    body = (
      <div
        data-testid="aggregate-telemetry-loading"
        className="animate-pulse text-xs text-zinc-500"
      >
        {t('telemetry.aggregate.loading', 'Cargando telemetría…')}
      </div>
    );
  } else if (error) {
    body = (
      <p className="text-xs text-rose-400">
        {t(
          'telemetry.aggregate.error',
          'No se pudo cargar la telemetría agregada. Reintenta más tarde.',
        )}
      </p>
    );
  } else if (!data || data.feed.totalEvents === 0) {
    // HONEST empty-state — no fabricated numbers.
    body = (
      <p data-testid="aggregate-telemetry-empty" className="text-xs text-zinc-500">
        {t(
          'telemetry.aggregate.empty',
          'Sin eventos operacionales en esta ventana. Los datos aparecerán a medida que se registren incidentes, capacitaciones, permisos y más.',
        )}
      </p>
    );
  } else {
    const { feed, velocities } = data;
    body = (
      <div data-testid="aggregate-telemetry-data" className="space-y-5">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black text-indigo-400">
            {feed.totalEvents}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {t('telemetry.aggregate.totalEvents', 'eventos en la ventana')}
          </span>
        </div>

        {/* Severity breakdown */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-1.5">
            <Gauge className="w-3 h-3" />
            {t('telemetry.aggregate.bySeverity', 'Por severidad')}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SEVERITY_ORDER.map((sev) => (
              <div
                key={sev}
                className={`rounded-lg px-3 py-2 border ${SEVERITY_COLOR[sev]}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-widest">
                  {SEVERITY_LABEL[sev]}
                </p>
                <p className="text-lg font-black">
                  {feed.countBySeverity[sev]}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Per-kind velocities (events + per-day rate), sorted by count desc */}
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" />
            {t('telemetry.aggregate.byKind', 'Por tipo de evento')}
          </p>
          <ul className="space-y-1.5">
            {velocities.map((v) => (
              <li
                key={v.kind}
                data-testid={`aggregate-kind-${v.kind}`}
                className="flex items-center justify-between gap-3 bg-zinc-800/50 border border-white/5 rounded-lg px-3 py-2"
              >
                <span className="text-xs text-zinc-200">
                  {KIND_LABEL[v.kind] ?? v.kind}
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-black text-white">{v.count}</span>
                  <span className="text-[10px] text-zinc-500">
                    {t('telemetry.aggregate.perDay', '{{rate}}/día', {
                      rate: v.perDay,
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <section
      data-testid="aggregate-telemetry-panel"
      className="mt-6 bg-zinc-900/60 border border-white/5 rounded-2xl p-5"
    >
      {header}
      {body}
    </section>
  );
}
