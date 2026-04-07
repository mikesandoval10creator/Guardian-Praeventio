import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2, Zap, BarChart3, ArrowRight, FileWarning, WifiOff } from 'lucide-react';
import { auditProjectComplianceWithAI } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function ComplianceAuditor() {
  const [loading, setLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<any>(null);
  const { nodes } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  const handleAudit = async () => {
    if (!selectedProject || !isOnline) return;
    setLoading(true);
    setAuditResult(null);
    try {
      const projectNodes = nodes.filter(n => n.projectId === selectedProject.id);
      const projectContext = projectNodes
        .map(n => `- [${n.type}] ${n.title}: ${n.description}`)
        .join('\n');

      const normativeNodes = nodes.filter(n => n.type === NodeType.NORMATIVE);
      const normativeContext = normativeNodes
        .map(n => `- ${n.title}: ${n.description}`)
        .join('\n');

      const result = await auditProjectComplianceWithAI(
        selectedProject.name,
        projectContext || 'Sin datos en el proyecto.',
        normativeContext || 'Sin base normativa cargada.'
      );
      setAuditResult(result);
    } catch (error) {
      console.error('Error performing compliance audit:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 border border-emerald-500/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Auditor de Cumplimiento</h3>
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Auditoría Normativa Automatizada</p>
          </div>
        </div>
        <button
          onClick={handleAudit}
          disabled={loading || !selectedProject || !isOnline}
          className={`px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50 ${
            !isOnline ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600 text-black'
          }`}
        >
          {!isOnline ? (
            <WifiOff className="w-4 h-4" />
          ) : loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {!isOnline ? 'Requiere Conexión' : 'Ejecutar Auditoría'}
        </button>
      </header>

      <AnimatePresence>
        {auditResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="space-y-8 pt-6 border-t border-white/5"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 bg-white/5 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-center space-y-2">
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Puntaje de Cumplimiento</p>
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="transparent"
                      className="text-zinc-800"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="transparent"
                      strokeDasharray={251.2}
                      strokeDashoffset={251.2 - (251.2 * auditResult.complianceScore) / 100}
                      className={auditResult.complianceScore > 80 ? 'text-emerald-500' : auditResult.complianceScore > 50 ? 'text-amber-500' : 'text-rose-500'}
                    />
                  </svg>
                  <span className="absolute text-2xl font-black text-zinc-900 dark:text-white">{auditResult.complianceScore}%</span>
                </div>
              </div>
              <div className="md:col-span-2 p-6 bg-zinc-50 dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/5 space-y-4">
                <h4 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-500" /> Resumen Ejecutivo
                </h4>
                <p className="text-sm text-zinc-400 leading-relaxed">{auditResult.summary}</p>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <FileWarning className="w-4 h-4 text-rose-500" /> Brechas Críticas Detectadas
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {auditResult.criticalGaps.map((gap: any, i: number) => (
                  <div key={i} className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-2xl space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <h5 className="text-xs font-bold text-zinc-900 dark:text-white">{gap.gap}</h5>
                      <span className="px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded text-[8px] font-black text-rose-500 uppercase">
                        {gap.severity}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 font-medium italic">Ref: {gap.regulation}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Recomendaciones de Mejora
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {auditResult.recommendations.map((rec: string, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                    <ArrowRight className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-zinc-400">{rec}</p>
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
