import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Send, Loader2, AlertTriangle, CheckCircle2, Zap, WifiOff } from 'lucide-react';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useProject } from '../contexts/ProjectContext';
import { NodeType } from '../types';
import { analyzeFastCheck } from '../services/geminiService';
import { useGamification } from '../hooks/useGamification';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { savePendingOfflineQuery } from '../utils/offlineKnowledge';

interface FastCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FastCheckModal({ isOpen, onClose }: FastCheckModalProps) {
  const [observation, setObservation] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const { addPoints } = useGamification();
  const isOnline = useOnlineStatus();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!observation.trim() || !selectedProject) return;

    setIsAnalyzing(true);
    try {
      if (!isOnline) {
        // Handle offline fast check
        const offlineAnalysis = {
          titulo: 'Reporte Offline',
          tipo: NodeType.RISK,
          criticidad: 'Media',
          tags: ['Offline', 'Pendiente'],
          accionInmediata: 'Revisar cuando haya conexión'
        };
        
        setResult(offlineAnalysis);
        
        // Save to Risk Network
        await addNode({
          type: NodeType.RISK,
          title: offlineAnalysis.titulo,
          description: observation + ' (Reportado Offline)',
          tags: offlineAnalysis.tags,
          projectId: selectedProject.id,
          connections: [],
          metadata: {
            criticidad: offlineAnalysis.criticidad,
            accionInmediata: offlineAnalysis.accionInmediata,
            source: 'FastCheck',
            status: 'pending_sync'
          }
        });

        // Save pending query for later sync/analysis
        savePendingOfflineQuery(`FastCheck Offline: ${observation}`);
        
        // Award points
        await addPoints(20, 'Fast Check Reportado (Offline)');
      } else {
        const analysis = await analyzeFastCheck(observation);
        setResult(analysis);
        
        // Save to Risk Network
        await addNode({
          type: analysis.tipo as NodeType || NodeType.RISK,
          title: analysis.titulo,
          description: observation,
          tags: ['FastCheck', ...analysis.tags],
          projectId: selectedProject.id,
          connections: [],
          metadata: {
            criticidad: analysis.criticidad,
            accionInmediata: analysis.accionInmediata,
            source: 'FastCheck',
            status: 'pending_approval'
          }
        });

        // Award points
        await addPoints(50, 'Fast Check Reportado');
      }

    } catch (error) {
      console.error('Error analyzing Fast Check:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const resetAndClose = () => {
    setObservation('');
    setResult(null);
    setIsAnalyzing(false);
    onClose();
  };

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
            onClick={resetAndClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                  <Zap className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-white uppercase tracking-tight truncate">Fast Check</h2>
                  <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest truncate">Reporte Rápido de Terreno</p>
                </div>
              </div>
              <button onClick={resetAndClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
            {!result ? (
              <form onSubmit={handleSubmit} className="space-y-4 flex flex-col h-full">
                <div className="flex-1">
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">
                    ¿Qué estás observando?
                  </label>
                  <textarea
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    placeholder="Ej: Hay un cable pelado cerca del generador principal, hay agua en el piso..."
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none h-full min-h-[120px]"
                    required
                  />
                </div>
                
                <div className="flex gap-3 shrink-0">
                  <button type="button" className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-colors flex items-center justify-center gap-2">
                    <Camera className="w-4 h-4" />
                    Foto
                  </button>
                  <button 
                    type="submit"
                    disabled={isAnalyzing || !observation.trim() || !selectedProject}
                    className="flex-[2] bg-[var(--btn-primary-bg)] hover:opacity-80 disabled:bg-zinc-800 disabled:text-zinc-500 text-[var(--btn-primary-text,white)] px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-colors flex items-center justify-center gap-2"
                  >
                    {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : !isOnline ? <WifiOff className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                    {isAnalyzing ? 'Analizando...' : !isOnline ? 'Guardar Offline' : 'Reportar y Ganar 50 PTS'}
                  </button>
                </div>
                {!selectedProject && (
                  <p className="text-rose-400 text-[10px] font-bold uppercase tracking-widest text-center mt-2">
                    Debes seleccionar un proyecto primero.
                  </p>
                )}
              </form>
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-center">
                  <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h3 className="text-xl font-black text-white uppercase tracking-tight mb-2">¡Reporte Exitoso!</h3>
                  <p className="text-emerald-500 text-sm font-bold">+50 Puntos de Guardián</p>
                </div>

                <div className="space-y-4 bg-zinc-950 rounded-2xl p-4 border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Clasificación IA</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                      result.criticidad === 'Alta' || result.criticidad === 'Crítica' ? 'bg-rose-500/20 text-rose-500' : 'bg-amber-500/20 text-amber-500'
                    }`}>
                      {result.criticidad}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{result.titulo}</h4>
                    <p className="text-xs text-zinc-400 mt-1">{result.accionInmediata}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.tags.map((tag: string, i: number) => (
                      <span key={i} className="px-2 py-1 bg-zinc-900 border border-white/5 rounded-lg text-[9px] font-bold text-zinc-500 uppercase">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={resetAndClose}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-colors"
                >
                  Cerrar
                </button>
              </motion.div>
            )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
