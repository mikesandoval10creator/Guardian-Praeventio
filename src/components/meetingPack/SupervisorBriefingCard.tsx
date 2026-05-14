// Praeventio Guard — Wire UI: <SupervisorBriefingCard />
//
// Wire UI para `meetingPackBuilder.buildSupervisorBriefingPack()`.
// Pre-shift briefing del supervisor: headline crítico + workers flagged
// + riesgos del día + acciones pendientes + clima + recomendaciones.

import { useTranslation } from 'react-i18next';
import {
  Sunrise,
  AlertOctagon,
  Users,
  Cloud,
  ClipboardList,
  Lightbulb,
  Megaphone,
  Activity,
  GraduationCap,
  CalendarClock,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import type { SupervisorBriefingPack } from '../../services/meetingPack/meetingPackBuilder.js';

interface SupervisorBriefingCardProps {
  pack: SupervisorBriefingPack;
  /** Callback al click en un worker flagged (caller abre su perfil). */
  onWorkerSelected?: (uid: string) => void;
  /** Callback al confirmar que el supervisor leyó el briefing. */
  onAcknowledge?: (pack: SupervisorBriefingPack) => void;
}

type FlagKind = SupervisorBriefingPack['flaggedWorkers'][number]['flagKind'];

const FLAG_META: Record<
  FlagKind,
  { Icon: typeof Activity; label: string; cls: string }
> = {
  restriction: {
    Icon: Activity,
    label: 'Restricción',
    cls: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300',
  },
  fatigue: {
    Icon: AlertOctagon,
    label: 'Fatiga',
    cls: 'bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300',
  },
  expired_cert: {
    Icon: GraduationCap,
    label: 'Cert vencida',
    cls: 'bg-orange-500/20 border-orange-500/50 text-orange-700 dark:text-orange-300',
  },
  newcomer: {
    Icon: Users,
    label: 'Nuevo en faena',
    cls: 'bg-teal-500/15 border-teal-500/40 text-teal-700 dark:text-teal-300',
  },
};

function severityClass(sev: string): string {
  switch (sev) {
    case 'sif':
      return 'border-rose-700/60 bg-rose-700/15 text-rose-900 dark:text-rose-200';
    case 'critical':
      return 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300';
    case 'high':
      return 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300';
    default:
      return 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300';
  }
}

export function SupervisorBriefingCard({
  pack,
  onWorkerSelected,
  onAcknowledge,
}: SupervisorBriefingCardProps) {
  const { t } = useTranslation();

  return (
    <section
      className="rounded-2xl border border-teal-500/30 bg-white/70 dark:bg-stone-900/40 p-4"
      data-testid="supervisor-briefing-card"
      aria-label={
        t('briefing.aria', 'Briefing de pre-turno del supervisor') as string
      }
    >
      <header className="flex items-start gap-2 mb-3">
        <Sunrise
          className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-stone-800 dark:text-stone-100">
            {t('briefing.title', 'Briefing pre-turno')}
          </h2>
          <p
            data-testid="briefing-headline"
            className="text-xs text-stone-700 dark:text-stone-300 mt-0.5 leading-snug"
          >
            {pack.headline}
          </p>
        </div>
        {pack.inPersonHandoverRequired && (
          <span
            data-testid="briefing-in-person-badge"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold uppercase tracking-wide shrink-0"
          >
            <Megaphone className="w-3 h-3" aria-hidden="true" />
            {t('briefing.inPersonRequired', 'Presencial obligatorio')}
          </span>
        )}
      </header>

      {/* Flagged workers */}
      {pack.flaggedWorkers.length > 0 && (
        <div className="mb-3" data-testid="briefing-flagged-workers">
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            {t('briefing.flaggedWorkersLabel', 'Trabajadores con flag')} (
            {pack.flaggedWorkers.length})
          </p>
          <ul className="space-y-1.5">
            {pack.flaggedWorkers.map((w) => {
              const meta = FLAG_META[w.flagKind];
              return (
                <li
                  key={`${w.uid}-${w.flagKind}`}
                  data-testid={`briefing-flag-${w.uid}-${w.flagKind}`}
                  className={`rounded-md border px-2 py-1.5 ${meta.cls}`}
                >
                  <div className="flex items-start gap-2">
                    <meta.Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold leading-tight">
                        {w.name}
                        <span className="ml-1 text-[9px] uppercase tracking-wide opacity-75 font-bold">
                          {meta.label}
                        </span>
                      </p>
                      <p className="text-[11px] opacity-85">{w.detail}</p>
                    </div>
                    {onWorkerSelected && (
                      <button
                        type="button"
                        onClick={() => onWorkerSelected(w.uid)}
                        data-testid={`briefing-flag-${w.uid}-${w.flagKind}-open`}
                        className="text-[11px] font-bold underline hover:opacity-80 shrink-0"
                      >
                        {t('briefing.openWorker', 'Ver')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Critical risks */}
      {pack.criticalRisks.length > 0 && (
        <div className="mb-3" data-testid="briefing-critical-risks">
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5 flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
            {t('briefing.criticalRisksLabel', 'Riesgos críticos hoy')} (
            {pack.criticalRisks.length})
          </p>
          <ul className="space-y-1">
            {pack.criticalRisks.map((r) => (
              <li
                key={r.id}
                data-testid={`briefing-risk-${r.id}`}
                className={`rounded-md border px-2 py-1.5 text-[11px] leading-snug ${severityClass(
                  r.severity,
                )}`}
              >
                <strong className="uppercase tracking-wide text-[9px] mr-1">
                  {r.severity}
                </strong>
                {r.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weather */}
      {pack.weatherAdvisory && (
        <div
          data-testid="briefing-weather"
          className="rounded-md border border-blue-500/30 bg-blue-500/5 px-2 py-1.5 mb-3"
        >
          <div className="flex items-start gap-1.5">
            <Cloud
              className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-[11px] text-blue-800 dark:text-blue-200 leading-snug">
              {pack.weatherAdvisory}
            </p>
          </div>
        </div>
      )}

      {/* Pending actions */}
      {pack.pendingActions.length > 0 && (
        <div className="mb-3" data-testid="briefing-pending-actions">
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-1.5 flex items-center gap-1">
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
            {t('briefing.pendingActionsLabel', 'Acciones pendientes')} (
            {pack.pendingActions.length})
          </p>
          <ul className="space-y-1">
            {pack.pendingActions.map((a) => (
              <li
                key={a.id}
                data-testid={`briefing-action-${a.id}`}
                className="rounded-md border border-stone-500/30 bg-stone-500/5 px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-start gap-1.5">
                  <CalendarClock
                    className="w-3 h-3 text-stone-500 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="leading-snug">{a.description}</p>
                    <p className="text-[10px] opacity-70 font-mono mt-0.5">
                      {t('briefing.dueLabel', 'vence')} {a.dueDate.slice(0, 10)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {pack.recommendations.length > 0 && (
        <div className="mb-3" data-testid="briefing-recommendations">
          <p className="text-[10px] uppercase tracking-wide font-bold text-teal-700 dark:text-teal-300 mb-1.5 flex items-center gap-1">
            <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
            {t('briefing.recommendationsLabel', 'Recomendaciones')}
          </p>
          <ul className="rounded-md border border-teal-500/30 bg-teal-500/5 p-2 space-y-0.5">
            {pack.recommendations.map((r, i) => (
              <li
                key={i}
                className="text-[11px] text-teal-800 dark:text-teal-200 leading-snug"
              >
                • {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onAcknowledge && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onAcknowledge(pack)}
            data-testid="briefing-acknowledge"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-teal-600 text-white text-xs font-bold hover:brightness-110"
          >
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            {t('briefing.acknowledge', 'He leído el briefing')}
          </button>
        </div>
      )}
    </section>
  );
}
