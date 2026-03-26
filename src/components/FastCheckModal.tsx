import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Send, Loader2, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useProject } from '../contexts/ProjectContext';
import { NodeType } from '../types';
import { analyzeFastCheck } from '../services/geminiService';
import { useGamification } from '../hooks/useGamification';

interface FastCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FastCheckModal({ isOpen, onClose }: FastCheckModalProps) {
  const [observation, setObservation] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { addNode } = useZettelkasten();
  const { selectedProject } = useProject();
  const { addPoints } = useGamification();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!observation.trim() || !selectedProject) return;

    setIsAnalyzing(true);
    try {
      const analysis = await analyzeFastCheck(observation);
      setResult(analysis);
      
      // Save to Zettelkasten
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

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-zinc-900 border border-white/10 rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl"
        >
          <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#22C55E]/20 flex items-center justify-center text-[#22C55E]">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-white uppercase tracking-tight">Fast Check</h2>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Reporte Rápido de Terreno</p>
              </div>
            </div>
            <button onClick={resetAndClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-500">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6">
            {!result ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">
                    ¿Qué estás observando?
                  </label>
                  <textarea
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    placeholder="Ej: Hay un cable pelado cerca del generador principal, hay agua en el piso..."
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#22C55E]/50 transition-all resize-none h-32"
                    required
                  />
                </div>
                
                <div className="flex gap-3">
                  <button type="button" className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-colors flex items-center justify-center gap-2">
                    <Camera className="w-4 h-4" />
                    Foto
                  </button>
                  <button 
                    type="submit"
                    disabled={isAnalyzing || !observation.trim() || !selectedProject}
                    className="flex-[2] bg-[#22C55E] hover:bg-[#16A34A] disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-4 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-colors flex items-center justify-center gap-2"
                  >
                    {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {isAnalyzing ? 'Analizando con IA...' : 'Reportar y Ganar 50 PTS'}
                  </button>
                </div>
                {!selectedProject && (
                  <p className="text-red-400 text-[10px] font-bold uppercase tracking-widest text-center mt-2">
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
                <div className="bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-2xl p-6 text-center">
                  <div className="w-16 h-16 bg-[#22C55E]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-[#22C55E]" />
                  </div>
                  <h3 className="text-xl font-black text-white uppercase tracking-tight mb-2">¡Reporte Exitoso!</h3>
                  <p className="text-[#22C55E] text-sm font-bold">+50 Puntos de Guardián</p>
                </div>

                <div className="space-y-4 bg-zinc-950 rounded-2xl p-4 border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Clasificación IA</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                      result.criticidad === 'Alta' || result.criticidad === 'Crítica' ? 'bg-red-500/20 text-red-500' : 'bg-yellow-500/20 text-yellow-500'
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
                      <span key={i} className="px-2 py-1 bg-zinc-900 rounded-lg text-[9px] font-bold text-zinc-500 uppercase">
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
      </div>
    </AnimatePresence>
  );
}
