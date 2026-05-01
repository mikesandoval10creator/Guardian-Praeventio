// Praeventio Guard — Planificador (gamified objectives) modal extracted from Dashboard.tsx (A11 R18).
//
// Shows daily/weekly/monthly/annual challenges for the active industry, lets
// the user mark them complete, and exports an .ics with the daily set.

import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, CheckCircle2, ChevronRight, Plus, Target, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ChallengePeriod } from './challengeUtils';

interface PlannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  industry: string;
  activePeriod: ChallengePeriod;
  onPeriodChange: (p: ChallengePeriod) => void;
  challenges: string[];
  completedCount: number;
  isChallengeCompleted: (challenge: string) => boolean;
  onToggleObjective: (challenge: string) => void;
  onSyncCalendar: () => void;
}

const PERIOD_LABELS: Record<ChallengePeriod, string> = {
  daily: 'Día',
  weekly: 'Sem',
  monthly: 'Mes',
  annual: 'Año',
};

export function PlannerModal({
  isOpen,
  onClose,
  industry,
  activePeriod,
  onPeriodChange,
  challenges,
  completedCount,
  isChallengeCompleted,
  onToggleObjective,
  onSyncCalendar,
}: PlannerModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md p-4 sm:p-6 flex flex-col overflow-hidden group shadow-2xl max-h-[90vh]"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white z-20"
            >
              <Plus className="w-6 h-6 rotate-45" />
            </button>

            <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:scale-110 transition-transform pointer-events-none">
              <Target className="w-32 h-32 text-amber-500" />
            </div>

            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center justify-between mb-6 shrink-0 pr-8">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-500 shrink-0">
                    <Zap className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-widest leading-none truncate">Planificador</h3>
                    <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1 truncate">{industry}</p>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 mb-6 bg-zinc-100 dark:bg-white/5 p-1.5 rounded-xl shrink-0">
                {(['daily', 'weekly', 'monthly', 'annual'] as ChallengePeriod[]).map((period) => (
                  <button
                    key={period}
                    onClick={() => onPeriodChange(period)}
                    className={`flex-1 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${
                      activePeriod === period
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                    }`}
                  >
                    {PERIOD_LABELS[period]}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">
                    Objetivos ({completedCount}/{challenges.length})
                  </p>
                  <button
                    onClick={onSyncCalendar}
                    className="p-1.5 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all flex items-center gap-1.5"
                  >
                    <Calendar className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Sync</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 overflow-y-auto custom-scrollbar pr-2 flex-1">
                  {challenges.map((challenge, i) => {
                    const isCompleted = isChallengeCompleted(challenge);

                    return (
                      <button
                        key={i}
                        disabled={isCompleted}
                        onClick={() => onToggleObjective(challenge)}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                          isCompleted
                            ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/50 text-zinc-900 dark:text-white opacity-60'
                            : 'bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/5 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/10 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                      >
                        <span className={`text-xs font-bold uppercase tracking-widest mr-3 ${isCompleted ? 'line-through' : ''}`}>{challenge}</span>
                        {isCompleted ? (
                          <CheckCircle2 className="w-5 h-5 text-amber-500 shrink-0" />
                        ) : (
                          <Plus className="w-5 h-5 text-zinc-400 dark:text-zinc-600 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${completedCount === challenges.length ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                  <span className="text-xs font-black text-amber-500 uppercase tracking-widest">
                    {completedCount === challenges.length ? 'Completado' : 'Pendiente'}
                  </span>
                </div>
                <Link to="/calendar" onClick={onClose} className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest hover:text-amber-500 transition-colors flex items-center gap-1.5">
                  Calendario <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
