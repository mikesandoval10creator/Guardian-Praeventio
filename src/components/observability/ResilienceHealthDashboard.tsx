// Praeventio Guard — Wire UI: <ResilienceHealthDashboard />
//
// Visualiza el `ResilienceHealthReport` de `resilienceHealthMonitor`.
// Diseñado para drop-in en Settings → "Estado del Asistente" y para
// usarse como evidencia en auditorías de compliance (ISO 45001
// sección 8.1 — preparación y respuesta a emergencias).
//
// Componente puro presentational — el caller corre el monitor en su
// frecuencia preferida y pasa el report.

import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  Cpu,
  GitBranch,
  Database,
  Server,
  Lock,
  Archive,
  Wifi,
  Clock,
  RefreshCcw,
  ChevronRight,
} from 'lucide-react';
import type {
  ResilienceHealthReport,
  SubsystemId,
  SubsystemReport,
  SubsystemStatus,
} from '../../services/observability/resilienceHealthMonitor';

interface ResilienceHealthDashboardProps {
  report: ResilienceHealthReport;
  /** Callback al click "Refrescar" — caller corre el monitor de nuevo. */
  onRefresh?: () => void;
  /** True si una refresh está en curso (loading state). */
  refreshing?: boolean;
  /** Callback al click en una recomendación. */
  onRecommendationAction?: (subsystem: SubsystemId) => void;
  /** Si true, oculta detalles técnicos (metadata) — modo compliance. */
  hideTechnicalDetails?: boolean;
}

const SUBSYSTEM_META: Record<
  SubsystemId,
  { Icon: typeof Cpu; label: string }
> = {
  slm: { Icon: Cpu, label: 'IA en dispositivo (SLM)' },
  zettelkasten: { Icon: GitBranch, label: 'Grafo de conocimiento' },
  firestore: { Icon: Database, label: 'Base de datos' },
  gemini: { Icon: Server, label: 'IA en línea' },
  device_kek: { Icon: Lock, label: 'Cifrado del dispositivo' },
  encrypted_kv: { Icon: Archive, label: 'Cache cifrado' },
  network: { Icon: Wifi, label: 'Conexión de red' },
};

const STATUS_META: Record<
  SubsystemStatus,
  { Icon: typeof ShieldCheck; label: string; cls: string }
> = {
  healthy: {
    Icon: ShieldCheck,
    label: 'Saludable',
    cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  },
  degraded: {
    Icon: AlertTriangle,
    label: 'Degradado',
    cls: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300',
  },
  critical: {
    Icon: AlertOctagon,
    label: 'Crítico',
    cls: 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300',
  },
  unknown: {
    Icon: HelpCircle,
    label: 'Desconocido',
    cls: 'bg-stone-500/15 border-stone-500/40 text-stone-700 dark:text-stone-300',
  },
};

const SEVERITY_BORDER: Record<'info' | 'warn' | 'critical', string> = {
  info: 'border-blue-500/40 bg-blue-500/5',
  warn: 'border-amber-500/40 bg-amber-500/5',
  critical: 'border-rose-500/40 bg-rose-500/5',
};

const SEVERITY_TEXT: Record<'info' | 'warn' | 'critical', string> = {
  info: 'text-blue-800 dark:text-blue-200',
  warn: 'text-amber-800 dark:text-amber-200',
  critical: 'text-rose-800 dark:text-rose-200',
};

