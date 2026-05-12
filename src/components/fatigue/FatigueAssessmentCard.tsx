// Praeventio Guard — Wire UI #59: <FatigueAssessmentCard />
//
// Muestra evaluación de fatiga por trabajador: horas 24h/7d, turnos
// consecutivos, nocturnos, descanso, y nivel de riesgo + restricciones.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, AlarmClock, ShieldOff } from 'lucide-react';
import {
  assessFatigue,
  type WorkSession,
  type FatigueRisk,
} from '../../services/fatigue/fatigueMonitor.js';

interface FatigueAssessmentCardProps {
  workerUid: string;
  sessions: WorkSession[];
  now?: Date;
}

const RISK_TONE: Record<FatigueRisk, { color: string; bg: string; badge: string }> = {
  low: {
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  moderate: {
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  high: {
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  },
  critical: {
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
};

export function FatigueAssessmentCard({
  workerUid,
  sessions,
  now,
}: FatigueAssessmentCardProps) {
  const { t } = useTranslation();
  const assessment = useMemo(
    () => assessFatigue(workerUid, sessions, now),
    [workerUid, sessions, now],
  );
  const tone = RISK_TONE[assessment.risk];

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${tone.bg}`}
      data-testid={`fatigue-card-${workerUid}`}
      aria-label={t('fatigue.aria', 'Evaluación de fatiga') as string}
    >
      <header className="flex items-center gap-2">
        <AlarmClock className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide truncate">
          {workerUid}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`fatigue-risk-${workerUid}`}
        >
          {assessment.risk.toUpperCase()}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface rounded p-2">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('fatigue.hours24h', 'Horas 24h')}
          </p>
          <p className="text-xl font-black tabular-nums">
            {assessment.totalHoursLast24h.toFixed(1)}
          </p>
        </div>
        <div className="bg-surface rounded p-2">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('fatigue.hours7d', 'Horas 7d')}
          </p>
          <p className="text-xl font-black tabular-nums">
            {assessment.totalHoursLast7d.toFixed(1)}
          </p>
        </div>
        <div className="bg-surface rounded p-2">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('fatigue.consecutive', 'Turnos consecutivos')}
          </p>
          <p className="text-xl font-black tabular-nums">{assessment.consecutiveShifts}</p>
        </div>
        <div className="bg-surface rounded p-2 flex flex-col">
          <p className="text-[10px] uppercase text-secondary-token flex items-center gap-1">
            <Moon className="w-3 h-3" aria-hidden="true" />
            {t('fatigue.nightShifts', 'Nocturnos 7d')}
          </p>
          <p className="text-xl font-black tabular-nums">{assessment.nightShiftsLast7d}</p>
        </div>
      </div>

      <div className="text-[10px] text-secondary-token">
        {t('fatigue.restSince', 'Descanso desde último turno')}:{' '}
        <span className="font-bold tabular-nums">
          {assessment.hoursOfRestSinceLastShift.toFixed(1)}h
        </span>
      </div>

      {assessment.shouldRestrictCritical && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid={`fatigue-restrict-${workerUid}`}
        >
          <ShieldOff className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'fatigue.restrictCritical',
              'NO asignar a tareas críticas (altura, confinado, eléctrico).',
            )}
          </span>
        </div>
      )}

      {assessment.recommendations.length > 0 && (
        <ul className="space-y-1" data-testid={`fatigue-recs-${workerUid}`}>
          {assessment.recommendations.map((r, i) => (
            <li key={i} className="text-[11px]" data-testid={`fatigue-rec-${workerUid}-${i}`}>
              • {r}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
