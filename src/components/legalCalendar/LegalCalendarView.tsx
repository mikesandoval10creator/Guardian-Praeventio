// Praeventio Guard — Wire UI #5: <LegalCalendarView />
//
// Renders the legal obligations calendar with upcoming/overdue grouping
// and color coding by alert window. Consumes `CalendarEntry[]` from
// `legalCalendar/legalObligationsCalendar.ts`.
//
// Used in: new route `/compliance/calendar`.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, AlertCircle, Clock } from 'lucide-react';
import type {
  CalendarEntry,
  ObligationKind,
} from '../../services/legalCalendar/legalObligationsCalendar.js';

interface LegalCalendarViewProps {
  entries: CalendarEntry[];
  onEntryClick?: (entry: CalendarEntry) => void;
}

const KIND_LABEL: Record<ObligationKind, string> = {
  audit: 'Auditoría',
  env_measurement: 'Medición ambiental',
  training_renewal: 'Renovación capacitación',
  cphs_meeting: 'Reunión CPHS',
  mutualidad_report: 'Reporte mutualidad',
  drill: 'Simulacro',
  medical_exam: 'Examen ocupacional',
  document_renewal: 'Renovación documento',
  permit_renewal: 'Renovación permiso',
};

function entryClass(e: CalendarEntry): string {
  if (e.daysUntilDue < 0) {
    return 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300';
  }
  if (e.isInAlertWindow) {
    return 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300';
  }
  return 'bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300';
}

export function LegalCalendarView({ entries, onEntryClick }: LegalCalendarViewProps) {
  const { t } = useTranslation();

  const { overdue, upcoming, scheduled } = useMemo(() => {
    const o: CalendarEntry[] = [];
    const u: CalendarEntry[] = [];
    const s: CalendarEntry[] = [];
    for (const e of entries) {
      if (e.daysUntilDue < 0) o.push(e);
      else if (e.isInAlertWindow) u.push(e);
      else s.push(e);
    }
    const sortFn = (a: CalendarEntry, b: CalendarEntry) => a.daysUntilDue - b.daysUntilDue;
    o.sort(sortFn);
    u.sort(sortFn);
    s.sort(sortFn);
    return { overdue: o, upcoming: u, scheduled: s };
  }, [entries]);

  function renderGroup(
    title: string,
    icon: typeof CalendarDays,
    items: CalendarEntry[],
    testid: string,
  ) {
    const Icon = icon;
    return (
      <section data-testid={testid}>
        <header className="flex items-center gap-2 mb-2">
          <Icon className="w-4 h-4" aria-hidden="true" />
          <h3 className="text-sm font-black uppercase tracking-wide text-primary-token">
            {title} ({items.length})
          </h3>
        </header>
        {items.length === 0 ? (
          <p className="text-xs text-secondary-token italic">
            {t('legal_calendar.empty_group', 'Sin obligaciones en este grupo.')}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onEntryClick?.(e)}
                  disabled={!onEntryClick}
                  data-testid={`legal-entry-${e.id}`}
                  className={`w-full text-left rounded-lg border p-3 ${entryClass(e)} ${onEntryClick ? 'hover:brightness-110 cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-bold leading-tight">
                      {e.label}
                    </span>
                    <span className="text-[10px] tabular-nums shrink-0">
                      {e.daysUntilDue < 0
                        ? t('legal_calendar.overdue_days', `Vencida ${Math.abs(e.daysUntilDue)}d`, {
                            days: Math.abs(e.daysUntilDue),
                          })
                        : t('legal_calendar.days_to_due', `En ${e.daysUntilDue}d`, { days: e.daysUntilDue })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] opacity-80">
                    <span>{KIND_LABEL[e.kind]}</span>
                    <span className="font-mono">{e.legalCitation}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="legal-calendar-view"
      aria-label={t('legal_calendar.aria', 'Calendario obligaciones legales') as string}
    >
      <header>
        <h2 className="text-base font-black text-primary-token uppercase tracking-wide">
          {t('legal_calendar.title', 'Calendario de Obligaciones Legales')}
        </h2>
        <p className="text-xs text-secondary-token mt-1">
          {t('legal_calendar.subtitle', 'Vencimientos, renovaciones y reuniones requeridas por normativa chilena.')}
        </p>
      </header>

      {renderGroup(
        t('legal_calendar.overdue', 'Vencidas'),
        AlertCircle,
        overdue,
        'legal-calendar-overdue',
      )}
      {renderGroup(
        t('legal_calendar.upcoming', 'Próximas (alerta activa)'),
        Clock,
        upcoming,
        'legal-calendar-upcoming',
      )}
      {renderGroup(
        t('legal_calendar.scheduled', 'Agendadas'),
        CalendarDays,
        scheduled,
        'legal-calendar-scheduled',
      )}
    </div>
  );
}
