// Praeventio Guard — Sprint K §104 page wrapper.
//
// Panel de Confianza de Datos (calidad para IA). Cierra la pieza UI
// del flujo §104 que ya tenía servicio determinístico
// (`dataConfidence/dataConfidencePanel.ts`) pero no estaba accesible
// desde la navegación: el prevencionista no podía evaluar si los datos
// con los que la IA está sugiriendo eran confiables.
//
// Esta página:
//   1. Lee el snapshot vía `useDataConfidence(projectId)` (overall +
//      domains + topIssues + trend).
//   2. Lee las recomendaciones priorizadas vía
//      `useDataConfidenceRecommendations(projectId)`.
//   3. Renderiza un gauge circular con score 0-100 + color band
//      (rose<40, amber<70, teal<90, gold≥90).
//   4. Renderiza barras por dominio (workers, incidents, training,
//      EPP, permits, audits) con su % de calidad.
//   5. Lista top 10 issues con severity icon + "Dismiss" (admin only).
//   6. Sección de recomendaciones accionables (cards).
//   7. Sparkline con el trend de los últimos 30 días.
//
// IMPORTANTE: el panel nunca debe leerse como un veredicto absoluto.
// Es una señal para que el prevencionista decida si confiar en las
// sugerencias IA — la directiva §4 del usuario dice que la IA jamás
// reemplaza el criterio humano.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  WifiOff,
  AlertTriangle,
  AlertCircle,
  AlertOctagon,
  Info,
  Lightbulb,
  X,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useDataConfidence,
  useDataConfidenceRecommendations,
  dismissDataIssue,
  type DataConfidenceDomain,
  type DataConfidenceIssue,
  type DataConfidenceSeverity,
  type DataConfidenceTrendPoint,
} from '../hooks/useSprintK';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers
// ────────────────────────────────────────────────────────────────────────

const DOMAIN_LABELS: Record<DataConfidenceDomain, string> = {
  workers: 'Trabajadores',
  incidents: 'Incidentes',
  training: 'Capacitaciones',
  epp: 'EPP',
  permits: 'Permisos',
  audits: 'Auditorías',
};

/**
 * Devuelve la clase de color para el gauge según el score.
 * Bands: rose<40 (crítico), amber<70 (medio), teal<90 (bueno), gold≥90 (excelente).
 */
function scoreColorClass(score: number): string {
  if (score < 40) return 'text-rose-500';
  if (score < 70) return 'text-amber-500';
  if (score < 90) return 'text-teal-500';
  return 'text-yellow-500';
}

function scoreStrokeColor(score: number): string {
  if (score < 40) return '#f43f5e';
  if (score < 70) return '#f59e0b';
  if (score < 90) return '#14b8a6';
  return '#eab308';
}

function scoreBgClass(score: number): string {
  if (score < 40) return 'bg-rose-500/10';
  if (score < 70) return 'bg-amber-500/10';
  if (score < 90) return 'bg-teal-500/10';
  return 'bg-yellow-500/10';
}

function severityIcon(severity: DataConfidenceSeverity) {
  switch (severity) {
    case 'critical':
      return AlertOctagon;
    case 'high':
      return AlertTriangle;
    case 'medium':
      return AlertCircle;
    case 'low':
    default:
      return Info;
  }
}

function severityColorClass(severity: DataConfidenceSeverity): string {
  switch (severity) {
    case 'critical':
      return 'text-rose-600 dark:text-rose-400';
    case 'high':
      return 'text-amber-600 dark:text-amber-400';
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'low':
    default:
      return 'text-blue-600 dark:text-blue-400';
  }
}

function severityLabel(severity: DataConfidenceSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Crítico';
    case 'high':
      return 'Alto';
    case 'medium':
      return 'Medio';
    case 'low':
    default:
      return 'Bajo';
  }
}

function priorityColorClass(priority: 'high' | 'medium' | 'low'): string {
  switch (priority) {
    case 'high':
      return 'border-rose-500/30 bg-rose-500/5';
    case 'medium':
      return 'border-amber-500/30 bg-amber-500/5';
    case 'low':
    default:
      return 'border-blue-500/30 bg-blue-500/5';
  }
}

