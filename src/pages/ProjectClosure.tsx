// Praeventio Guard — Sprint K §131-138 page wrapper.
//
// Cierre de Proyecto + Lecciones Transferibles + Decisiones Críticas +
// Resúmenes Multi-Rol. Hace navegable el motor determinístico que vive
// en `services/projectClosure/projectClosureService.ts`.
//
// Cuando un proyecto cierra, su data NO desaparece — extrae:
//   - Lecciones transferibles (publicadas al library F.12 con scope='industry')
//   - Decisiones críticas con outcome retroactivo
//   - Resúmenes multi-rol (worker/supervisor/gerencia)
//   - Pendientes que bloquean cierre formal (incidentes/acciones/permisos)
//
// "Cerrar formalmente" requiere readiness=100% y rol admin. El motor
// (validateClosureReadiness) determina el porcentaje de readiness.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  useClosureStatus,
  useClosureSummary,
  initiateClosure,
  captureLesson,
  logDecision,
  finalizeClosure,
  type ClosureRole,
} from '../hooks/useProjectClosure';
import { ProjectClosureCard } from '../components/projectClosure/ProjectClosureCard';
import { SpofPanel } from '../components/continuity/SpofPanel';
import { useContinuityInput } from '../hooks/useContinuityInput';
import type {
  ClosureContext,
  ProjectClosureSnapshot,
} from '../services/projectClosure/projectClosureService';
import { logger } from '../utils/logger';

function readinessTone(percent: number): string {
  if (percent >= 100) return 'text-emerald-500';
  if (percent >= 75) return 'text-teal-500';
  if (percent >= 50) return 'text-amber-500';
  return 'text-rose-500';
}

