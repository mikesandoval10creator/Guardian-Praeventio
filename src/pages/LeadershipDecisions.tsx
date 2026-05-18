// Praeventio Guard — Sprint K §276-277 page wrapper.
//
// Bitácora de Decisiones de Supervisión + Ranking de Impacto. Cierra la
// pieza UI del flujo §276-277 que ya tenía servicio determinístico
// (`supervisionDecisionTrail.ts`) + componente
// (`LeadershipTrailCard.tsx`) pero no estaba accesible desde la
// navegación: el liderazgo preventivo quedaba sin registro estructurado
// aunque el motor de scoring estuviera listo.
//
// Esta página:
//   1. Tab "Bitácora" — lee `useLeadershipDecisions(projectId)` filtrado
//      por supervisor + período. Cada decisión es una card con badge de
//      tipo (color por kind), score determinístico de impacto, contexto
//      libre y fecha.
//   2. Tab "Ranking" — lee `useLeadershipRanking(projectId, period)`.
//      Lista supervisores ordenada por `totalImpactScore` desc con
//      cumulative score color-coded + decision count + % outcome
//      positivo (trend qualitativo).
//   3. CTA "Registrar decisión" → modal con selector de kind, contexto
//      y razón; el supervisorUid lo deriva el server desde el token
//      (NUNCA del body — patrón AUDIT-grade igual que F.15 PR #319).
//
// NO castiga. Honra al supervisor que toma decisiones preventivas de
// alto valor (stop_task, reject_unsafe, escalate_finding) por sobre
// las administrativas (authorize_work). El doc usuario §276-277
// describe explícitamente este criterio.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Compass,
  WifiOff,
  Plus,
  X,
  TrendingUp,
  CheckCircle2,
  History,
  Trophy,
  Award,
  AlertCircle,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  useLeadershipDecisions,
  useLeadershipRanking,
  recordLeadershipDecision,
  type LeadershipPeriod,
} from '../hooks/useLeadership';
import type {
  SupervisionDecision,
  SupervisionDecisionKind,
} from '../services/leadership/supervisionDecisionTrail';
import { scoreDecisionImpact } from '../services/leadership/supervisionDecisionTrail';
import { logger } from '../utils/logger';

// ────────────────────────────────────────────────────────────────────────
// Static visual helpers
// ────────────────────────────────────────────────────────────────────────
//
// KIND_META: paleta consistente con el doc §276-277. Decisiones que
// detienen riesgo activo (stop_task, reject_unsafe) usan teal/rose para
// destacar su valor preventivo; las administrativas usan tonos neutros.

const KIND_META: Record<
  SupervisionDecisionKind,
  { label: string; color: string; bg: string; border: string }
> = {
  stop_task: {
    label: 'Detuvo tarea',
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
  },
  reject_unsafe: {
    label: 'Rechazó condición insegura',
    color: 'text-rose-600',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
  },
  reject_exception: {
    label: 'Rechazó excepción',
    color: 'text-amber-600',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
  },
  escalate_finding: {
    label: 'Escaló hallazgo',
    color: 'text-violet-600',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
  },
  change_method: {
    label: 'Cambió método',
    color: 'text-teal-600',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
  },
  change_crew: {
    label: 'Cambió cuadrilla',
    color: 'text-teal-600',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
  },
  request_resource: {
    label: 'Solicitó recurso',
    color: 'text-blue-600',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
  },
  authorize_work: {
    label: 'Autorizó trabajo',
    color: 'text-zinc-600',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/30',
  },
  approve_exception: {
    label: 'Aprobó excepción',
    color: 'text-zinc-600',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/30',
  },
};

const KIND_OPTIONS: SupervisionDecisionKind[] = [
  'stop_task',
  'reject_unsafe',
  'reject_exception',
  'escalate_finding',
  'change_method',
  'change_crew',
  'request_resource',
  'approve_exception',
  'authorize_work',
];

const PERIOD_OPTIONS: { value: LeadershipPeriod; label: string }[] = [
  { value: '30d', label: '30 días' },
  { value: '90d', label: '90 días' },
  { value: 'all', label: 'Todo' },
];

/**
 * Color-coded impact band for the ranking tab. Higher scores honor the
 * supervisor's preventive contribution. Bands are conservative — a
 * single `reject_unsafe` (=30) lands you in the "alto" band already,
 * which is the intended signal.
 */