export function ResilienceHealthDashboard({
  report,
  onRefresh,
  refreshing,
  onRecommendationAction,
  hideTechnicalDetails = false,
}: ResilienceHealthDashboardProps) {
  const { t } = useTranslation();
  const overall = STATUS_META[report.overallStatus];

  // Order: critical → degraded → unknown → healthy.
  const orderedSubsystems = report.subsystems.slice().sort((a, b) => {
    const rank: Record<SubsystemStatus, number> = {
      critical: 0,
      degraded: 1,
      unknown: 2,
      healthy: 3,
    };
    return rank[a.status] - rank[b.status];
  });

  return (
    <section
      data-testid="resilience-dashboard"
      data-overall-status={report.overallStatus}
      className="rounded-2xl border border-stone-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      aria-label={t('resilience.aria', 'Estado de resiliencia del asistente') as string}
    >
      {/* Overall status header */}
      <header
        data-testid="resilience-overall"
        className={`flex items-center gap-3 rounded-lg border p-3 mb-4 ${overall.cls}`}
      >
        <overall.Icon className="w-6 h-6 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-bold opacity-80">
            {t('resilience.overallLabel', 'Estado general')}
          </p>
          <h2 className="text-base font-black">
            {overall.label}
          </h2>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            data-testid="resilience-refresh"
            aria-label={t('resilience.refresh', 'Refrescar') as string}
            className="p-2 rounded-md hover:bg-white/40 dark:hover:bg-black/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCcw
              className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}
      </header>

      {/* Subsystems grid */}
      <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-2">
        {t('resilience.subsystemsLabel', 'Subsistemas')}
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4" data-testid="resilience-subsystems">
        {orderedSubsystems.map((s) => (
          <SubsystemCard
            key={s.id}
            subsystem={s}
            hideTechnicalDetails={hideTechnicalDetails}
          />
        ))}
      </ul>

      {/* Recommendations */}
      {report.recommendations.length === 0 ? (
        <p
          data-testid="resilience-no-recommendations"
          className="text-xs italic text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5"
        >
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          {t('resilience.noRecs', 'Sin acciones recomendadas. Todo en orden.')}
        </p>
      ) : (
        <div data-testid="resilience-recommendations">
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5">
            {t('resilience.recsLabel', 'Recomendaciones')} ({report.recommendations.length})
          </p>
          <ul className="space-y-1.5">
            {report.recommendations.map((rec, i) => (
              <li
                key={`${rec.subsystem}-${i}`}
                data-testid={`resilience-rec-${rec.subsystem}-${i}`}
                data-severity={rec.severity}
                className={`rounded-md border px-2 py-1.5 ${SEVERITY_BORDER[rec.severity]}`}
              >
                <button
                  type="button"
                  onClick={
                    onRecommendationAction
                      ? () => onRecommendationAction(rec.subsystem)
                      : undefined
                  }
                  disabled={!onRecommendationAction}
                  className={`w-full text-left flex items-start gap-2 ${SEVERITY_TEXT[rec.severity]} ${onRecommendationAction ? 'hover:underline' : 'cursor-default'}`}
                >
                  <span className="text-[10px] uppercase font-bold opacity-80 shrink-0 mt-0.5 w-12">
                    {rec.severity}
                  </span>
                  <span className="text-xs flex-1">{rec.action}</span>
                  {onRecommendationAction && (
                    <ChevronRight
                      className="w-4 h-4 shrink-0 opacity-60"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      {!hideTechnicalDetails && (
        <footer
          data-testid="resilience-footer"
          className="flex items-center gap-2 mt-3 pt-2 border-t border-stone-500/20 text-[10px] opacity-60"
        >
          <Clock className="w-3 h-3" aria-hidden="true" />
          <span>
            {t('resilience.generatedAt', 'Generado')}: {report.generatedAt.slice(0, 19).replace('T', ' ')}
          </span>
          <span className="ml-auto font-mono">
            {report.totalLatencyMs} ms
          </span>
        </footer>
      )}
    </section>
  );
}

interface SubsystemCardProps {
  subsystem: SubsystemReport;
  hideTechnicalDetails: boolean;
}

function SubsystemCard({ subsystem, hideTechnicalDetails }: SubsystemCardProps) {
  const meta = SUBSYSTEM_META[subsystem.id];
  const status = STATUS_META[subsystem.status];
  return (
    <li
      data-testid={`resilience-subsystem-${subsystem.id}`}
      data-status={subsystem.status}
      className={`rounded-md border px-2.5 py-2 ${status.cls}`}
    >
      <div className="flex items-start gap-2">
        <meta.Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-bold leading-tight">{meta.label}</p>
            <status.Icon className="w-3 h-3 opacity-80" aria-hidden="true" />
            <span className="text-[9px] uppercase tracking-wide font-bold opacity-80">
              {status.label}
            </span>
          </div>
          <p className="text-[11px] leading-snug opacity-90 mt-0.5">
            {subsystem.detail}
          </p>
          {!hideTechnicalDetails && subsystem.checkLatencyMs > 0 && (
            <p
              data-testid={`resilience-subsystem-${subsystem.id}-latency`}
              className="text-[9px] opacity-50 font-mono mt-0.5"
            >
              {subsystem.checkLatencyMs} ms
            </p>
          )}
          {!hideTechnicalDetails && subsystem.error && (
            <p
              data-testid={`resilience-subsystem-${subsystem.id}-error`}
              className="text-[10px] mt-1 text-rose-700 dark:text-rose-300 italic"
            >
              {subsystem.error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
