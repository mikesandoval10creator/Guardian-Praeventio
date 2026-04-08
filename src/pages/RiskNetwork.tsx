import React, { useState } from 'react';
import { KnowledgeGraph } from '../components/shared/KnowledgeGraph';
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

import { ErrorBoundary } from '../components/shared/ErrorBoundary';

export function RiskNetwork() {
  const { nodes, loading } = useRiskEngine();
  const [activeTab, setActiveTab] = useState<'graph' | 'explorer' | 'health' | 'manager'>('graph');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiInsight, setAiInsight] = useState<any>(null);
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictions, setPredictions] = useState<any[]>([]);
  const isOnline = useOnlineStatus();

  const handleAnalyze = async () => {
    if (nodes.length === 0 || !isOnline) return;
    setIsAnalyzing(true);
    try {
      const context = nodes.map(n => `${n.type}: ${n.title} - ${n.description}`).join('\n');
      const result = await analyzeRiskNetwork(context);
      setAiInsight(result);
    } catch (error) {
      console.error("Error analyzing nodes:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePredict = async () => {
    if (nodes.length === 0 || !isOnline) return;
    setIsPredicting(true);
    try {
      const context = nodes.map(n => `${n.type}: ${n.title} - ${n.description}`).join('\n');
      
      // Gather telemetry context from localStorage
      const twinState = JSON.parse(localStorage.getItem('twinState') || '{}');
      const bioMetrics = JSON.parse(localStorage.getItem('bioMetricsHistory') || '[]');
      const latestBio = bioMetrics.length > 0 ? bioMetrics[bioMetrics.length - 1] : null;
      
      const telemetryContext = `
        Estado Maquinaria: ${JSON.stringify(twinState.machinery || {})}
        Estado Trabajadores: ${JSON.stringify(twinState.workers || {})}
        Última Biometría: ${latestBio ? JSON.stringify(latestBio) : 'Sin datos recientes'}
      `;

      const result = await predictAccidents(context, telemetryContext);
      setPredictions(result.predictions || []);
    } catch (error) {
      console.error("Error predicting accidents:", error);
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
    <div className={`p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 w-full overflow-hidden box-border`}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="bg-emerald-500/10 p-3 sm:p-4 rounded-2xl sm:rounded-3xl border border-emerald-500/20 shrink-0">
              <Brain className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white leading-tight">El Cerebro</h1>
              <p className="text-zinc-500 text-[10px] sm:text-sm font-medium mt-1">Red Neuronal de Prevención y Conocimiento</p>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl flex items-center gap-1.5 sm:gap-2">
              <Zap className="w-3 h-3 sm:w-4 sm:h-4 text-amber-500" />
              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Conciencia Activa</span>
            </div>
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl flex items-center gap-1.5 sm:gap-2">
              <Network className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500" />
              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Sinapsis en Tiempo Real</span>
            </div>
          </div>
        </div>

      {/* Info Banner */}
      <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 flex items-start gap-4"
        >
          <div className="bg-blue-500/10 p-2 rounded-xl">
            <Info className="w-5 h-5 text-blue-500" />
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">¿Cómo funciona la Red Neuronal?</h3>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-500 leading-relaxed max-w-2xl">
              Cada análisis de riesgo, trabajador o normativa se convierte en un "nodo" de conocimiento. 
              El sistema conecta automáticamente estos nodos para revelar patrones invisibles, 
              permitiendo una gestión proactiva basada en la interconexión de datos.
            </p>
          </div>
        </motion.div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl w-fit">
        {[
          { id: 'graph', label: 'Grafo 3D', icon: Network },
          { id: 'explorer', label: 'Explorador', icon: LayoutGrid },
          { id: 'health', label: 'Salud de Red', icon: Activity },
          { id: 'manager', label: 'Gestor', icon: Settings },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id 
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
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
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Visualización del Grafo</h2>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mr-2">Interactúa con los nodos para ver detalles</span>
                </div>
              </div>
              <KnowledgeGraph />
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
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">Nodos Recientes</h3>
            <Clock className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="space-y-3">
            {loading ? (
              <p className="text-[10px] text-zinc-500 animate-pulse">Sincronizando con la red neuronal...</p>
            ) : recentNodes.length > 0 ? (
              recentNodes.map((node) => (
                <div key={node.id} className="group flex items-center justify-between p-3 bg-white dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/5 hover:border-emerald-500/30 transition-all cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <div>
                      <p className="text-[11px] font-bold text-zinc-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{node.title}</p>
                      <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{node.type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-zinc-600 font-medium">
                      {format(new Date(node.updatedAt), 'HH:mm', { locale: es })}
                    </p>
                    <ArrowRight className="w-3 h-3 text-zinc-400 dark:text-zinc-700 group-hover:text-emerald-500 transition-colors ml-auto mt-1" />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[10px] text-zinc-500 italic">No hay nodos recientes. Comienza a crear análisis o inspecciones.</p>
            )}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">Análisis de Conexiones</h3>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Densidad de Sinapsis</p>
              <p className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter">{stats.totalConnections}</p>
              <p className="text-[9px] text-emerald-600 dark:text-emerald-500 font-bold mt-1 uppercase tracking-wider">Conexiones Totales</p>
            </div>
            <div className="p-4 bg-white dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Factor de Red</p>
              <p className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter">{stats.avgConnections}</p>
              <p className="text-[9px] text-blue-600 dark:text-blue-500 font-bold mt-1 uppercase tracking-wider">Promedio / Nodo</p>
            </div>
          </div>
          <div className="pt-2">
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl p-4">
              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 leading-relaxed font-medium">
                La red neuronal está operando al <span className="font-black">{(Math.min(100, (stats.totalNodes * 5))).toFixed(0)}%</span> de su capacidad proyectada. 
                Cada nueva conexión reduce la incertidumbre operativa en un <span className="font-black">2.4%</span>.
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
              {isOnline ? 'Analizar Red Neuronal' : 'Requiere Conexión'}
            </button>
            
            {aiInsight && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 bg-white dark:bg-zinc-950 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl shadow-sm"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-emerald-500" />
                  <h4 className="text-xs font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest">Insight de El Guardián</h4>
                </div>
                <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">{aiInsight.analysis}</p>
                {aiInsight.recommendations && aiInsight.recommendations.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {aiInsight.recommendations.map((rec: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-[10px] text-zinc-600 dark:text-zinc-400">
                        <ArrowRight className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
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
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">AI Hub Predictivo</h3>
            <ShieldAlert className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Cruza datos de la Red Neuronal con telemetría en tiempo real para predecir accidentes antes de que ocurran.
          </p>
          <button
            onClick={handlePredict}
            disabled={isPredicting || nodes.length === 0 || !isOnline}
            className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-rose-500/20"
          >
            {isPredicting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            {isOnline ? 'Predecir Riesgos Inminentes' : 'Requiere Conexión'}
          </button>

          {predictions.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {predictions.map((pred, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="p-4 bg-white dark:bg-zinc-950 border border-rose-200 dark:border-rose-500/30 rounded-2xl flex flex-col h-full shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-white line-clamp-1">{pred.title}</h4>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full shrink-0 ${
                      pred.probability > 70 ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-500' : 
                      pred.probability > 40 ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-500' : 
                      'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-500'
                    }`}>
                      {pred.probability}% Prob.
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-600 dark:text-zinc-400 mb-3 flex-grow">{pred.description}</p>
                  <div className="bg-rose-50 dark:bg-rose-500/10 p-3 rounded-xl border border-rose-100 dark:border-rose-500/20 mt-auto">
                    <p className="text-[9px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-1">Acción Preventiva Inmediata</p>
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
