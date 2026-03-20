import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, AlertTriangle, CheckCircle2, Zap, FileText, ArrowRight, Save } from 'lucide-react';
import { investigateIncidentWithAI } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useProject } from '../../contexts/ProjectContext';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { NodeType } from '../../types';

export function IncidentInvestigation() {
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const { nodes } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const { addNode } = useZettelkasten();

  const handleInvestigate = async () => {
    if (!incidentTitle || !selectedProject) return;
    setLoading(true);
    setAnalysis(null);
    setSaved(false);
    try {
      const context = nodes
        .filter(n => n.projectId === selectedProject.id)
        .map(n => `- [${n.type}] ${n.title}: ${n.description}`)
        .join('\n');

      const result = await investigateIncidentWithAI(incidentTitle, incidentDescription, context);
      setAnalysis(result);
    } catch (error) {
      console.error('Error investigating incident:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!analysis || !selectedProject) return;
    setLoading(true);
    try {
      // Create a FINDING node for the investigation
      const investigationNode = await addNode({
        type: NodeType.FINDING,
        title: `Investigación IA: ${incidentTitle}`,
        description: analysis.summary,
        tags: ['Investigación', 'IA', 'Incidente', selectedProject.name],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          immediateCauses: analysis.immediateCauses,
          rootCauses: analysis.rootCauses,
          generatedBy: 'El Guardián AI',
          timestamp: new Date().toISOString()
        }
      });

      // Create TASK nodes for each corrective action
      for (const action of analysis.correctiveActions) {
        await addNode({
          type: NodeType.TASK,
          title: action.action,
          description: `Acción correctiva derivada de la investigación: ${incidentTitle}`,
          tags: ['Correctiva', 'IA', action.priority],
          projectId: selectedProject.id,
          connections: [investigationNode.id],
          metadata: {
            priority: action.priority,
            status: 'pending',
            source: 'AI Investigation'
          }
        });
      }

      setSaved(true);
    } catch (error) {
      console.error('Error saving investigation:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-6">
      <header className="flex items-center gap-4">
        <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500 border border-amber-500/20">
          <Search className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-xl font-black text-white uppercase tracking-tight">Asistente de Investigación</h3>
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Análisis de Causa Raíz con IA</p>
        </div>
      </header>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Título del Incidente</label>
          <input
            type="text"
            value={incidentTitle}
            onChange={(e) => setIncidentTitle(e.target.value)}
            placeholder="Ej: Caída de altura en zona de carga"
            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
          />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Descripción / Relato</label>
          <textarea
            value={incidentDescription}
            onChange={(e) => setIncidentDescription(e.target.value)}
            placeholder="Describe lo sucedido con el mayor detalle posible..."
            rows={3}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all resize-none"
          />
        </div>
        <button
          onClick={handleInvestigate}
          disabled={loading || !incidentTitle || !selectedProject}
          className="w-full bg-amber-500 hover:bg-amber-600 text-black font-black py-4 rounded-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
          <span className="uppercase tracking-widest text-sm">Iniciar Investigación IA</span>
        </button>
      </div>

      <AnimatePresence>
        {analysis && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="space-y-6 pt-6 border-t border-white/5"
          >
            <div className="p-6 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Análisis de Resultados
                </h4>
                <button
                  onClick={handleSave}
                  disabled={loading || saved}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
                    saved ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-white text-black hover:bg-zinc-200'
                  }`}
                >
                  {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {saved ? 'Guardado' : 'Guardar en Zettelkasten'}
                </button>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{analysis.summary}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h5 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Causas Inmediatas</h5>
                <div className="space-y-2">
                  {analysis.immediateCauses.map((cause: string, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <p className="text-xs text-zinc-400">{cause}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-4">
                <h5 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Causas Raíz (5 Porqués)</h5>
                <div className="space-y-2">
                  {analysis.rootCauses.map((cause: string, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                      <p className="text-xs text-zinc-400">{cause}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h5 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Acciones Correctivas Sugeridas</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analysis.correctiveActions.map((action: any, i: number) => (
                  <div key={i} className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-white">{action.action}</p>
                      <div className="flex items-center gap-2">
                        <span className={`text-[8px] font-black uppercase tracking-widest ${
                          action.priority === 'Alta' ? 'text-rose-500' : 'text-emerald-500'
                        }`}>Prioridad {action.priority}</span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-emerald-500 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