/**
 * Renderiza una sparkline minimalista en SVG con los últimos N puntos.
 * Si hay menos de 2 puntos, retorna un placeholder textual.
 */
function Sparkline({ points }: { points: DataConfidenceTrendPoint[] }) {
  if (points.length < 2) {
    return (
      <div
        className="text-xs text-secondary-token italic"
        data-testid="data-confidence-trend-empty"
      >
        Sin datos suficientes para el trend (necesita ≥2 snapshots).
      </div>
    );
  }
  const width = 240;
  const height = 60;
  const padding = 4;
  const xs = points.map(
    (_, i) => padding + (i / (points.length - 1)) * (width - 2 * padding),
  );
  const minV = Math.min(...points.map((p) => p.overallScore));
  const maxV = Math.max(...points.map((p) => p.overallScore));
  const range = Math.max(maxV - minV, 1);
  const ys = points.map(
    (p) =>
      height - padding - ((p.overallScore - minV) / range) * (height - 2 * padding),
  );
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${ys[i]}`).join(' ');

  const first = points[0].overallScore;
  const last = points[points.length - 1].overallScore;
  const trendUp = last >= first;

  return (
    <div className="flex items-center gap-3" data-testid="data-confidence-trend">
      <svg
        width={width}
        height={height}
        className="overflow-visible"
        aria-label="Trend de confianza últimos 30 días"
      >
        <path
          d={path}
          fill="none"
          stroke={scoreStrokeColor(last)}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((_, i) => (
          <circle
            key={i}
            cx={xs[i]}
            cy={ys[i]}
            r={2}
            fill={scoreStrokeColor(points[i].overallScore)}
          />
        ))}
      </svg>
      <div className="flex flex-col text-xs">
        <span className="text-secondary-token">
          {points.length} snapshots ({points[0].date} → {points[points.length - 1].date})
        </span>
        <span
          className={`flex items-center gap-1 font-bold ${
            trendUp ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {trendUp ? (
            <TrendingUp className="w-3 h-3" aria-hidden="true" />
          ) : (
            <TrendingDown className="w-3 h-3" aria-hidden="true" />
          )}
          {first} → {last}
        </span>
      </div>
    </div>
  );
}

/**
 * Gauge circular SVG. Tamaño fijo 120x120; centra el score grande en el
 * medio y dibuja un arco proporcional al score con color band.
 */
function ScoreGauge({ score }: { score: number }) {
  const size = 140;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score));
  const offset = circumference - (progress / 100) * circumference;
  const color = scoreStrokeColor(progress);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      data-testid="data-confidence-gauge"
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span
          className={`text-3xl font-black tracking-tight ${scoreColorClass(progress)}`}
          data-testid="data-confidence-gauge-value"
        >
          {progress}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-secondary-token">
          de 100
        </span>
      </div>
    </div>
  );
}

/**
 * Barras horizontales por dominio. Cada barra muestra el dominio +
 * el score con su color band correspondiente.
 */
function DomainBars({
  domains,
}: {
  domains: Array<{ name: DataConfidenceDomain; score: number; detail: string }>;
}) {
  return (
    <ul className="space-y-2" data-testid="data-confidence-domains">
      {domains.map((d) => (
        <li
          key={d.name}
          className="flex flex-col gap-1"
          data-testid={`data-confidence-domain-${d.name}`}
        >
          <div className="flex justify-between text-xs">
            <span className="font-bold text-primary-token">{DOMAIN_LABELS[d.name]}</span>
            <span className={`font-mono ${scoreColorClass(d.score)}`}>
              {d.score}
            </span>
          </div>
          <div className="h-2 rounded-full bg-default-token/20 overflow-hidden">
            <div
              className={`h-full rounded-full ${scoreBgClass(d.score)}`}
              style={{
                width: `${Math.max(0, Math.min(100, d.score))}%`,
                backgroundColor: scoreStrokeColor(d.score),
              }}
            />
          </div>
          <div className="text-[11px] text-secondary-token italic">{d.detail}</div>
        </li>
      ))}
    </ul>
  );
}