export function ProjectClosure() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const { isAdmin } = useFirebase();
  const projectId = selectedProject?.id ?? null;

  const statusResp = useClosureStatus(projectId);
  const [role, setRole] = useState<ClosureRole>('gerencia');
  const summaryResp = useClosureSummary(projectId, role);
  const continuityState = useContinuityInput(projectId);

  // Local capture form state.
  const [lessonSummary, setLessonSummary] = useState('');
  const [lessonAction, setLessonAction] = useState('');
  const [lessonIndustry, setLessonIndustry] = useState('construccion');

  const [decisionContext, setDecisionContext] = useState('');
  const [decisionText, setDecisionText] = useState('');
  const [decisionOutcome, setDecisionOutcome] = useState<
    'positive' | 'neutral' | 'negative'
  >('positive');

  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refreshAll = useCallback(() => {
    statusResp.refetch?.();
    summaryResp.refetch?.();
  }, [statusResp, summaryResp]);

  const handleInitiate = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await initiateClosure(projectId);
      setActionMessage(
        t('closure.action.initiated', 'Proceso de cierre iniciado.'),
      );
      refreshAll();
    } catch (err) {
      logger.error('closure.initiate.failed', err);
      setActionMessage(
        t('closure.action.error', 'No se pudo completar la acción.'),
      );
    } finally {
      setBusy(false);
    }
  }, [projectId, refreshAll, t]);

  const handleCaptureLesson = useCallback(async () => {
    if (!projectId) return;
    if (lessonSummary.trim().length < 5 || lessonAction.trim().length < 5) {
      setActionMessage(
        t(
          'closure.lesson.invalid',
          'Resumen y acción preventiva deben tener al menos 5 caracteres.',
        ),
      );
      return;
    }
    setBusy(true);
    try {
      await captureLesson(projectId, {
        summary: lessonSummary,
        preventiveAction: lessonAction,
        industry: lessonIndustry || 'general',
      });
      setLessonSummary('');
      setLessonAction('');
      setActionMessage(
        t(
          'closure.lesson.captured',
          'Lección capturada y publicada en la biblioteca.',
        ),
      );
      refreshAll();
    } catch (err) {
      logger.error('closure.lesson.failed', err);
      setActionMessage(
        t('closure.action.error', 'No se pudo completar la acción.'),
      );
    } finally {
      setBusy(false);
    }
  }, [projectId, lessonSummary, lessonAction, lessonIndustry, refreshAll, t]);

  const handleLogDecision = useCallback(async () => {
    if (!projectId) return;
    if (decisionContext.trim().length < 5 || decisionText.trim().length < 5) {
      setActionMessage(
        t(
          'closure.decision.invalid',
          'Contexto y decisión deben tener al menos 5 caracteres.',
        ),
      );
      return;
    }
    setBusy(true);
    try {
      await logDecision(projectId, {
        decidedAt: new Date().toISOString(),
        context: decisionContext,
        decision: decisionText,
        outcome: decisionOutcome,
      });
      setDecisionContext('');
      setDecisionText('');
      setActionMessage(t('closure.decision.logged', 'Decisión registrada.'));
      refreshAll();
    } catch (err) {
      logger.error('closure.decision.failed', err);
      setActionMessage(
        t('closure.action.error', 'No se pudo completar la acción.'),
      );
    } finally {
      setBusy(false);
    }
  }, [projectId, decisionContext, decisionText, decisionOutcome, refreshAll, t]);

  const handleFinalize = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await finalizeClosure(projectId);
      setActionMessage(
        t(
          'closure.action.finalized',
          'Proyecto cerrado formalmente. Datos retenidos para auditoría.',
        ),
      );
      refreshAll();
    } catch (err) {
      logger.error('closure.finalize.failed', err);
      setActionMessage(
        t(
          'closure.action.error',
          'No se pudo completar la acción.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [projectId, refreshAll, t]);

  // ── ProjectClosureCard (compact at-a-glance) props ──────────────────────
  // Re-derives the readiness verdict deterministically (validateClosure
  // Readiness) from the SAME real server-computed pending counts the page
  // already renders, and adds the audience-switchable summary preview
  // (management/client/operations/regulatory) the per-role view above lacks.
  // No fabricated data: snapshot metrics with no closure data source
  // (compliance score, training hours, sitebook, prevented incidents,
  // actions completed) stay 0 — exactly what the server itself passes to
  // buildSummary (projectClosure.ts) for these unsourced fields.
  // NOTE: declared before any early return so hook order stays stable.
  const closureStatusData = statusResp.data;
  const closureCounts = summaryResp.data?.counts;
  const closureCardContext = useMemo<ClosureContext | null>(() => {
    if (!closureStatusData) return null;
    return {
      pendingOpenIncidents: closureStatusData.pending.openIncidents,
      pendingOpenActions: closureStatusData.pending.openActions,
      pendingOpenPermits: closureStatusData.pending.openPermits,
      hasFinalReport: closureStatusData.state.status === 'finalized',
      unconfirmedSpofs: 0,
    };
  }, [closureStatusData]);

  const closureCardSnapshot = useMemo<ProjectClosureSnapshot | null>(() => {
    if (!closureStatusData) return null;
    const st = closureStatusData.state;
    return {
      projectId: projectId ?? '',
      closedAt: st.finalizedAt ?? st.initiatedAt ?? '',
      closedByUid: st.finalizedByUid ?? st.initiatedByUid ?? '',
      totalIncidents: closureCounts?.incidents ?? 0,
      criticalIncidents: closureCounts?.criticalIncidents ?? 0,
      preventedIncidentsEstimated: 0,
      totalActionsCompleted: 0,
      totalSitebookEntries: 0,
      totalTrainingHours: 0,
      averageComplianceScore: 0,
      criticalDecisions: [],
      transferableLessons: Array.from(
        { length: closureCounts?.lessons ?? 0 },
        () => ({}) as ProjectClosureSnapshot['transferableLessons'][number],
      ),
      retentionRecommendations: [],
      improvementOpportunities: [],
    };
  }, [closureStatusData, closureCounts, projectId]);

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="project-closure-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Briefcase
            className="w-12 h-12 mx-auto mb-4 text-violet-500"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('closure.page.title', 'Cierre de Proyecto')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'closure.page.selectProject',
              'Selecciona un proyecto para iniciar el cierre formal.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const loading = statusResp.loading || summaryResp.loading;
  const error = statusResp.error || summaryResp.error;
  const data = statusResp.data;
  const summary = summaryResp.data?.summary;
  const counts = summaryResp.data?.counts;
  const readiness = data?.readinessPercent ?? 0;
  const isFinalized = data?.state.status === 'finalized';
  const isInitiated = data?.state.status === 'initiated' || isFinalized;

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="project-closure-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <Briefcase className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('closure.page.title', 'Cierre de Proyecto')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'closure.page.subtitle',
              '§131-138 — Lecciones transferibles + decisiones críticas + resúmenes multi-rol.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="project-closure-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="project-closure-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="project-closure-error"
          role="alert"
        >
          {t('closure.page.error', 'No se pudo cargar el cierre: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Readiness gauge */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-6"
            data-testid="project-closure-readiness"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-secondary-token">
                  {t('closure.readiness.label', 'Listo para cierre')}
                </p>
                <p
                  className={`text-5xl font-black ${readinessTone(readiness)}`}
                  data-testid="project-closure-readiness-percent"
                >
                  {readiness}%
                </p>
                <p className="mt-1 text-xs text-secondary-token">
                  {isFinalized
                    ? t(
                        'closure.state.finalized',
                        'Cerrado formalmente el {{at}}.',
                        { at: data.state.finalizedAt ?? '—' },
                      )
                    : isInitiated
                      ? t(
                          'closure.state.initiated',
                          'Proceso de cierre iniciado.',
                        )
                      : t('closure.state.open', 'Proceso de cierre no iniciado.')}
                </p>
              </div>
              <div className="flex flex-col gap-2 items-end">
                {!isInitiated && (
                  <button
                    type="button"
                    onClick={handleInitiate}
                    disabled={busy}
                    className="px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-bold uppercase tracking-wide hover:bg-violet-600 disabled:opacity-50"
                    data-testid="project-closure-initiate-btn"
                  >
                    {t('closure.action.initiate', 'Iniciar cierre')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleFinalize}
                  disabled={busy || !data.canClose || !isAdmin || isFinalized}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-bold uppercase tracking-wide hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="project-closure-finalize-btn"
                  title={
                    !isAdmin
                      ? t(
                          'closure.action.adminOnly',
                          'Solo administradores pueden cerrar formalmente.',
                        )
                      : !data.canClose
                        ? t(
                            'closure.action.blocked',
                            'Resolver los bloqueadores primero.',
                          )
                        : undefined
                  }
                >
                  {t('closure.action.finalize', 'Cerrar formalmente')}
                </button>
              </div>
            </div>
            {actionMessage && (
              <p
                className="mt-3 text-xs text-secondary-token"
                data-testid="project-closure-action-message"
              >
                {actionMessage}
              </p>
            )}
          </section>

          {/* Compact at-a-glance closure card (audience-switchable preview) */}
          {closureCardContext && closureCardSnapshot && (
            <ProjectClosureCard
              context={closureCardContext}
              snapshot={closureCardSnapshot}
            />
          )}

          {/* Pendientes */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-6"
            data-testid="project-closure-pending"
          >
            <h2 className="text-sm font-black uppercase tracking-wide text-primary-token mb-3">
              {t('closure.pending.title', 'Pendientes que bloquean cierre')}
            </h2>
            {data.blockers.length === 0 && data.warnings.length === 0 ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                {t(
                  'closure.pending.empty',
                  'Sin bloqueadores ni advertencias.',
                )}
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.blockers.map((b, i) => (
                  <li
                    key={`b-${i}`}
                    className="flex items-start gap-2 text-rose-600 dark:text-rose-400"
                  >
                    <span aria-hidden="true">●</span>
                    <span>{b}</span>
                  </li>
                ))}
                {data.warnings.map((w, i) => (
                  <li
                    key={`w-${i}`}
                    className="flex items-start gap-2 text-amber-600 dark:text-amber-400"
                  >
                    <span aria-hidden="true">○</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl bg-surface-token border border-default-token p-3">
                <dt className="text-secondary-token uppercase tracking-widest">
                  {t('closure.pending.incidents', 'Incidentes abiertos')}
                </dt>
                <dd className="text-lg font-bold text-primary-token">
                  {data.pending.openIncidents}
                </dd>
              </div>
              <div className="rounded-xl bg-surface-token border border-default-token p-3">
                <dt className="text-secondary-token uppercase tracking-widest">
                  {t('closure.pending.actions', 'Acciones abiertas')}
                </dt>
                <dd className="text-lg font-bold text-primary-token">
                  {data.pending.openActions}
                </dd>
              </div>
              <div className="rounded-xl bg-surface-token border border-default-token p-3">
                <dt className="text-secondary-token uppercase tracking-widest">
                  {t('closure.pending.permits', 'Permisos activos')}
                </dt>
                <dd className="text-lg font-bold text-primary-token">
                  {data.pending.openPermits}
                </dd>
              </div>
              <div className="rounded-xl bg-surface-token border border-default-token p-3">
                <dt className="text-secondary-token uppercase tracking-widest">
                  {t('closure.pending.lessons', 'Lecciones capturadas')}
                </dt>
                <dd className="text-lg font-bold text-primary-token">
                  {data.pending.lessonsCaptured}
                </dd>
              </div>
              <div className="rounded-xl bg-surface-token border border-default-token p-3">
                <dt className="text-secondary-token uppercase tracking-widest">
                  {t('closure.pending.decisions', 'Decisiones registradas')}
                </dt>
                <dd className="text-lg font-bold text-primary-token">
                  {data.pending.decisionsLogged}
                </dd>
              </div>
            </dl>
          </section>

          {/* SPOFs — Puntos Únicos de Falla */}
          <SpofPanel input={continuityState.input} />

          {/* Lecciones transferibles */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-6"
            data-testid="project-closure-lessons"
          >
            <h2 className="text-sm font-black uppercase tracking-wide text-primary-token mb-3">
              {t(
                'closure.lessons.title',
                'Lecciones transferibles a futuros proyectos',
              )}
            </h2>
            <p className="text-xs text-secondary-token mb-3">
              {t(
                'closure.lessons.help',
                'Las lecciones capturadas se publican al library F.12 con scope industria para que otros proyectos las descubran.',
              )}
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-widest text-secondary-token">
                {t('closure.lessons.summary', 'Resumen de la lección')}
                <textarea
                  value={lessonSummary}
                  onChange={(e) => setLessonSummary(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-default-token bg-surface-token p-2 text-sm normal-case font-normal text-primary-token tracking-normal"
                  data-testid="project-closure-lesson-summary"
                  disabled={busy || isFinalized}
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-widest text-secondary-token">
                {t('closure.lessons.action', 'Acción preventiva derivada')}
                <textarea
                  value={lessonAction}
                  onChange={(e) => setLessonAction(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-default-token bg-surface-token p-2 text-sm normal-case font-normal text-primary-token tracking-normal"
                  data-testid="project-closure-lesson-action"
                  disabled={busy || isFinalized}
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-widest text-secondary-token">
                {t('closure.lessons.industry', 'Industria')}
                <input
                  type="text"
                  value={lessonIndustry}
                  onChange={(e) => setLessonIndustry(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-default-token bg-surface-token p-2 text-sm normal-case font-normal text-primary-token tracking-normal"
                  data-testid="project-closure-lesson-industry"
                  disabled={busy || isFinalized}
                />
              </label>
              <button
                type="button"
                onClick={handleCaptureLesson}
                disabled={busy || isFinalized}
                className="px-4 py-2 rounded-xl bg-violet-500 text-white text-xs font-bold uppercase tracking-wide hover:bg-violet-600 disabled:opacity-50"
                data-testid="project-closure-lesson-submit"
              >
                {t('closure.lessons.submit', 'Capturar lección')}
              </button>
            </div>
          </section>

          {/* Decisiones críticas */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-6"
            data-testid="project-closure-decisions"
          >
            <h2 className="text-sm font-black uppercase tracking-wide text-primary-token mb-3">
              {t('closure.decisions.title', 'Decisiones críticas del proyecto')}
            </h2>
            <p className="text-xs text-secondary-token mb-3">
              {t(
                'closure.decisions.help',
                'Registra decisiones que marcaron el resultado del proyecto y su outcome retroactivo.',
              )}
            </p>
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-widest text-secondary-token">
                {t('closure.decisions.context', 'Contexto')}
                <textarea
                  value={decisionContext}
                  onChange={(e) => setDecisionContext(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-default-token bg-surface-token p-2 text-sm normal-case font-normal text-primary-token tracking-normal"
                  data-testid="project-closure-decision-context"
                  disabled={busy || isFinalized}
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-widest text-secondary-token">
                {t('closure.decisions.decision', 'Decisión tomada')}
                <textarea
                  value={decisionText}
                  onChange={(e) => setDecisionText(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-default-token bg-surface-token p-2 text-sm normal-case font-normal text-primary-token tracking-normal"
                  data-testid="project-closure-decision-text"
                  disabled={busy || isFinalized}
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-widest text-secondary-token">
                {t('closure.decisions.outcome', 'Outcome retroactivo')}
                <select
                  value={decisionOutcome}
                  onChange={(e) =>
                    setDecisionOutcome(
                      e.target.value as 'positive' | 'neutral' | 'negative',
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-default-token bg-surface-token p-2 text-sm normal-case font-normal text-primary-token tracking-normal"
                  data-testid="project-closure-decision-outcome"
                  disabled={busy || isFinalized}
                >
                  <option value="positive">
                    {t('closure.decisions.positive', 'Positivo')}
                  </option>
                  <option value="neutral">
                    {t('closure.decisions.neutral', 'Neutral')}
                  </option>
                  <option value="negative">
                    {t('closure.decisions.negative', 'Negativo')}
                  </option>
                </select>
              </label>
              <button
                type="button"
                onClick={handleLogDecision}
                disabled={busy || isFinalized}
                className="px-4 py-2 rounded-xl bg-violet-500 text-white text-xs font-bold uppercase tracking-wide hover:bg-violet-600 disabled:opacity-50"
                data-testid="project-closure-decision-submit"
              >
                {t('closure.decisions.submit', 'Registrar decisión')}
              </button>
            </div>
          </section>

          {/* Resúmenes multi-rol */}
          <section
            className="rounded-2xl border border-default-token bg-surface p-6"
            data-testid="project-closure-summary"
          >
            <div className="flex items-center justify-between gap-4 mb-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-primary-token">
                {t('closure.summary.title', 'Resumen multi-rol')}
              </h2>
              <label className="text-xs font-bold uppercase tracking-widest text-secondary-token flex items-center gap-2">
                {t('closure.summary.role', 'Rol')}
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as ClosureRole)}
                  className="rounded-xl border border-default-token bg-surface-token p-2 text-xs normal-case font-normal text-primary-token tracking-normal"
                  data-testid="project-closure-summary-role"
                >
                  <option value="worker">
                    {t('closure.summary.worker', 'Trabajador')}
                  </option>
                  <option value="supervisor">
                    {t('closure.summary.supervisor', 'Supervisor')}
                  </option>
                  <option value="gerencia">
                    {t('closure.summary.gerencia', 'Gerencia')}
                  </option>
                </select>
              </label>
            </div>
            {summary ? (
              <div className="space-y-3">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {summary.highlights.map((h, i) => (
                    <div
                      key={i}
                      className="rounded-xl bg-surface-token border border-default-token p-3"
                    >
                      <dt className="text-[11px] uppercase tracking-widest text-secondary-token">
                        {h.label}
                      </dt>
                      <dd className="text-base font-bold text-primary-token">
                        {h.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p
                  className="text-sm text-primary-token leading-relaxed"
                  data-testid="project-closure-summary-narrative"
                >
                  {summary.narrative}
                </p>
                {counts && (
                  <p className="text-xs text-secondary-token">
                    {t(
                      'closure.summary.counts',
                      'Lecciones: {{l}} · Decisiones: {{d}} · Incidentes: {{i}} (críticos: {{c}})',
                      {
                        l: counts.lessons,
                        d: counts.decisions,
                        i: counts.incidents,
                        c: counts.criticalIncidents,
                      },
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-secondary-token">
                {t('closure.summary.empty', 'Sin resumen disponible.')}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default ProjectClosure;
