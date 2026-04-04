import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Activity, Play, CheckCircle2, Clock, Info, WifiOff } from 'lucide-react';
import { generateCompensatoryExercises } from '../../services/geminiService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

interface CompensatoryExercisesModalProps {
  isOpen: boolean;
  onClose: () => void;
  metrics: {
    fatigue: number;
    posture: number;
    attention: number;
  };
}

export function CompensatoryExercisesModal({ isOpen, onClose, metrics }: CompensatoryExercisesModalProps) {
  const [loading, setLoading] = useState(true);
  const [routine, setRoutine] = useState<any>(null);
  const [activeExercise, setActiveExercise] = useState<number | null>(null);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (isOpen) {
      if (!isOnline) {
        setLoading(false);
        setRoutine(null);
        return;
      }
      setLoading(true);
      generateCompensatoryExercises(metrics.fatigue, metrics.posture, metrics.attention)
        .then(data => {
          setRoutine(data);
          setLoading(false);
        })
        .catch(err => {
          console.error("Error generating exercises:", err);
          setLoading(false);
        });
    } else {
      setRoutine(null);
      setActiveExercise(null);
    }
  }, [isOpen, metrics]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          <div className="p-6 border-b border-white/10 flex items-center justify-between bg-zinc-800/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Activity className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Pausa Activa Inteligente</h2>
                <p className="text-xs text-zinc-400">Rutina generada por IA basada en tu estado actual</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {!isOnline ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
                <WifiOff className="w-12 h-12 text-zinc-500 mb-2" />
                <h3 className="text-lg font-bold text-white">Sin Conexión</h3>
                <p className="text-sm text-zinc-400 max-w-md">
                  La generación de rutinas de pausa activa requiere conexión a internet para analizar tus métricas con IA.
                </p>
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
                <p className="text-sm text-zinc-400 animate-pulse">Analizando biometría y diseñando rutina...</p>
              </div>
            ) : routine ? (
              <div className="space-y-6">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5">
                  <h3 className="text-lg font-bold text-emerald-400 mb-2">{routine.title}</h3>
                  <p className="text-sm text-zinc-300 leading-relaxed">{routine.description}</p>
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-white uppercase tracking-widest">Ejercicios Recomendados</h4>
                  {routine.exercises?.map((exercise: any, index: number) => (
                    <div 
                      key={index}
                      className={`border rounded-2xl p-4 transition-all ${
                        activeExercise === index 
                          ? 'bg-zinc-800 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                          : 'bg-zinc-900/50 border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 text-xs font-bold text-zinc-400 border border-white/10">
                              {index + 1}
                            </span>
                            <h5 className="font-bold text-white">{exercise.name}</h5>
                            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md">
                              <Clock className="w-3 h-3" />
                              {exercise.duration}
                            </span>
                          </div>
                          <p className="text-sm text-zinc-400 leading-relaxed pl-9">
                            {exercise.instructions}
                          </p>
                        </div>
                        <button
                          onClick={() => setActiveExercise(activeExercise === index ? null : index)}
                          className={`p-3 rounded-xl transition-colors shrink-0 ${
                            activeExercise === index
                              ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                          }`}
                        >
                          {activeExercise === index ? <CheckCircle2 className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500">
                <Info className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No se pudo generar la rutina. Intenta nuevamente.</p>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-white/10 bg-zinc-900">
            <button
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl transition-colors"
            >
              Cerrar
            </button>
          </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
