import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Scale, 
  BrainCircuit, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle,
  ArrowRight,
  Info
} from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { auditAISuggestion } from '../../services/geminiService';
import { NodeType } from '../../types';

export function EthicsGuardian() {
  const { nodes } = useUniversalKnowledge();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const normativesContext = useMemo(() => {
    return nodes
      .filter(n => n.type === NodeType.NORMATIVE)
      .map(n => `- ${n.title}: ${n.description}`)
      .join('\n');
  }, [nodes]);

  const handleAudit = async () => {
    if (!input.trim()) return;
    setLoading(true);
    try {
      const auditResult = await auditAISuggestion(input, normativesContext);
      setResult(auditResult);
    } catch (error) {
      console.error('Error auditing:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-500 border border-purple-500/20">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-tight">Guardián de la Ética</h3>
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Auditoría de IA contra Normativa y Valores</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full">
          <BrainCircuit className="w-3 h-3 text-purple-500" />
          <span className="text-[10px] font-black text-purple-500 uppercase tracking-widest">Cortex Audit: Active</span>
        </div>
      </header>

      <div className="space-y-4">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pega aquí una sugerencia de IA, un procedimiento o una idea para auditar éticamente..."
            className="w-full h-32 bg-black/30 border border-white/10 rounded-2xl p-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all resize-none"
          />
          <button
            onClick={handleAudit}
            disabled={loading || !input.trim()}
            className="absolute bottom-4 right-4 bg-purple-500 hover:bg-purple-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-purple-500/20 active:scale-95"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>Auditar</span>
          </button>
        </div>

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className={`p-6 rounded-2xl border ${
                result.isApproved ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'
              }`}
            >
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-3">
                  {result.isApproved ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="w-6 h-6 text-rose-500" />
                  )}
                  <div>
                    <h4 className={`text-lg font-black uppercase tracking-tight ${
                      result.isApproved ? 'text-emerald-500' : 'text-rose-500'
                    }`}>
                      {result.isApproved ? 'Sugerencia Aprobada' : 'Sugerencia Rechazada'}
                    </h4>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                      Nivel de Riesgo: <span className={
                        result.riskLevel === 'Alto' ? 'text-rose-500' : 
                        result.riskLevel === 'Medio' ? 'text-amber-500' : 'text-emerald-500'
                      }>{result.riskLevel}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Info className="w-3 h-3" /> Notas de Auditoría
                  </p>
                  <p className="text-sm text-zinc-300 leading-relaxed italic">
                    "{result.auditNotes}"
                  </p>
                </div>

                {result.suggestedAdjustments && (
                  <div className="p-4 bg-black/20 rounded-xl border border-white/5">
                    <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                      <ArrowRight className="w-3 h-3" /> Ajustes Sugeridos
                    </p>
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      {result.suggestedAdjustments}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
