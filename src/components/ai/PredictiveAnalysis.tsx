import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Zap, AlertTriangle, Shield, CheckCircle2, Loader2, FileText, Download, X } from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { predictGlobalIncidents, generateSafetyReport } from '../../services/geminiService';
import ReactMarkdown from 'react-markdown';

export function PredictiveAnalysis() {
  const { nodes, loading: nodesLoading } = useUniversalKnowledge();
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const runAnalysis = async () => {
    if (nodes.length === 0) return;
    setAnalyzing(true);
    try {
      const context = nodes.map(n => `- [${n.type}] ${n.title}: ${n.description} (Tags: ${n.tags.join(', ')})`).join('\n');
      const data = await predictGlobalIncidents(context);
      setResults(data);
    } catch (error) {
      console.error('Error running predictive analysis:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateReport = async (nodeId: string, title: string, description: string) => {
    setGeneratingReport(nodeId);
    try {
      const node = nodes.find(n => n.id === nodeId);
      const connections = node?.connections.map(id => nodes.find(n => n.id === id)?.title).join(', ') || 'Ninguna';
      const pts = await generateSafetyReport('PTS', `${title}: ${description}\nConexiones: ${connections}`);
      setReport(pts);
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setGeneratingReport(null);
    }
  };

  if (nodesLoading) {
    return (
      <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-12 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest">Sincronizando Grafo Universal...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
          <Brain className="w-32 h-32 text-blue-500" />
        </div>
        
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
                <Brain className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Análisis Predictivo de Incidentes</h2>
                <p className="text-zinc-400 text-sm">IA analizando el Grafo de Conocimiento Universal</p>
              </div>
            </div>
            <button
              onClick={runAnalysis}
              disabled={analyzing || nodes.length === 0}
              className="px-6 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center gap-2 active:scale-95"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Analizando...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Iniciar Predicción</span>
                </>
              )}
            </button>
          </div>

          {!results ? (
            <div className="bg-zinc-800/30 border border-dashed border-white/10 rounded-2xl p-12 text-center">
              <p className="text-zinc-500 text-sm leading-relaxed max-w-md mx-auto">
                Haz clic en "Iniciar Predicción" para que El Guardián analice los {nodes.length} nodos activos y detecte patrones de riesgo invisibles.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-zinc-800/50 border border-white/5 rounded-2xl p-6">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Probabilidad Hoy</p>
                  <p className={`text-3xl font-black ${results.probabilidadGlobal > 50 ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {results.probabilidadGlobal}%
                  </p>
                </div>
                <div className="bg-zinc-800/50 border border-white/5 rounded-2xl p-6">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Nivel de Riesgo</p>
                  <p className={`text-3xl font-black ${results.nivelRiesgo === 'Crítico' || results.nivelRiesgo === 'Alto' ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {results.nivelRiesgo}
                  </p>
                </div>
                <div className="bg-zinc-800/50 border border-white/5 rounded-2xl p-6">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Confianza IA</p>
                  <p className="text-3xl font-black text-blue-500">{results.confianza}%</p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-2">Predicciones Críticas</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {results.predicciones.map((pred: any, i: number) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-zinc-800/50 border border-white/5 rounded-2xl p-6 space-y-4 hover:border-blue-500/30 transition-colors group"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-500 border border-rose-500/20">
                            <AlertTriangle className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-white font-bold text-sm uppercase tracking-tight">{pred.titulo}</h4>
                            <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{pred.probabilidad}% Probabilidad</p>
                          </div>
                        </div>
                      </div>
                      
                      <p className="text-zinc-400 text-xs leading-relaxed">
                        {pred.razon}
                      </p>

                      <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                        <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">Mitigación Sugerida</p>
                        <p className="text-emerald-400/80 text-[11px] leading-snug">{pred.mitigacionSugerida}</p>
                      </div>

                      <button
                        onClick={() => handleGenerateReport(pred.nodoId, pred.titulo, pred.razon)}
                        disabled={generatingReport === pred.nodoId}
                        className="w-full py-2 rounded-xl bg-white/5 border border-white/10 text-white text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                      >
                        {generatingReport === pred.nodoId ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <FileText className="w-3 h-3" />
                        )}
                        Generar PTS con IA
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Report Modal/Overlay */}
      <AnimatePresence>
        {report && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-blue-500/10 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">Procedimiento de Trabajo Seguro (PTS)</h2>
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Generado por El Guardián AI</p>
                  </div>
                </div>
                <button 
                  onClick={() => setReport(null)}
                  className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
                >
                  <CheckCircle2 className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="markdown-body prose prose-invert max-w-none">
                  <ReactMarkdown>
                    {report}
                  </ReactMarkdown>
                </div>
              </div>

              <div className="p-8 border-t border-white/5 bg-zinc-900/50 flex justify-between items-center">
                <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                  Este documento es una sugerencia basada en IA. Debe ser validado por un experto.
                </p>
                <button className="px-6 py-3 rounded-xl bg-white text-black font-black text-[10px] uppercase tracking-widest hover:bg-zinc-200 transition-all flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Descargar PDF
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
