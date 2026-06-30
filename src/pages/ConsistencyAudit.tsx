// Praeventio Guard — Sprint K wire UI (2026-05-23) — Consistencia entre módulos.
//
// Page `/consistency-audit`. Service `consistencyAuditor.ts` (12 reglas
// determinísticas + summarize) + card `ConsistencyAuditCard.tsx` existían
// sin page consumidor. Aquí se wire.
//
// UX:
//   - El supervisor presiona "Ejecutar auditoría" → el sistema lee
//     workers + task assignments + documentos + acciones + permits +
//     trainings del proyecto activo (Firestore project-scoped) y corre
//     las 12 reglas del auditor.
//   - ConsistencyAuditCard renderiza las inconsistencias detectadas
//     agrupadas por severity (critical / warning / info).
//   - Auto-refresh opcional cada 60s.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  Search,
} from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { ConsistencyAuditCard } from '../components/consistency/ConsistencyAuditCard';
import {
  runConsistencyAudit,
  summarizeConsistencyAudit,
  type Inconsistency,
  type ConsistencyState,
} from '../services/consistency/consistencyAuditor';
import { buildConsistencyStateFromFirestore } from '../services/consistency/consistencyStateBuilder';
import { logger } from '../utils/logger';

// Plan 2026-05-24 §Fase B.6 batch3 — i18n sweep ConsistencyAudit.
export function ConsistencyAudit() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const [issues, setIssues] = useState<Inconsistency[]>([]);
  const [state, setState] = useState<ConsistencyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    if (!selectedProject?.id) {
      setFeedback(t('consistency_audit.feedback.need_project', 'Seleccioná un proyecto para correr la auditoría.'));
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const consistencyState = await buildConsistencyStateFromFirestore(
        selectedProject.id,
      );
      setState(consistencyState);
      const detected = runConsistencyAudit(consistencyState);
      setIssues(detected);
      setLastRunAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('consistency_audit_failed', { err: msg });
      setFeedback(
        t('consistency_audit.feedback.error', {
          defaultValue: 'Error al ejecutar auditoría: {{msg}}',
          msg,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [selectedProject?.id]);

  // Auto-correr al cambiar de proyecto.
  useEffect(() => {
    if (selectedProject?.id) {
      void runAudit();
    } else {
      setIssues([]);
      setState(null);
    }
  }, [selectedProject?.id, runAudit]);

  // Auto-refresh opcional cada 60s.
  useEffect(() => {
    if (!autoRefresh || !selectedProject?.id) return undefined;
    const interval = setInterval(() => {
      void runAudit();
    }, 60_000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedProject?.id, runAudit]);

  const summary = state ? summarizeConsistencyAudit(issues) : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary-token tracking-tight flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-rose-500" /> {t('consistency_audit.title', 'Consistencia entre módulos')}
            </h1>
            <p className="text-xs text-muted-token mt-1 max-w-2xl">
              {t(
                'consistency_audit.subtitle',
                'Auditor interno automático que detecta contradicciones entre módulos: trabajadores asignados sin capacitación vigente, EPP que no corresponde al cargo, documentos aprobados sin firma, acciones cerradas sin evidencia, permisos cuyo aprobador ya no existe, etc. 12 reglas determinísticas (sin LLM).',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runAudit}
              disabled={!selectedProject || loading}
              className="rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loading
                ? t('consistency_audit.cta_running', 'Auditando…')
                : t('consistency_audit.cta_run', 'Ejecutar auditoría')}
            </button>
            <label className="flex items-center gap-1 text-[10px] font-bold text-secondary-token cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              {t('consistency_audit.auto_refresh', 'Auto cada 60s')}
            </label>
          </div>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-default-token bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-muted-token">
            {t('consistency_audit.empty.select_project', 'Seleccioná un proyecto para correr la auditoría.')}
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Summary cards. */}
            {summary && (
              <section className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/15 p-3">
                  <p className="text-[10px] font-black text-rose-700 dark:text-rose-300 uppercase tracking-widest">
                    {t('consistency_audit.severity.critical', 'Críticas')}
                  </p>
                  <p className="text-2xl font-black text-rose-900 dark:text-rose-100">
                    {summary.bySeverity.critical}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/15 p-3">
                  <p className="text-[10px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-widest">
                    {t('consistency_audit.severity.warning', 'Advertencias')}
                  </p>
                  <p className="text-2xl font-black text-amber-900 dark:text-amber-100">
                    {summary.bySeverity.warning}
                  </p>
                </div>
                <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-900/15 p-3">
                  <p className="text-[10px] font-black text-sky-700 dark:text-sky-300 uppercase tracking-widest">
                    {t('consistency_audit.severity.info', 'Info')}
                  </p>
                  <p className="text-2xl font-black text-sky-900 dark:text-sky-100">
                    {summary.bySeverity.info}
                  </p>
                </div>
              </section>
            )}

            {/* Last run + stats */}
            {lastRunAt && state && (
              <div className="flex items-center justify-between text-[10px] text-muted-token font-mono">
                <span>
                  {t('consistency_audit.stats.last_run', {
                    defaultValue: 'Última corrida: {{date}}',
                    date: lastRunAt.toLocaleString('es-CL'),
                  })}
                </span>
                <span>
                  {t('consistency_audit.stats.summary', {
                    defaultValue:
                      'Workers: {{w}} · Tareas: {{ta}} · Docs: {{d}} · CAs: {{ca}} · Permits: {{p}} · Capacitaciones: {{tr}}',
                    w: state.workers.length,
                    ta: state.taskAssignments.length,
                    d: state.documents.length,
                    ca: state.correctiveActions.length,
                    p: state.workPermits.length,
                    tr: state.trainings.length,
                  })}
                </span>
              </div>
            )}

            {/* Card de inconsistencias. */}
            {issues.length === 0 && state && !loading ? (
              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-6 flex items-center gap-3 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-6 h-6 shrink-0" />
                <div>
                  <p className="text-sm font-black">
                    {t('consistency_audit.no_issues.title', 'Sin inconsistencias detectadas')}
                  </p>
                  <p className="text-xs opacity-80 mt-0.5">
                    {t(
                      'consistency_audit.no_issues.subtitle',
                      'Las 12 reglas de auditoría no encontraron contradicciones entre los módulos del proyecto en esta corrida.',
                    )}
                  </p>
                </div>
              </div>
            ) : issues.length > 0 ? (
              <ConsistencyAuditCard inconsistencies={issues} />
            ) : null}

            {/* Botón refresh inferior si ya hay resultados. */}
            {state && !loading && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={runAudit}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('consistency_audit.re_run', 'Re-ejecutar')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ConsistencyAudit;
