import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Brain, Zap, Network, AlertCircle, CheckCircle2, Loader2, Sparkles, ArrowRight, WifiOff, ShieldAlert, ShieldCheck, Scale } from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { computeOfflineNetworkHealth, type OfflineHealthInsights } from '../../services/graphAnalytics';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { logger } from '../../utils/logger';
import { NodeType } from '../../types';
import { detectUncontrolledRisks } from '../../services/zettelkasten/riskOrchestrator';

export function RiskNetworkHealth() {
  const { nodes, loading: nodesLoading } = useUniversalKnowledge();
  const { addConnection } = useRiskEngine();
  const [analyzing, setAnalyzing] = useState(false);
  const [insights, setInsights] = useState<OfflineHealthInsights | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  // Zettelkasten 2: Detección OFFLINE de riesgos sin control.
  // Filtra nodos RISK que no tienen ningún nodo CONTROL conectado.
  const uncontrolledAlerts = useMemo(() => {
    const riskNodes = nodes.filter((n) => n.type === NodeType.RISK);
    if (riskNodes.length === 0) return [];

    // Construir mapa: nodeId → Set<connectedIds> (bidireccional)
    const controlNodeIds = new Set(
      nodes.filter((n) => n.type === NodeType.CONTROL).map((n) => n.id),
    );
    const riskIdsWithControl = new Set<string>();

    for (const risk of riskNodes) {
      // ¿El riesgo tiene un CONTROL en sus connections?
      const hasControl = risk.connections?.some((cid) => controlNodeIds.has(cid));
      if (hasControl) riskIdsWithControl.add(risk.id);
    }

    // También: ¿algún CONTROL tiene este riesgo en sus connections?
    for (const ctrl of nodes.filter((n) => n.type === NodeType.CONTROL)) {
      for (const cid of ctrl.connections ?? []) {
        if (riskNodes.some((r) => r.id === cid)) {
          riskIdsWithControl.add(cid);
        }
      }
    }

    return detectUncontrolledRisks(
      riskNodes.map((r) => ({ id: r.id, title: r.title, type: r.type, metadata: r.metadata })),
      riskIdsWithControl,
    );
  }, [nodes]);

  const analyzeHealth = async () => {
    if (nodes.length === 0 || !isOnline) return;
    setAnalyzing(true);
    try {
      // Deterministic offline analysis — no Gemini, no network.
      const data = computeOfflineNetworkHealth(nodes);
      setInsights(data);
    } catch (error) {
      logger.error('Error analyzing Risk Network health:', error);
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
      setInsights((prev) => prev && ({
        ...prev,
        missingSynapses: prev.missingSynapses.filter((s) => `${s.sourceId}-${s.targetId}` !== synapseId)
      }));
    } catch (error) {
      logger.error('Error auto-connecting:', error);
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
            <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Análisis Determinista — Offline</p>
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
          <span>{!isOnline ? 'Requiere Conexión' : 'Analizar Red'}</span>
        </button>
      </div>

      {!insights ? (
        <div className="bg-zinc-50 dark:bg-zinc-800/30 border border-dashed border-zinc-200 dark:border-white/10 rounded-3xl p-12 text-center">
          <p className="text-zinc-500 text-sm leading-relaxed max-w-md mx-auto">
            Análisis determinista de la Red Neuronal: conectividad, nodos aislados y riesgos emergentes — sin conexión requerida.
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
              <p className="text-xs text-zinc-500">Conectividad, aislamiento y riesgos emergentes — cálculo determinista.</p>
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
                {insights.missingSynapses.length === 0 ? (
                  <p className="text-[10px] text-zinc-400 italic px-2">Sin nodos aislados — la red está bien conectada.</p>
                ) : (
                  insights.missingSynapses.map((syn, i) => {
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
                  })
                )}
              </div>
            </div>

            {/* Knowledge Gaps */}
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2">
                <AlertCircle className="w-3 h-3 text-amber-500" />
                Brechas Detectadas
              </h4>
              <div className="space-y-3">
                {insights.knowledgeGaps.length === 0 ? (
                  <p className="text-[10px] text-zinc-400 italic px-2">Sin brechas críticas detectadas.</p>
                ) : (
                  insights.knowledgeGaps.map((gap, i) => (
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
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────
          Zettelkasten 2: Riesgos sin control = Norma exigible violada
          OFFLINE — no requiere conexión ni Gemini.
          ───────────────────────────────────────────────────────────────── */}
      {uncontrolledAlerts.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-white/10">
          <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-2 flex items-center gap-2">
            <ShieldAlert className="w-3 h-3 text-rose-500" />
            Riesgos sin Control — Norma Exigible Violada
            <span className="text-[8px] font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-500 ml-auto">
              {uncontrolledAlerts.length}
            </span>
          </h4>
          <div className="space-y-3">
            {uncontrolledAlerts.map((alert) => (
              <div
                key={alert.riskNodeId}
                className={`bg-zinc-50 dark:bg-zinc-800/50 border rounded-2xl p-4 space-y-3 ${
                  alert.uncontrolledSeverity === 'critical'
                    ? 'border-rose-500/40 bg-rose-50/50 dark:bg-rose-950/20'
                    : alert.uncontrolledSeverity === 'high'
                    ? 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20'
                    : 'border-zinc-200 dark:border-white/5'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ShieldAlert className={`w-4 h-4 shrink-0 ${
                      alert.uncontrolledSeverity === 'critical' ? 'text-rose-500' :
                      alert.uncontrolledSeverity === 'high' ? 'text-amber-500' :
                      'text-zinc-400'
                    }`} />
                    <span className="text-[11px] font-black text-zinc-900 dark:text-white truncate">
                      {alert.riskTitle}
                    </span>
                  </div>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest shrink-0 ${
                    alert.uncontrolledSeverity === 'critical' ? 'bg-rose-500/10 text-rose-500' :
                    alert.uncontrolledSeverity === 'high' ? 'bg-amber-500/10 text-amber-500' :
                    alert.uncontrolledSeverity === 'medium' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-zinc-500/10 text-zinc-500'
                  }`}>
                    {alert.uncontrolledSeverity}
                  </span>
                </div>

                {/* Cita normativa */}
                <div className="flex items-start gap-2 bg-zinc-100 dark:bg-white/5 rounded-xl p-3">
                  <Scale className="w-3 h-3 text-blue-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                      {alert.normCode} — {alert.normArticle}
                    </p>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      {alert.requiredMeasure}
                    </p>
                  </div>
                </div>

                {/* Control sugerido */}
                <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl p-3">
                  <ShieldCheck className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                      Control sugerido — {alert.estimatedEffectiveness}% efectividad estimada
                    </p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 leading-relaxed">
                      {alert.suggestedControl}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
