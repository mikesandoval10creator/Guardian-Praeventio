// Praeventio Guard — Sprint K wire UI (2026-05-23) — Calendario legal.
//
// Page `/legal-calendar`. Service `legalObligationsCalendar.ts`
// (computeCalendar + advanceObligation + bootstrapCalendar +
// summarizeCalendar + STANDARD_OBLIGATIONS templates) + card
// `LegalCalendarView.tsx` existían sin page consumidor.
//
// UX:
//   - Auto-bootstrap del calendario desde STANDARD_OBLIGATIONS si el
//     proyecto no tiene obligations todavía.
//   - Listado ordenado por daysUntilDue (overdue primero, luego upcoming).
//   - Botón "Marcar cumplida" avanza la obligation al próximo ciclo
//     (advanceObligation) — auditoría queda en updatedAt.
//   - Summary cards: total / overdue / en ventana de alerta.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { humanErrorMessage } from '../lib/humanError';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

import { useProject } from '../contexts/ProjectContext';
import { LegalCalendarView } from '../components/legalCalendar/LegalCalendarView';
import { LegalObligationCard } from '../components/legalCalendar/LegalObligationCard';
import {
  computeCalendar,
  summarizeCalendar,
  advanceObligation,
  STANDARD_OBLIGATIONS,
  type LegalObligation,
} from '../services/legalCalendar/legalObligationsCalendar';
import {
  saveObligation,
  subscribeObligations,
  ensureCalendarBootstrap,
} from '../services/legalCalendar/legalCalendarStore';
import {
  fetchUpcomingObligations,
  type UpcomingObligationsResponse,
} from '../hooks/useLegalObligations';
import { logger } from '../utils/logger';

