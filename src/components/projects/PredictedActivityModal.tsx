import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CalendarPlus,
  Clock,
  AlarmClock,
  ScrollText,
  AlertTriangle,
  Info,
  ShieldAlert,
} from 'lucide-react';
import type { PredictedActivity } from '../../services/calendar/predictions';

interface Props {
  activity: PredictedActivity | null;
  onClose: () => void;
  /** Optional: persist the activity into the user's calendar (Google/Outlook). */
  onSchedule?: (activity: PredictedActivity) => void | Promise<void>;
  /** Optional: snooze/dismiss the prediction for ~7 days. */
  onDismiss?: (activity: PredictedActivity) => void;
}

const ACTIVITY_LABELS: Record<PredictedActivity['type'], string> = {
  'cphs-meeting': 'CPHS · Reunión Mensual',
  'odi-training': 'Capacitación ODI',
  'audiometria': 'Audiometría PREXOR',
  'iper-review': 'Revisión Matriz IPER',
  'management-review-iso45001': 'Revisión por la Dirección (ISO 45001)',
  'climate-risk-review': 'Revisión de Riesgos Climáticos',
};

const PRIORITY_STYLES: Record<
  PredictedActivity['priority'],
  { badge: string; ring: string; icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  info: {
    badge: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
    ring: 'border-sky-500/30',
    icon: Info,
    label: 'Informativo',
  },
  warning: {
    badge: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    ring: 'border-amber-500/40',
    icon: AlertTriangle,
    label: 'Atención',
  },
  critical: {
    badge: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/40',
    ring: 'border-rose-500/50',
    icon: ShieldAlert,
    label: 'Crítico',
  },
};

function formatDateEsCL(date: Date): string {
  try {
    return date.toLocaleDateString('es-CL', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatTimeEsCL(date: Date): string {
  try {
    return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function PredictedActivityModal({ activity, onClose, onSchedule, onDismiss }: Props) {
  const isOpen = activity !== null;
  const [isScheduling, setIsScheduling] = React.useState(false);

  const handleSchedule = async () => {
    if (!activity || !onSchedule) return;
    try {
      setIsScheduling(true);
      await onSchedule(activity);
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && activity && (
        <motion.div
          key="predicted-activity-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="predicted-activity-modal-title"
            className={`relative w-full max-w-lg bg-white dark:bg-zinc-900 border ${
              PRIORITY_STYLES[activity.priority].ring
            } rounded-3xl shadow-2xl overflow-hidden`}
          >
            {/* Header */}
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-start justify-between bg-gradient-to-r from-emerald-500/10 to-transparent gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <AlarmClock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="predicted-activity-modal-title"
                    className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight"
                  >
                    {ACTIVITY_LABELS[activity.type] ?? activity.type}
                  </h3>
                  <p className="text-xs text-zinc-500 font-medium mt-0.5">
                    Actividad preventiva sugerida por el motor de cumplimiento
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-full transition-colors shrink-0"
              >
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {/* Priority badge */}
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${
                    PRIORITY_STYLES[activity.priority].badge
                  }`}
                >
                  {React.createElement(PRIORITY_STYLES[activity.priority].icon, {
                    className: 'w-3 h-3',
                  })}
                  {PRIORITY_STYLES[activity.priority].label}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Proyecto: {activity.projectId}
                </span>
              </div>

              {/* Reason */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Justificación
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed">
                  {activity.reason}
                </p>
              </div>

              {/* Legal reference */}
              {activity.legalReference && (
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-white/5">
                  <ScrollText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Referencia legal
                    </p>
                    <p className="text-xs text-zinc-700 dark:text-zinc-200 font-medium mt-0.5 break-words">
                      {activity.legalReference}
                    </p>
                  </div>
                </div>
              )}

              {/* Date & duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-white/5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
                    Fecha sugerida
                  </p>
                  <p className="text-sm text-zinc-900 dark:text-white font-semibold capitalize">
                    {formatDateEsCL(activity.recommendedDate)}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {formatTimeEsCL(activity.recommendedDate)}
                  </p>
                </div>
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-white/5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
                    Duración estimada
                  </p>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-zinc-500" />
                    <p className="text-sm text-zinc-900 dark:text-white font-semibold">
                      {activity.recommendedDurationMin} min
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="p-4 sm:p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50/40 dark:bg-zinc-800/30 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cerrar
              </button>
              {onDismiss && (
                <button
                  type="button"
                  onClick={() => onDismiss(activity)}
                  className="px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
                >
                  Posponer 7 días
                </button>
              )}
              {onSchedule && (
                <button
                  type="button"
                  onClick={handleSchedule}
                  disabled={isScheduling}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-emerald-500/20"
                >
                  <CalendarPlus className="w-4 h-4" />
                  {isScheduling ? 'Agendando...' : 'Agendar en Calendar'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
