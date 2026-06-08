import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, AlertTriangle, CheckCircle, Filter, ChevronRight, Stethoscope, Loader2 } from 'lucide-react';
import { MedicalIcon } from '../medical/MedicalIcon';
import { useProject } from '../../contexts/ProjectContext';
import { subscribeObligations } from '../../services/legalCalendar/legalCalendarStore';
import { computeCalendar } from '../../services/legalCalendar/legalObligationsCalendar';
import type { CalendarEntry, LegalObligation } from '../../services/legalCalendar/legalObligationsCalendar';
import { logger } from '../../utils/logger';

// Derived urgency bucket for an obligation entry. Stable identifiers; only
// labels are localised below.
type Bucket = 'overdue' | 'warning' | 'ok';

const STATUS_STYLES: Record<Bucket, { color: string; bg: string; dot: string }> = {
  overdue: { color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', dot: 'bg-rose-500' },
  warning: { color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-500' },
  ok: { color: 'text-teal-400', bg: 'bg-teal-400/10 border-teal-400/20', dot: 'bg-teal-400' },
};

// Window filters replace the old fabricated program taxonomy: the obligation
// model carries recurrence/alert-window, not a per-worker program.
const WINDOW_FILTERS = ['todos', 'overdue', 'alert'] as const;
type WindowFilter = (typeof WINDOW_FILTERS)[number];

const bucketOf = (e: CalendarEntry): Bucket =>
  e.isOverdue ? 'overdue' : e.isInAlertWindow ? 'warning' : 'ok';

// Chilean date format DD-MM-YYYY from the obligation's ISO nextDueAt.
const formatDueDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
};

export function VigilanciaScheduler() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const [obligations, setObligations] = useState<LegalObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WindowFilter>('todos');
  const [sortBy, setSortBy] = useState<'dueDate' | 'status'>('dueDate');

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setObligations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeObligations(
      projectId,
      (list) => {
        // Real source: only legally-mandated MEDICAL-EXAM obligations.
        // No worker PII, no clinical result — just due dates + citation.
        setObligations(list.filter((o) => o.kind === 'medical_exam'));
        setLoading(false);
      },
      (err) => {
        logger.warn('vigilancia_obligations_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const entries: CalendarEntry[] = useMemo(() => computeCalendar(obligations), [obligations]);

  const counts = useMemo(
    () => ({
      overdue: entries.filter((e) => e.isOverdue).length,
      warning: entries.filter((e) => !e.isOverdue && e.isInAlertWindow).length,
      ok: entries.filter((e) => !e.isOverdue && !e.isInAlertWindow).length,
    }),
    [entries],
  );

  const filtered = useMemo(() => {
    let list = entries;
    if (filter === 'overdue') list = entries.filter((e) => e.isOverdue);
    else if (filter === 'alert') list = entries.filter((e) => !e.isOverdue && e.isInAlertWindow);
    return [...list].sort((a, b) => {
      if (sortBy === 'dueDate') return a.daysUntilDue - b.daysUntilDue;
      const rank = (e: CalendarEntry) => (e.isOverdue ? 0 : e.isInAlertWindow ? 1 : 2);
      return rank(a) - rank(b);
    });
  }, [entries, filter, sortBy]);

  const statusLabel = (bucket: Bucket): string => {
    switch (bucket) {
      case 'overdue': return t('vigilancia.status_overdue', 'Vencido');
      case 'warning': return t('vigilancia.status_upcoming', 'Próximo');
      default: return t('vigilancia.status_on_track', 'Al día');
    }
  };

  const filterLabel = (f: WindowFilter): string => {
    if (f === 'overdue') return t('vigilancia.filter_overdue', 'Vencidos');
    if (f === 'alert') return t('vigilancia.filter_alert', 'En alerta');
    return t('vigilancia.program_all', 'Todos');
  };

  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200/50 dark:border-white/5 flex items-center gap-3">
        <div className="p-2 rounded-xl bg-teal-400/10 dark:bg-gold-400/10">
          <Calendar className="w-4 h-4 text-teal-400 dark:text-gold-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-zinc-900 dark:text-white">{t('vigilancia.title', 'Vigilancia Médica Programada')}</p>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{t('vigilancia.subtitle', 'PREXOR · PLANESI · TMERT · EVAST · DS 109 — Calendario de vencimientos')}</p>
        </div>
        {/* Sprint 17c — Bioicons surveillance instrumentation cluster. */}
        <div className="hidden md:flex items-center gap-1.5 text-teal-600 dark:text-gold-400" aria-hidden="true">
          <MedicalIcon name="audiometer" size={18} alt={t('vigilancia.icon_alt_audiometry', 'Audiometría')} />
          <MedicalIcon name="spirometer" size={18} alt={t('vigilancia.icon_alt_spirometry', 'Espirometría')} />
          <MedicalIcon name="eye" size={18} alt={t('vigilancia.icon_alt_vision', 'Visión')} />
          <MedicalIcon name="thermometer" size={18} alt={t('vigilancia.icon_alt_thermometry', 'Termometría')} />
          <MedicalIcon name="blood-pressure-cuff" size={18} alt={t('vigilancia.icon_alt_blood_pressure', 'Presión arterial')} />
        </div>
        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest bg-teal-400/10 dark:bg-gold-400/10 text-teal-600 dark:text-gold-400 border border-teal-400/20 dark:border-gold-400/20 uppercase">
          {t('vigilancia.badge', 'Vigilancia')}
        </span>
      </div>

      {!selectedProject ? (
        <div className="p-10 text-center">
          <Calendar className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('vigilancia.empty_no_project', 'Selecciona un proyecto para ver la vigilancia médica programada.')}
          </p>
        </div>
      ) : loading ? (
        <div className="p-10 flex justify-center">
          <Loader2 className="w-6 h-6 text-teal-400 dark:text-gold-400 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="p-10 text-center">
          <Stethoscope className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('vigilancia.empty_no_exams', 'Sin exámenes ocupacionales programados. Inicializa el calendario legal (DS 109 · Ley 16.744) desde Calendario Legal.')}
          </p>
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="px-5 pt-4 grid grid-cols-3 gap-3">
            {[
              { key: 'overdue', label: t('vigilancia.kpi_overdue', 'Vencidos'), value: counts.overdue, ...STATUS_STYLES.overdue },
              { key: 'warning', label: t('vigilancia.kpi_upcoming_30d', 'Próximos 30d'), value: counts.warning, ...STATUS_STYLES.warning },
              { key: 'ok', label: t('vigilancia.status_on_track', 'Al día'), value: counts.ok, ...STATUS_STYLES.ok },
            ].map((s) => (
              <div key={s.key} className={`rounded-xl p-3 border ${s.bg} text-center`}>
                <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                <p className={`text-[9px] font-black uppercase tracking-widest ${s.color} opacity-80`}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="px-5 pt-3 flex flex-wrap gap-2 items-center">
            <Filter className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <div className="flex flex-wrap gap-1">
              {WINDOW_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border ${
                    filter === f
                      ? 'bg-teal-400/10 dark:bg-gold-400/10 text-teal-600 dark:text-gold-400 border-teal-400/30 dark:border-gold-400/30'
                      : 'text-zinc-500 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  {filterLabel(f)}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">{t('vigilancia.sort_label', 'Orden')}:</span>
              <button
                onClick={() => setSortBy((s) => (s === 'dueDate' ? 'status' : 'dueDate'))}
                className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-teal-600 dark:text-gold-400 bg-teal-400/10 dark:bg-gold-400/10 border border-teal-400/20 dark:border-gold-400/20 transition-all hover:bg-teal-400/20"
              >
                {sortBy === 'dueDate' ? t('vigilancia.sort_by_date', 'Fecha') : t('vigilancia.sort_by_urgency', 'Urgencia')}
              </button>
            </div>
          </div>

          {/* Obligation list */}
          <div className="p-5 space-y-2">
            {filtered.map((entry, i) => {
              const bucket = bucketOf(entry);
              const statusCfg = STATUS_STYLES[bucket];
              const days = entry.daysUntilDue;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-xl bg-white dark:bg-zinc-800/50 border border-zinc-200/50 dark:border-white/5 p-3 hover:border-zinc-300 dark:hover:border-white/10 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg border ${statusCfg.bg} flex-shrink-0`}>
                      <Stethoscope className={`w-4 h-4 ${statusCfg.color}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-black text-zinc-900 dark:text-white truncate">{entry.label}</p>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${statusCfg.bg} ${statusCfg.color}`}>
                          {statusLabel(bucket)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <p className="text-[10px] text-zinc-500">{entry.legalCitation}</p>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <div className={`flex items-center gap-1 justify-end ${statusCfg.color}`}>
                        {bucket === 'overdue' ? (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        ) : bucket === 'ok' ? (
                          <CheckCircle className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        <span className="text-xs font-black">
                          {days < 0
                            ? t('vigilancia.days_overdue', { count: Math.abs(days), defaultValue: '{{count}}d vencido' })
                            : days === 0
                              ? t('vigilancia.due_today', 'Hoy')
                              : t('vigilancia.days_remaining', { count: days, defaultValue: '{{count}}d' })}
                        </span>
                      </div>
                      <p className="text-[9px] text-zinc-500 mt-0.5">{formatDueDate(entry.nextDueAt)}</p>
                    </div>

                    <ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      <div className="px-5 pb-4">
        <p className="text-[9px] text-zinc-400 text-center flex items-center justify-center gap-1">
          <Stethoscope className="w-3 h-3" />
          {t('vigilancia.footer_minsal', 'Protocolos MINSAL — Ley 16.744 art. 68 obliga a vigilancia médica preventiva continua')}
        </p>
      </div>
    </div>
  );
}
