import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BrainCircuit, Loader2, AlertTriangle, CheckCircle2, FileText, Sparkles } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useProject } from '../../contexts/ProjectContext';
import { analyzePsychosocialRisks } from '../../services/geminiService';

interface AIPsychosocialAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIPsychosocialAnalysisModal({ isOpen, onClose }: AIPsychosocialAnalysisModalProps) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const { nodes } = useRiskEngine();
  const { selectedProject } = useProject();

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const projectNodes = selectedProject 
        ? nodes.filter(n => n.projectId === selectedProject.id)
        : nodes;

      const result = await analyzePsychosocialRisks(JSON.stringify(projectNodes.slice(0, 50)));
      setAnalysis(result);
    } catch (error) {
      console.error('Error analyzing psychosocial data:', error);
      setAnalysis('Ocurrió un error al generar el análisis. Por favor, intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-indigo-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-500">
                  <BrainCircuit className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Análisis Predictivo Psicosocial IA</h2>
                  <p className="text-xs text-zinc-400">Correlación de datos de la Red Neuronal para detectar riesgos ocultos</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
              {!analysis && !loading ? (
                <div className="text-center py-12">
                  <BrainCircuit className="w-16 h-16 text-indigo-500/50 mx-auto mb-6" />
                  <h3 className="text-xl font-bold text-white mb-2">Iniciar Análisis Profundo</h3>
                  <p className="text-zinc-400 max-w-md mx-auto mb-8">
                    La IA analizará los incidentes, hallazgos y evaluaciones previas para encontrar patrones de estrés, fatiga o problemas de clima laboral.
                  </p>
                  <button
                    onClick={handleAnalyze}
                    className="bg-indigo-500 hover:bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2 mx-auto"
                  >
                    <Sparkles className="w-5 h-5" />
                    Generar Reporte Predictivo
                  </button>
                </div>
              ) : loading ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                  <p className="text-indigo-400 font-bold animate-pulse">Analizando correlaciones en la Red Neuronal...</p>
                  <p className="text-xs text-zinc-500 mt-2">Buscando patrones de fatiga, estrés y clima laboral</p>
                </div>
              ) : (
                <div className="prose prose-invert max-w-none prose-indigo">
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-6 mb-8">
                    <div className="flex items-start gap-4">
                      <AlertTriangle className="w-6 h-6 text-indigo-400 shrink-0 mt-1" />
                      <div>
                        <h4 className="text-indigo-400 font-bold mb-2">Aviso Importante</h4>
                        <p className="text-sm text-indigo-400/80 leading-relaxed">
                          Este análisis es generado por Inteligencia Artificial basado en los datos disponibles en la plataforma. No reemplaza la evaluación profesional de un psicólogo ocupacional ni la aplicación formal del cuestionario SUSESO/ISTAS21.
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Simple Markdown Rendering */}
                  <div className="space-y-4 text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {analysis}
                  </div>
                </div>
              )}
            </div>

            {analysis && (
              <div className="p-6 border-t border-white/5 bg-zinc-900/50 shrink-0 flex justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-6 py-3 rounded-xl font-bold text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Cerrar
                </button>
                <button
                  onClick={handleAnalyze}
                  className="px-6 py-3 rounded-xl font-bold text-white bg-indigo-500 hover:bg-indigo-600 transition-colors flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  Re-analizar
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