// Plan 2026-05-24 §Fase B.6 batch4 — i18n sweep LegalCalendar.
export function LegalCalendar() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const [obligations, setObligations] = useState<LegalObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Server-backed "upcoming" obligations. The HTTP endpoint
  // (`/api/sprint-k/:projectId/legal-calendar/upcoming`) runs the same
  // `computeCalendar` engine server-side behind `assertProjectMember`, so this
  // section reflects exactly what a fiscalizador would see — real data, never
  // fabricated. On error/empty we render an honest empty state.
  const [serverUpcoming, setServerUpcoming] =
    useState<UpcomingObligationsResponse | null>(null);
  const [serverLoading, setServerLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setObligations([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeObligations(
      projectId,
      (list) => {
        setObligations(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('legal_obligations_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  // Fetch the server-computed upcoming window (30d) for the selected project.
  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setServerUpcoming(null);
      setServerLoading(false);
      setServerError(null);
      return undefined;
    }
    const ctrl = new AbortController();
    setServerLoading(true);
    setServerError(null);
    fetchUpcomingObligations(projectId, { signal: ctrl.signal })
      .then((res) => {
        setServerUpcoming(res);
        setServerLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('legal_obligations_upcoming_error', { err: msg });
        setServerError(msg);
        setServerUpcoming(null);
        setServerLoading(false);
      });
    return () => ctrl.abort();
  }, [selectedProject?.id]);

  const handleBootstrap = useCallback(async () => {
    if (!selectedProject) return;
    setBootstrapping(true);
    setFeedback(null);
    try {
      const written = await ensureCalendarBootstrap(
        selectedProject.id,
        STANDARD_OBLIGATIONS,
      );
      setFeedback(
        written > 0
          ? t('legal_calendar.feedback.bootstrap_ok', {
              defaultValue: 'Inicializadas {{n}} obligaciones estándar (DS 76, DS 132, DS 44/2024, etc.).',
              n: written,
            })
          : t('legal_calendar.feedback.already_init', 'El calendario ya estaba inicializado.'),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback(msg);
    } finally {
      setBootstrapping(false);
    }
  }, [selectedProject]);

  const handleMarkComplete = useCallback(
    async (entry: LegalObligation) => {
      if (!selectedProject) return;
      try {
        const advanced = advanceObligation(entry);
        await saveObligation(selectedProject.id, advanced);
        setFeedback(
          t('legal_calendar.feedback.advanced', {
            defaultValue: '"{{label}}" avanzada al próximo ciclo.',
            label: entry.label,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [selectedProject],
  );

  const entries = useMemo(() => computeCalendar(obligations), [obligations]);
  const summary = useMemo(() => summarizeCalendar(entries), [entries]);
  const serverEntries = serverUpcoming?.entries ?? [];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-black text-primary-token tracking-tight flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-teal-500" /> {t('legal_calendar.title', 'Calendario legal')}
          </h1>
          <p className="text-xs text-muted-token mt-1 max-w-2xl">
            {t(
              'legal_calendar.subtitle',
              'Obligaciones legales recurrentes: auditorías, mediciones ambientales, renovaciones de capacitación, reuniones CPHS, reportes mutualidad, simulacros, exámenes ocupacionales, renovación de documentos y permisos. DS 76 / DS 132 / DS 44/2024 / Ley 16.744.',
            )}
          </p>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-default-token bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-muted-token">
            {t('legal_calendar.empty.select_project', 'Seleccioná un proyecto.')}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-muted-token">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Server-backed upcoming window. Reads the membership-gated HTTP
                endpoint so the section shows the same computed calendar the
                backend (and any auditor portal) sees. Honest empty/error
                states — never fabricated rows. */}
            <section
              className="rounded-2xl border border-default-token bg-white dark:bg-zinc-900/60 p-4 space-y-3"
              data-testid="legal-calendar-server-section"
              aria-label={
                t(
                  'legal_calendar.server_section.aria',
                  'Próximas obligaciones según el servidor',
                ) as string
              }
            >
              <header className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-black text-muted-token uppercase tracking-widest">
                  {t(
                    'legal_calendar.server_section.heading',
                    'Próximas obligaciones (servidor)',
                  )}
                </h2>
                {serverUpcoming && (
                  <span
                    className="text-[10px] font-bold text-muted-token tabular-nums"
                    data-testid="legal-calendar-server-window"
                  >
                    {t('legal_calendar.server_section.window', {
                      defaultValue: 'ventana {{n}}d',
                      n: serverUpcoming.windowDays,
                    })}
                  </span>
                )}
              </header>

              {serverLoading ? (
                <div
                  className="flex items-center gap-2 text-xs text-muted-token"
                  data-testid="legal-calendar-server-loading"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('legal_calendar.server_section.loading', 'Cargando…')}
                </div>
              ) : serverError ? (
                <div
                  className="rounded-xl border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 p-3 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2"
                  data-testid="legal-calendar-server-error"
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {t('legal_calendar.server_section.error', {
                      defaultValue: 'No se pudieron cargar: {{msg}}',
                      msg: humanErrorMessage(serverError),
                    })}
                  </span>
                </div>
              ) : serverEntries.length === 0 ? (
                <p
                  className="text-xs text-muted-token"
                  data-testid="legal-calendar-server-empty"
                >
                  {t(
                    'legal_calendar.server_section.empty',
                    'No hay obligaciones próximas a vencer en este proyecto.',
                  )}
                </p>
              ) : (
                <ul
                  className="space-y-1.5"
                  data-testid="legal-calendar-server-list"
                >
                  {serverEntries.map((e) => (
                    <li
                      key={e.id}
                      data-testid={`legal-calendar-server-entry-${e.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-default-token px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-primary-token truncate">
                          {e.label}
                        </span>
                        <span className="block text-[10px] text-muted-token truncate">
                          {e.legalCitation}
                        </span>
                      </span>
                      <span
                        className="shrink-0 text-[10px] font-black tabular-nums text-amber-700 dark:text-amber-300"
                        data-testid={`legal-calendar-server-entry-${e.id}-due`}
                      >
                        {t('legal_calendar.due.in_days', {
                          defaultValue: 'en {{n}}d',
                          n: e.daysUntilDue,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Summary stats. */}
            {entries.length > 0 && (
              <section className="grid grid-cols-4 gap-3">
                <div className="rounded-xl border border-default-token bg-white dark:bg-zinc-900/60 p-3">
                  <p className="text-[10px] font-black text-muted-token uppercase tracking-widest">
                    {t('legal_calendar.summary.total', 'Total')}
                  </p>
                  <p className="text-2xl font-black text-primary-token">
                    {summary.totalObligations}
                  </p>
                </div>
                <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/15 p-3">
                  <p className="text-[10px] font-black text-rose-700 dark:text-rose-300 uppercase tracking-widest">
                    {t('legal_calendar.summary.overdue', 'Vencidas')}
                  </p>
                  <p className="text-2xl font-black text-rose-900 dark:text-rose-100">
                    {summary.overdue}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/15 p-3">
                  <p className="text-[10px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-widest">
                    {t('legal_calendar.summary.alert', 'Alerta')}
                  </p>
                  <p className="text-2xl font-black text-amber-900 dark:text-amber-100">
                    {summary.inAlertWindow}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/15 p-3">
                  <p className="text-[10px] font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-widest">
                    {t('legal_calendar.summary.ok', 'OK')}
                  </p>
                  <p className="text-2xl font-black text-emerald-900 dark:text-emerald-100">
                    {summary.totalObligations - summary.overdue - summary.inAlertWindow}
                  </p>
                </div>
              </section>
            )}

            {/* Empty state with bootstrap button. */}
            {entries.length === 0 && !loading && (
              <div className="rounded-2xl border border-default-token bg-white dark:bg-zinc-900/60 p-6 space-y-3 text-center">
                <p className="text-sm text-secondary-token">
                  {t('legal_calendar.bootstrap.title', 'Sin obligaciones cargadas para este proyecto.')}
                </p>
                <p className="text-xs text-muted-token">
                  {t(
                    'legal_calendar.bootstrap.hint',
                    'Bootstrap inicializa el calendario con las obligaciones estándar (auditorías anuales, mediciones semestrales, CPHS mensual, simulacros, etc.) con fechas calculadas desde hoy.',
                  )}
                </p>
                <button
                  type="button"
                  onClick={handleBootstrap}
                  disabled={bootstrapping}
                  className="rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest inline-flex items-center gap-2"
                >
                  {bootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {t('legal_calendar.bootstrap.cta', 'Inicializar calendario estándar')}
                </button>
              </div>
            )}

            {/* Calendar view + actions */}
            {entries.length > 0 && (
              <>
                <LegalCalendarView entries={entries} />

                {/* Quick action: marcar cumplida la más próxima. */}
                <section className="space-y-2">
                  <h2 className="text-xs font-black text-muted-token uppercase tracking-widest">
                    {t('legal_calendar.quick_actions.heading', 'Acciones rápidas')}
                  </h2>
                  <ul className="space-y-1.5">
                    {entries.slice(0, 5).map((e) => (
                      <li key={e.id}>
                        <LegalObligationCard
                          entry={e}
                          variant={e.isOverdue ? 'overdue' : 'upcoming'}
                          onAcknowledge={handleMarkComplete}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default LegalCalendar;