function impactBandClass(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 40) return 'text-teal-600 dark:text-teal-400';
  if (score >= 15) return 'text-amber-600 dark:text-amber-400';
  return 'text-zinc-500';
}

function formatDecisionDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function LeadershipDecisions() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [activeTab, setActiveTab] = useState<'bitacora' | 'ranking'>('bitacora');
  const [supervisorFilter, setSupervisorFilter] = useState<string>('');
  const [period, setPeriod] = useState<LeadershipPeriod>('90d');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const decisionsResp = useLeadershipDecisions(projectId, {
    supervisorUid: supervisorFilter.trim() || undefined,
    period,
  });
  const rankingResp = useLeadershipRanking(projectId, period);

  const decisions: SupervisionDecision[] = useMemo(
    () => decisionsResp.data?.decisions ?? [],
    [decisionsResp.data],
  );
  const ranking = useMemo(
    () => rankingResp.data?.ranking ?? [],
    [rankingResp.data],
  );

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="leadership-decisions-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Compass
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t(
              'leadershipDecisions.page.title',
              'Decisiones de Supervisión',
            )}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'leadershipDecisions.page.selectProject',
              'Selecciona un proyecto para ver la bitácora y el ranking de impacto.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="leadership-decisions-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
          <Compass className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t(
              'leadershipDecisions.page.title',
              'Decisiones de Supervisión',
            )}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'leadershipDecisions.page.subtitle',
              'Bitácora §276 + ranking de impacto §277 — liderazgo preventivo trazable.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="leadership-decisions-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-600"
          data-testid="leadership-decisions-new-button"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('leadershipDecisions.action.new', 'Registrar decisión')}
        </button>
      </header>

      {/* Tabs */}
      <div
        role="tablist"
        className="flex gap-1 border-b border-default-token"
        data-testid="leadership-decisions-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'bitacora'}
          onClick={() => setActiveTab('bitacora')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
            activeTab === 'bitacora'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-secondary-token hover:text-primary-token'
          }`}
          data-testid="leadership-decisions-tab-bitacora"
        >
          <History className="w-4 h-4" aria-hidden="true" />
          {t('leadershipDecisions.tab.bitacora', 'Bitácora')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ranking'}
          onClick={() => setActiveTab('ranking')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
            activeTab === 'ranking'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-secondary-token hover:text-primary-token'
          }`}
          data-testid="leadership-decisions-tab-ranking"
        >
          <Trophy className="w-4 h-4" aria-hidden="true" />
          {t('leadershipDecisions.tab.ranking', 'Ranking')}
        </button>
      </div>

      {/* Period filter — visible on both tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase font-bold text-secondary-token">
          {t('leadershipDecisions.filter.period', 'Período:')}
        </span>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
              period === opt.value
                ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'border-default-token text-secondary-token hover:text-primary-token'
            }`}
            data-testid={`leadership-decisions-period-${opt.value}`}
          >
            {opt.label}
          </button>
        ))}
        {activeTab === 'bitacora' && (
          <label className="ml-auto flex items-center gap-2 text-xs">
            <span className="uppercase font-bold text-secondary-token">
              {t('leadershipDecisions.filter.supervisor', 'Supervisor UID:')}
            </span>
            <input
              type="text"
              value={supervisorFilter}
              onChange={(e) => setSupervisorFilter(e.target.value)}
              placeholder="uid_supervisor"
              className="rounded-md border border-default-token bg-surface px-2 py-1 text-xs"
              data-testid="leadership-decisions-supervisor-input"
            />
          </label>
        )}
      </div>

      {/* Bitácora tab */}
      {activeTab === 'bitacora' && (
        <section
          aria-label="Bitácora"
          data-testid="leadership-decisions-bitacora-section"
        >
          {decisionsResp.loading && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
              data-testid="leadership-decisions-loading"
            >
              {t('common.loading', 'Cargando…')}
            </div>
          )}

          {decisionsResp.error && (
            <div
              className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
              data-testid="leadership-decisions-error"
              role="alert"
            >
              {t(
                'leadershipDecisions.error',
                'No se pudieron cargar las decisiones: {{msg}}',
                { msg: decisionsResp.error.message },
              )}
            </div>
          )}

          {!decisionsResp.loading &&
            !decisionsResp.error &&
            decisions.length === 0 && (
              <div
                className="rounded-2xl border border-default-token bg-surface p-8 text-center"
                data-testid="leadership-decisions-empty"
              >
                <Compass
                  className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                  aria-hidden="true"
                />
                <p className="text-sm text-secondary-token italic">
                  {t(
                    'leadershipDecisions.empty',
                    'Aún no hay decisiones registradas en este período.',
                  )}
                </p>
              </div>
            )}

          {!decisionsResp.loading &&
            !decisionsResp.error &&
            decisions.length > 0 && (
              <ul
                className="space-y-2"
                data-testid="leadership-decisions-list"
              >
                {decisions.map((d) => {
                  const meta = KIND_META[d.kind];
                  const impact = scoreDecisionImpact(d);
                  return (
                    <li
                      key={d.id}
                      className={`rounded-xl border bg-surface p-3 shadow-mode ${meta.border}`}
                      data-testid={`leadership-decision-${d.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${meta.color} ${meta.bg} ${meta.border}`}
                          data-testid={`leadership-decision-kind-${d.id}`}
                        >
                          {meta.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-primary-token">
                            {d.context}
                          </p>
                          {d.rationale && (
                            <p className="mt-1 text-xs text-secondary-token">
                              {d.rationale}
                            </p>
                          )}
                          <p className="mt-2 text-[10px] uppercase tracking-wide text-secondary-token">
                            {t('leadershipDecisions.card.supervisor', 'Supervisor')}: {d.supervisorUid} ·{' '}
                            {formatDecisionDate(d.decidedAt)}
                          </p>
                          {d.outcome && (
                            <p
                              className={`mt-1 inline-flex items-center gap-1 text-[11px] font-bold ${d.outcome.positive ? 'text-emerald-600' : 'text-rose-600'}`}
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              {d.outcome.description}
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 text-right font-mono text-base font-black tabular-nums ${impactBandClass(impact.totalScore)}`}
                          data-testid={`leadership-decision-score-${d.id}`}
                          aria-label={t('leadershipDecisions.card.impact', 'Impacto') as string}
                        >
                          {impact.totalScore}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
      )}

      {/* Ranking tab */}
      {activeTab === 'ranking' && (
        <section
          aria-label="Ranking"
          data-testid="leadership-decisions-ranking-section"
        >
          {rankingResp.loading && (
            <div
              className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
              data-testid="leadership-ranking-loading"
            >
              {t('common.loading', 'Cargando…')}
            </div>
          )}

          {rankingResp.error && (
            <div
              className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
              data-testid="leadership-ranking-error"
              role="alert"
            >
              {t(
                'leadershipDecisions.ranking.error',
                'No se pudo cargar el ranking: {{msg}}',
                { msg: rankingResp.error.message },
              )}
            </div>
          )}

          {!rankingResp.loading &&
            !rankingResp.error &&
            ranking.length === 0 && (
              <div
                className="rounded-2xl border border-default-token bg-surface p-8 text-center"
                data-testid="leadership-ranking-empty"
              >
                <Trophy
                  className="w-10 h-10 mx-auto mb-3 text-secondary-token"
                  aria-hidden="true"
                />
                <p className="text-sm text-secondary-token italic">
                  {t(
                    'leadershipDecisions.ranking.empty',
                    'No hay decisiones registradas en este período para ranquear.',
                  )}
                </p>
              </div>
            )}

          {!rankingResp.loading &&
            !rankingResp.error &&
            ranking.length > 0 && (
              <ol
                className="space-y-2"
                data-testid="leadership-ranking-list"
              >
                {ranking.map((r, idx) => (
                  <li
                    key={r.supervisorUid}
                    className="flex items-start gap-3 rounded-xl border border-default-token bg-surface p-3 shadow-mode"
                    data-testid={`leadership-ranking-${r.supervisorUid}`}
                  >
                    <span
                      className="shrink-0 w-8 h-8 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center text-sm font-black tabular-nums"
                      aria-label={`Posición ${idx + 1}`}
                    >
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-primary-token truncate">
                        {r.supervisorUid}
                      </p>
                      <p className="text-[11px] text-secondary-token">
                        {r.totalDecisions} {t('leadershipDecisions.ranking.decisions', 'decisiones')} ·{' '}
                        {t('leadershipDecisions.ranking.positiveOutcome', '% positivo')}: {r.positiveOutcomeRate}%
                      </p>
                      {r.positiveOutcomeRate >= 70 && (
                        <p
                          className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600"
                          data-testid={`leadership-ranking-trend-${r.supervisorUid}`}
                        >
                          <TrendingUp className="w-3 h-3" aria-hidden="true" />
                          {t(
                            'leadershipDecisions.ranking.trendUp',
                            'Tendencia positiva',
                          )}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-mono text-xl font-black tabular-nums ${impactBandClass(r.totalImpactScore)}`}
                        data-testid={`leadership-ranking-score-${r.supervisorUid}`}
                      >
                        {r.totalImpactScore}
                      </p>
                      <p className="text-[9px] uppercase text-secondary-token">
                        {t('leadershipDecisions.ranking.impact', 'Impacto')}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
        </section>
      )}

      {showCreateModal && projectId && (
        <RecordDecisionModal
          projectId={projectId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            decisionsResp.refetch?.();
            rankingResp.refetch?.();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Inline modal: registrar nueva decisión
// ────────────────────────────────────────────────────────────────────────
//
// Modal mínimo: selector de kind + contexto (textarea) + razón
// (textarea). No pide supervisorUid porque el server lo deriva del
// token (patrón AUDIT-grade — ver doc en endpoint).

interface RecordDecisionModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function RecordDecisionModal({
  projectId,
  onClose,
  onSuccess,
}: RecordDecisionModalProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SupervisionDecisionKind>('stop_task');
  const [context, setContext] = useState('');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (context.trim().length < 3) {
      setError(
        t(
          'leadershipDecisions.modal.errorContext',
          'El contexto debe tener al menos 3 caracteres.',
        ) as string,
      );
      return;
    }
    if (rationale.trim().length < 3) {
      setError(
        t(
          'leadershipDecisions.modal.errorRationale',
          'La razón debe tener al menos 3 caracteres.',
        ) as string,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await recordLeadershipDecision(projectId, {
        kind,
        context: context.trim(),
        rationale: rationale.trim(),
      });
      logger.info('leadership.decision.recorded', { projectId, kind });
      onSuccess();
    } catch (err) {
      logger.error('leadership.decision.record.failed', err);
      setError(
        (err as Error).message ||
          (t(
            'leadershipDecisions.modal.errorSubmit',
            'No se pudo registrar la decisión.',
          ) as string),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="leadership-decisions-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-default-token bg-surface p-5 shadow-2xl space-y-4">
        <header className="flex items-center gap-2">
          <Award className="w-5 h-5 text-blue-500" aria-hidden="true" />
          <h2 className="flex-1 text-base font-black text-primary-token">
            {t('leadershipDecisions.modal.title', 'Registrar decisión')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-secondary-token hover:text-primary-token"
            aria-label={t('common.close', 'Cerrar') as string}
            data-testid="leadership-decisions-modal-close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('leadershipDecisions.modal.kind', 'Tipo de decisión')}
            </span>
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as SupervisionDecisionKind)
              }
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="leadership-decisions-modal-kind"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('leadershipDecisions.modal.context', 'Contexto')}
            </span>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              placeholder={
                t(
                  'leadershipDecisions.modal.contextPlaceholder',
                  'Ej: Cuadrilla A en zona ZA-12, andamio sin certificación visible.',
                ) as string
              }
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="leadership-decisions-modal-context"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase text-secondary-token mb-1">
              {t('leadershipDecisions.modal.rationale', 'Razón')}
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              placeholder={
                t(
                  'leadershipDecisions.modal.rationalePlaceholder',
                  'Ej: Riesgo de caída a desnivel; suspendido hasta inspección.',
                ) as string
              }
              className="w-full rounded-md border border-default-token bg-surface px-2 py-1.5 text-sm"
              data-testid="leadership-decisions-modal-rationale"
            />
          </label>
        </div>

        {error && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-600 dark:text-rose-400"
            data-testid="leadership-decisions-modal-error"
            role="alert"
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-bold text-secondary-token hover:text-primary-token"
            data-testid="leadership-decisions-modal-cancel"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="leadership-decisions-modal-submit"
          >
            {submitting
              ? t('common.submitting', 'Guardando…')
              : t('leadershipDecisions.modal.submit', 'Registrar')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LeadershipDecisions;
