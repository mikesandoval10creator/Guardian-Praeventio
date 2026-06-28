import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
// Sprint 29 Bucket BB H24 — lazy split: KnowledgeGraph carries
// react-force-graph + three.js (~1MB). Suspended on entry to
// /risk-network so the surrounding page renders immediately.
const KnowledgeGraph = lazy(() =>
  import('../components/shared/KnowledgeGraph').then((m) => ({ default: m.KnowledgeGraph })),
);
import { RiskNetworkExplorer } from '../components/risk-network/RiskNetworkExplorer';
import { RiskNetworkHealth } from '../components/risk-network/RiskNetworkHealth';
import { RiskNetworkManager } from '../components/risk-network/RiskNetworkManager';
import { Brain, Network, Zap, Info, Clock, Activity, ArrowRight, Sparkles, Loader2, Maximize2, Minimize2, Box, LayoutGrid, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { analyzeRiskNetwork, predictAccidents } from '../services/geminiService';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { get } from 'idb-keyval';
import { logger } from '../utils/logger';

import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { DataLoadErrorBanner } from '../components/shared/DataLoadErrorBanner';

/**
 * Pure resolver for the `?node=` deep-link query parameter.
 *
 * Returns the trimmed node id only when (a) the param is present and
 * non-empty after trimming, and (b) the id exists in the loaded node set.
 * Otherwise returns null so callers can fall back to the default
 * "show generic graph" behaviour without conditional ladders.
 *
 * Exported separately from the component so the contract can be unit-tested
 * without spinning up jsdom or React (see RiskNetwork.test.tsx).
 */
export function resolveSelectedNodeIdFromSearch(
  params: URLSearchParams,
  knownIds: Iterable<string>,
): string | null {
  const raw = params.get('node');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Materialise into a Set only if we got a non-Set iterable, so the
  // caller can pass either shape without paying for an extra allocation.
  const idSet = knownIds instanceof Set ? knownIds : new Set(knownIds);
  return idSet.has(trimmed) ? trimmed : null;
}

export function RiskNetwork() {
  const { t } = useTranslation();
  const { nodes, loading, error: nodesError } = useRiskEngine();
  const [activeTab, setActiveTab] = useState<'graph' | 'explorer' | 'health' | 'manager'>('graph');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiInsight, setAiInsight] = useState<any>(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictions, setPredictions] = useState<any[]>([]);
  const isOnline = useOnlineStatus();

  // Deep-link support: when arriving here from `/risk-network?node=<id>`
  // (e.g. Round 12's Projects.tsx climate-risk row click), surface the
  // requested node so the graph child can centre/highlight it.
  // We persist the validated id in `selectedNodeId` and expose it on the
  // page root as `data-selected-node-id`. Wiring it through to
  // KnowledgeGraph as a controlled prop is a follow-up (out of scope here:
  // KnowledgeGraph is owned by another agent).
  const [searchParams] = useSearchParams();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  useEffect(() => {
    // Re-run whenever either the URL param or the loaded node set changes:
    // on first render `nodes` is typically empty (loading), and we need to
    // pick up the selection once data arrives.
    const resolved = resolveSelectedNodeIdFromSearch(
      searchParams,
      nodes.map((n) => n.id),
    );
    if (resolved === null && searchParams.get('node')) {
      // The user deep-linked to something we couldn't find. Surface this
      // at debug level so support can spot it in logs without spamming
      // the console for the common (no-param) path.
      logger.debug(
        `RiskNetwork: ?node=${searchParams.get('node')} not found in loaded set (${nodes.length} nodes); falling back to default view`,
      );
    }
    setSelectedNodeId(resolved);
  }, [searchParams, nodes]);

  const handleAnalyze = async () => {
    if (nodes.length === 0 || !isOnline) return;
    setIsAnalyzing(true);
    try {
      const context = nodes.map(n => `${n.type}: ${n.title} - ${n.description}`).join('\n');
      const result = await analyzeRiskNetwork(context);
      setAiInsight(result);
    } catch (error) {
      logger.error("Error analyzing nodes:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePredict = async () => {
    if (nodes.length === 0 || !isOnline) return;
    setIsPredicting(true);
    try {
      const context = nodes.map(n => `${n.type}: ${n.title} - ${n.description}`).join('\n');
      
      // Gather telemetry context from IndexedDB. Telemetry.tsx persists under
      // the 'telemetry_state' key — reading 'twinState' (a key nobody writes)
      // fed the accident predictor an always-empty telemetry context.
      const twinState: any = (await get('telemetry_state')) || {};
      const bioMetrics: any[] = (await get('bioMetricsHistory')) || [];
      const latestBio = bioMetrics.length > 0 ? bioMetrics[bioMetrics.length - 1] : null;
      
      const telemetryContext = `
        Estado Maquinaria: ${JSON.stringify(twinState.machinery || {})}
        Estado Trabajadores: ${JSON.stringify(twinState.workers || {})}
        Última Biometría: ${latestBio ? JSON.stringify(latestBio) : 'Sin datos recientes'}
      `;

      const result = await predictAccidents(context, telemetryContext);
      setPredictions(result.predictions || []);
    } catch (error) {
      logger.error("Error predicting accidents:", error);
    } finally {
      setIsPredicting(false);
    }
  };

  const recentNodes = [...nodes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const stats = {
    totalNodes: nodes.length,
    totalConnections: nodes.reduce((acc, node) => acc + node.connections.length, 0) / 2,
    avgConnections: nodes.length > 0 
      ? (nodes.reduce((acc, node) => acc + node.connections.length, 0) / nodes.length).toFixed(1)
      : 0
  };
  return (
    <div
      className={`p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 w-full overflow-hidden box-border`}
      data-page="risk-network"
      data-selected-node-id={selectedNodeId ?? ''}
    >
        <DataLoadErrorBanner error={nodesError} resourceLabel={t('risk_network.resource_label')} />

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 p-3 sm:p-4 rounded-2xl sm:rounded-3xl border border-[#4db6ac]/20 dark:border-[#d4af37]/20 shrink-0">
              <Brain className="w-6 h-6 sm:w-8 sm:h-8 text-[#4db6ac] dark:text-[#d4af37]" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-primary-token leading-tight">{t('risk_network.title')}</h1>
              <p className="text-zinc-500 text-[10px] sm:text-sm font-medium mt-1">{t('risk_network.subtitle')}</p>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl flex items-center gap-1.5 sm:gap-2">
              <Zap className="w-3 h-3 sm:w-4 sm:h-4 text-amber-500" />
              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-token">{t('risk_network.active_consciousness')}</span>
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl flex items-center gap-1.5 sm:gap-2">
              <Network className="w-3 h-3 sm:w-4 sm:h-4 text-[#4db6ac] dark:text-[#d4af37]" />
              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-muted-token">{t('risk_network.realtime_synapses')}</span>
            </div>
          </div>
        </div>

      {/* Info Banner */}
      <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface border border-zinc-200 dark:border-white/10 rounded-3xl p-6 flex items-start gap-4"
        >
          <div className="bg-blue-500/10 p-2 rounded-xl">
            <Info className="w-5 h-5 text-blue-500" />
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary-token">{t('risk_network.info_banner.title')}</h3>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-500 leading-relaxed max-w-2xl">
              {t('risk_network.info_banner.body')}
            </p>
          </div>
        </motion.div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl w-fit">
        {[
          { id: 'graph', label: t('risk_network.tabs.graph'), icon: Network },
          { id: 'explorer', label: t('risk_network.tabs.explorer'), icon: LayoutGrid },
          { id: 'health', label: t('risk_network.tabs.health'), icon: Activity },
          { id: 'manager', label: t('risk_network.tabs.manager'), icon: Settings },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id 
                ? 'bg-[#4db6ac] text-white shadow-lg shadow-[#4db6ac]/20'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/5'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="space-y-8">
        <ErrorBoundary silent>
          {activeTab === 'graph' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">{t('risk_network.graph_viz_heading')}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mr-2">{t('risk_network.graph_viz_hint')}</span>
                </div>
              </div>
              <Suspense fallback={
                <div className="w-full h-[600px] flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
              }>
                <KnowledgeGraph controlledSelectedId={selectedNodeId} />
              </Suspense>
            </motion.div>
          )}

          {activeTab === 'explorer' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <RiskNetworkExplorer />
            </motion.div>
          )}

          {activeTab === 'health' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <RiskNetworkHealth />
            </motion.div>
          )}

          {activeTab === 'manager' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <RiskNetworkManager />
            </motion.div>
          )}
        </ErrorBoundary>
      </div>

      {/* Insights Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary-token">{t('risk_network.recent_nodes')}</h3>
            <Clock className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
              </div>
            ) : recentNodes.length === 0 ? (
              <p className="text-xs text-muted-token text-center py-4">{t('risk_network.no_recent_nodes')}</p>
            ) : (
              recentNodes.map((node) => (
                <div key={node.id} className="group flex items-center justify-between p-3 bg-white dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/5 hover:border-[#4db6ac]/30 transition-all cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(77,182,172,0.5)]" />
                    <div>
                      <p className="text-[11px] font-bold text-primary-token group-hover:text-[#4db6ac] dark:group-hover:text-[#d4af37] transition-colors">{node.title}</p>
                      <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{node.type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-zinc-600 font-medium">
                      {format(new Date(node.updatedAt), 'HH:mm', { locale: es })}
                    </p>
                    <ArrowRight className="w-3 h-3 text-zinc-400 dark:text-zinc-700 group-hover:text-[#4db6ac] dark:group-hover:text-[#d4af37] transition-colors ml-auto mt-1" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary-token">{t('risk_network.connections_analysis')}</h3>
            <Activity className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">{t('risk_network.synapse_density')}</p>
              <p className="text-2xl font-black text-primary-token tracking-tighter">{stats.totalConnections}</p>
              <p className="text-[9px] text-[#4db6ac] dark:text-[#d4af37] font-bold mt-1 uppercase tracking-wider">{t('risk_network.total_connections')}</p>
            </div>
            <div className="p-4 bg-white dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">{t('risk_network.network_factor')}</p>
              <p className="text-2xl font-black text-primary-token tracking-tighter">{stats.avgConnections}</p>
              <p className="text-[9px] text-blue-600 dark:text-blue-500 font-bold mt-1 uppercase tracking-wider">{t('risk_network.avg_per_node')}</p>
            </div>
          </div>
          <div className="pt-2">
            <div className="bg-[#4db6ac]/10 dark:bg-[#4db6ac]/10 border border-[#4db6ac]/20 dark:border-[#d4af37]/20 rounded-2xl p-4">
              <p className="text-[10px] text-[#2a8a81] dark:text-[#d4af37] leading-relaxed font-medium">
                <Trans
                  i18nKey="risk_network.capacity_note"
                  values={{ capacity: Math.min(100, stats.totalNodes * 5).toFixed(0) }}
                  components={{ b: <span className="font-black" /> }}
                />
              </p>
            </div>
          </div>
          <div className="pt-4 border-t border-zinc-200 dark:border-white/5">
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || nodes.length === 0 || !isOnline}
              className="w-full flex items-center justify-center gap-2 bg-[var(--btn-secondary-bg)] hover:opacity-80 disabled:opacity-50 text-[var(--btn-secondary-text,white)] py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg"
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {!isOnline ? t('risk_network.requires_connection') : isAnalyzing ? t('risk_network.analyzing') : t('risk_network.analyze_network')}
            </button>
            
            {aiInsight && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 bg-white dark:bg-zinc-950 border border-[#4db6ac]/30 dark:border-[#d4af37]/50 rounded-2xl shadow-sm"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
                  <h4 className="text-xs font-black text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-widest">{t('risk_network.guardian_insight')}</h4>
                </div>
                <p className="text-xs text-secondary-token leading-relaxed">{aiInsight.analysis}</p>
                {aiInsight.recommendations && aiInsight.recommendations.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {aiInsight.recommendations.map((rec: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[10px] text-secondary-token">
                        <ArrowRight className="w-3 h-3 text-[#4db6ac] dark:text-[#d4af37] shrink-0 mt-0.5" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 space-y-4 md:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary-token">{t('risk_network.predictive_hub')}</h3>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-[10px] text-secondary-token leading-relaxed">
            {t('risk_network.predictive_hub_desc')}
          </p>
          <button
            onClick={handlePredict}
            disabled={isPredicting || nodes.length === 0 || !isOnline}
            className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-rose-500/20"
          >
            {isPredicting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            {!isOnline ? t('risk_network.requires_connection') : isPredicting ? t('risk_network.predicting') : t('risk_network.predict_imminent')}
          </button>

          {predictions.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {predictions.map((pred, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="p-4 bg-white dark:bg-zinc-950 border border-rose-200 dark:border-rose-500/50 rounded-2xl flex flex-col h-full shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-primary-token line-clamp-1">{pred.title}</h4>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full shrink-0 ${
                      pred.probability > 70 ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-500' : 
                      pred.probability > 40 ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-500' : 
                      'bg-[#4db6ac]/20 dark:bg-[#d4af37]/20 text-[#4db6ac] dark:text-[#d4af37]'
                    }`}>
                      {t('risk_network.probability_pct', { value: pred.probability })}
                    </span>
                  </div>
                  <p className="text-[10px] text-secondary-token mb-3 flex-grow">{pred.description}</p>
                  <div className="bg-rose-50 dark:bg-rose-500/10 p-3 rounded-xl border border-rose-100 dark:border-rose-500/20 mt-auto">
                    <p className="text-[9px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-1">{t('risk_network.immediate_action')}</p>
                    <p className="text-[10px] text-rose-700 dark:text-rose-200">{pred.preventiveAction}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