export function DataConfidence() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { isAdmin } = useFirebase();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const snapshotResp = useDataConfidence(projectId);
  const recommendationsResp = useDataConfidenceRecommendations(projectId);

  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [locallyDismissed, setLocallyDismissed] = useState<Set<string>>(new Set());

  const snapshot = snapshotResp.data;
  const recommendations = recommendationsResp.data?.recommendations ?? [];

  const issuesShown: DataConfidenceIssue[] = useMemo(
    () =>
      (snapshot?.topIssues ?? []).filter(
        (i) => !locallyDismissed.has(i.id),
      ),
    [snapshot?.topIssues, locallyDismissed],
  );

  const handleDismiss = async (issueId: string) => {
    if (!projectId) return;
    setDismissingId(issueId);
    try {
      await dismissDataIssue(projectId, issueId);
      setLocallyDismissed((prev) => new Set(prev).add(issueId));
      // Soft refetch — the snapshot endpoint persists the dismissal so a
      // future load will hide the issue server-side too.
      snapshotResp.refetch?.();
    } catch (err) {
      logger.error('dataConfidence.dismiss.failed', err);
    } finally {
      setDismissingId(null);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="data-confidence-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Database className="w-12 h-12 mx-auto mb-4 text-violet-500" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('dataConfidence.page.title', 'Panel de Confianza de Datos')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'dataConfidence.page.selectProject',
              'Selecciona un proyecto para ver la calidad de los datos disponibles para IA.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="data-confidence-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <Database className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('dataConfidence.page.title', 'Panel de Confianza de Datos')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'dataConfidence.page.subtitle',
              'Calidad de los datos que la IA usa para sugerir y decidir. Si está baja, no confíes ciegamente en las recomendaciones.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="data-confidence-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {snapshotResp.loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="data-confidence-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {snapshotResp.error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="data-confidence-error"
          role="alert"
        >
          {t(
            'dataConfidence.page.error',
            'No se pudo cargar el panel: {{msg}}',
            { msg: snapshotResp.error.message },
          )}
        </div>
      )}

      {!snapshotResp.loading && !snapshotResp.error && snapshot && (
        <>
          {/* Gauge + per-domain bars */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-6 flex flex-col sm:flex-row gap-6"
            data-testid="data-confidence-summary"
          >
            <div className="flex flex-col items-center gap-2 shrink-0">
              <ScoreGauge score={snapshot.report.overallScore} />
              <span
                className={`text-xs font-bold uppercase tracking-widest ${scoreColorClass(snapshot.report.overallScore)}`}
                data-testid="data-confidence-level"
              >
                {snapshot.report.overallLevel === 'critical'
                  ? 'Crítico'
                  : snapshot.report.overallLevel === 'low'
                  ? 'Bajo'
                  : snapshot.report.overallLevel === 'medium'
                  ? 'Medio'
                  : 'Alto'}
              </span>
              {snapshot.report.redFlags.length > 0 && (
                <span
                  className="text-[11px] text-rose-600 dark:text-rose-400 font-bold"
                  data-testid="data-confidence-redflags-count"
                >
                  {snapshot.report.redFlags.length} bandera(s) roja(s)
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-token mb-2">
                {t('dataConfidence.domains.title', 'Calidad por dominio')}
              </h2>
              <DomainBars domains={snapshot.domains} />
            </div>
          </section>

          {/* Top issues */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-6"
            data-testid="data-confidence-issues-section"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-token mb-3 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 text-amber-500" aria-hidden="true" />
              {t('dataConfidence.issues.title', 'Top hallazgos')}
            </h2>
            {issuesShown.length === 0 ? (
              <div
                className="text-sm text-secondary-token italic flex items-center gap-2"
                data-testid="data-confidence-issues-empty"
              >
                <CheckCircle2 className="w-4 h-4 text-teal-500" aria-hidden="true" />
                {t(
                  'dataConfidence.issues.empty',
                  'Sin hallazgos críticos. Sigue alimentando los inventarios.',
                )}
              </div>
            ) : (
              <ul className="space-y-2" data-testid="data-confidence-issues-list">
                {issuesShown.map((issue) => {
                  const Icon = severityIcon(issue.severity);
                  return (
                    <li
                      key={issue.id}
                      className="flex items-center gap-3 rounded-xl border border-default-token bg-default-token/5 p-3"
                      data-testid={`data-confidence-issue-${issue.id}`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${severityColorClass(issue.severity)}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs font-bold">
                          <span className={severityColorClass(issue.severity)}>
                            {severityLabel(issue.severity)}
                          </span>
                          <span className="text-secondary-token">·</span>
                          <span className="text-secondary-token">{issue.collection}</span>
                          <span className="text-secondary-token">·</span>
                          <span className="font-mono text-primary-token">
                            {issue.count}
                          </span>
                        </div>
                        <div className="text-sm text-primary-token">{issue.description}</div>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void handleDismiss(issue.id)}
                          disabled={dismissingId === issue.id}
                          className="shrink-0 text-xs px-2 py-1 rounded-lg border border-default-token text-secondary-token hover:bg-default-token/10 disabled:opacity-50 flex items-center gap-1"
                          data-testid={`data-confidence-dismiss-${issue.id}`}
                          aria-label={`Descartar ${issue.id}`}
                        >
                          <X className="w-3 h-3" aria-hidden="true" />
                          {dismissingId === issue.id
                            ? t('common.dismissing', 'Descartando…')
                            : t('common.dismiss', 'Descartar')}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Recommendations */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-6"
            data-testid="data-confidence-recos-section"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-token mb-3 flex items-center gap-2">
              <Lightbulb className="w-3 h-3 text-amber-500" aria-hidden="true" />
              {t('dataConfidence.recommendations.title', 'Recomendaciones accionables')}
            </h2>
            {recommendationsResp.loading ? (
              <div
                className="text-sm text-secondary-token italic"
                data-testid="data-confidence-recos-loading"
              >
                {t('common.loading', 'Cargando…')}
              </div>
            ) : recommendations.length === 0 ? (
              <div
                className="text-sm text-secondary-token italic flex items-center gap-2"
                data-testid="data-confidence-recos-empty"
              >
                <CheckCircle2 className="w-4 h-4 text-teal-500" aria-hidden="true" />
                {t(
                  'dataConfidence.recommendations.empty',
                  'No hay mejoras pendientes. Los datos están en buen estado.',
                )}
              </div>
            ) : (
              <ul
                className="grid gap-2 sm:grid-cols-2"
                data-testid="data-confidence-recos-list"
              >
                {recommendations.map((reco) => (
                  <li
                    key={reco.id}
                    className={`rounded-xl border p-3 ${priorityColorClass(reco.priority)}`}
                    data-testid={`data-confidence-reco-${reco.id}`}
                  >
                    <div className="text-xs font-bold uppercase tracking-widest text-secondary-token">
                      {DOMAIN_LABELS[reco.domain]} ·{' '}
                      <span
                        className={
                          reco.priority === 'high'
                            ? 'text-rose-600 dark:text-rose-400'
                            : reco.priority === 'medium'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-blue-600 dark:text-blue-400'
                        }
                      >
                        {reco.priority === 'high'
                          ? 'Alta'
                          : reco.priority === 'medium'
                          ? 'Media'
                          : 'Baja'}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-bold text-primary-token">
                      Mejora: {reco.title}
                    </div>
                    <div className="text-xs text-secondary-token">{reco.action}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Trend */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-4 sm:p-6"
            data-testid="data-confidence-trend-section"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-token mb-3">
              {t(
                'dataConfidence.trend.title',
                'Evolución últimos 30 días',
              )}
            </h2>
            <Sparkline points={snapshot.trend} />
          </section>
        </>
      )}
    </div>
  );
}

export default DataConfidence;
