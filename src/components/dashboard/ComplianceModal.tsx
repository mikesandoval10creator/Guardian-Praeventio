import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Target, TrendingUp, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

interface ComplianceModalProps {
  isOpen: boolean;
  onClose: () => void;
  percentage: number;
  projectName: string;
}

export function ComplianceModal({ isOpen, onClose, percentage, projectName }: ComplianceModalProps) {
  const missingPercentage = 100 - percentage;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                  <Target className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Optimización de Gestión</h2>
                  <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest truncate">{projectName}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl p-4 border border-zinc-200 dark:border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Cumplimiento Actual</p>
                  <div className="flex items-end gap-2">
                    <span className="text-3xl font-black text-emerald-500 leading-none">{percentage}%</span>
                  </div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl p-4 border border-zinc-200 dark:border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Brecha para el 100%</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black text-amber-500 uppercase tracking-tight">
                      {missingPercentage}%
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  Acciones para alcanzar el 100%
                </h3>
                <div className="space-y-3">
                  <div className="bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5 rounded-2xl p-4 hover:border-zinc-300 dark:hover:border-white/10 transition-colors">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Actualización de Matrices de Riesgo</h4>
                      <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest shrink-0">
                        +{(missingPercentage * 0.4).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-4 leading-relaxed">Faltan revisiones trimestrales en 2 áreas operativas críticas. La actualización reducirá la exposición a multas.</p>
                    <button className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1.5 hover:text-emerald-400 transition-colors">
                      Ir a Matrices <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5 rounded-2xl p-4 hover:border-zinc-300 dark:hover:border-white/10 transition-colors">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Capacitaciones Pendientes (DS 40)</h4>
                      <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest shrink-0">
                        +{(missingPercentage * 0.35).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-4 leading-relaxed">15 trabajadores no han completado la inducción de "Derecho a Saber" (ODI) este semestre.</p>
                    <button className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1.5 hover:text-emerald-400 transition-colors">
                      Programar Capacitación <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5 rounded-2xl p-4 hover:border-zinc-300 dark:hover:border-white/10 transition-colors">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white">Cierre de Hallazgos Críticos</h4>
                      <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-[10px] font-black uppercase tracking-widest shrink-0">
                        +{(missingPercentage * 0.25).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mb-3">Existen 3 hallazgos de nivel "Alto" reportados la semana pasada que aún no tienen medidas correctivas implementadas.</p>
                    <button className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-1 hover:text-emerald-400 transition-colors">
                      Revisar Hallazgos <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
