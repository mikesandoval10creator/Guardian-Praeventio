import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Brain, Zap, Network, AlertCircle, CheckCircle2, Loader2, Sparkles, ArrowRight, WifiOff } from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { analyzeRiskNetworkHealth } from '../../services/geminiService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export function RiskNetworkHealth() {
  const { nodes, stats, loading: nodesLoading } = useUniversalKnowledge();
  const { addConnection } = useRiskEngine();
  const [analyzing, setAnalyzing] = useState(false);
  const [insights, setInsights] = useState<any>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  const analyzeHealth = async () => {
    if (nodes.length === 0 || !isOnline) return;
    setAnalyzing(true);
    try {
      const data = await analyzeRiskNetworkHealth(nodes);
      setInsights(data);
    } catch (error) {
      console.error('Error analyzing Risk Network health:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAutoConnect = async (sourceId: string, targetId: string, synapseId: string) => {
    if (!isOnline) return;
    setConnecting(synapseId);
    try {
      await addConnection(sourceId, targetId);
      // Remove from insights locally
      setInsights((prev: any) => ({
        ...prev,
        missingSynapses: prev.missingSynapses.filter((s: any) => `${s.sourceId}-${s.targetId}` !== synapseId)
      }));
    } catch (error) {
      console.error('Error auto-connecting:', error);
    } finally {
      setConnecting(null);
    }
  };

  if (nodesLoading) return null;

  return (
    <section className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-[32px] p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20 shrink-0">
            <Brain className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Salud de la Red Neuronal</h2>
            <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Optimización de Sinapsis y Cobertura de Conocimiento</p>
          </div>
        </div>
        <button
          onClick={analyzeHealth}
          disabled={analyzing || nodes.length === 0 || !isOnline}
          className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg transition-all active:scale-95 disabled:opacity-50 ${
            !isOnline ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
          }`}
        >
          {!isOnline ? (
            <WifiOff className="w-4 h-4" />
          ) : analyzing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>{!isOnline ? 'Requiere Conexión' : 'Auditar Red con IA'}</span>
        </button>
      </div>

      {!insights ? (
        <div className="bg-zinc-50 dark:bg-zinc-800/30 border border-dashed border-zinc-200 dark:border-white/10 rounded-3xl p-12 text-center">
          <p className="text-zinc-500 text-sm leading-relaxed max-w-md mx-auto">
            El Guardián puede auditar tu Red Neuronal para encontrar conexiones perdidas y brechas críticas de seguridad.
          </p>
        </div>
      ) : (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Health Score */}
          <div className="flex items-center gap-6 p-6 bg-zinc-50 dark:bg-white/5 rounded-3xl border border-zinc-200 dark:border-white/5">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90">
                <circle
                  cx="40"
                  cy="40"
                  r="36"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  className="text-zinc-200 dark:text-zinc-800"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="36"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeDasharray={226}
                  strokeDashoffset={226 - (226 * insights.healthScore) / 100}
                  className="text-emerald-500 transition-all duration-1000"
                />
              </svg>
              <span className="absolute text-xl font-black text-zinc-900 dark:text-white">{insights.healthScore}%</span>
            </div>
            <div>
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">Índice de Coherencia</h3>
              <p className="text-xs text-zinc-500">Nivel de interconectividad y completitud de la red actual.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Missing Synapses */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                <Network className="w-3 h-3 text-blue-500" />
                Sinapsis Sugeridas
              </h4>
              <div className="space-y-3">
                {insights.missingSynapses.map((syn: any, i: number) => {
                  const synapseId = `${syn.sourceId}-${syn.targetId}`;
                  return (
                    <div key={i} className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-4 space-y-3 hover:border-blue-500/30 transition-colors group">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-zinc-900 dark:text-white truncate">{syn.sourceTitle}</span>
                          <ArrowRight className="w-3 h-3 text-zinc-400 dark:text-zinc-600 shrink-0" />
                          <span className="text-[10px] font-bold text-zinc-900 dark:text-white truncate">{syn.targetTitle}</span>
                        </div>
                        <button
                          onClick={() => handleAutoConnect(syn.sourceId, syn.targetId, synapseId)}
                          disabled={connecting === synapseId}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[8px] font-black uppercase tracking-widest transition-all shrink-0"
                        >
                          {connecting === synapseId ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Conectar'}
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-relaxed italic">
                        "{syn.reason}"
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Knowledge Gaps */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                <AlertCircle className="w-3 h-3 text-amber-500" />
                Brechas Detectadas
              </h4>
              <div className="space-y-3">
                {insights.knowledgeGaps.map((gap: any, i: number) => (
                  <div key={i} className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h5 className="text-[11px] font-black text-zinc-900 dark:text-white uppercase tracking-tight">{gap.topic}</h5>
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${
                        gap.priority === 'Alta' ? 'bg-rose-500/10 text-rose-500' :
                        gap.priority === 'Media' ? 'bg-amber-500/10 text-amber-500' :
                        'bg-blue-500/10 text-blue-500'
                      }`}>
                        {gap.priority}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">{gap.suggestion}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
