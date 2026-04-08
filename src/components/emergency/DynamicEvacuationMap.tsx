import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Map as MapIcon, 
  Navigation, 
  AlertCircle, 
  Shield, 
  Zap, 
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Plus
} from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { NodeType } from '../../types';
import { calculateDynamicEvacuationRoute } from '../../services/geminiService';

import { VectorialEvacuationMap } from './VectorialEvacuationMap';

export function DynamicEvacuationMap() {
  const { nodes } = useUniversalKnowledge();
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeData, setRouteData] = useState<any>(null);
  const [userBlockedAreas, setUserBlockedAreas] = useState<string[]>([]);
  const [newBlockedArea, setNewBlockedArea] = useState('');

  const activeEmergencies = useMemo(() => {
    return nodes.filter(n => {
      if (n.type === NodeType.EMERGENCY && n.metadata?.status === 'active') return true;
      if (n.type === NodeType.INCIDENT) return true; // Include all incidents
      if (n.type === NodeType.RISK && n.metadata?.level === 'Crítico') return true; // Include critical risks
      return false;
    });
  }, [nodes]);

  const calculateRoute = async () => {
    setIsCalculating(true);
    
    try {
      const twinState = JSON.parse(localStorage.getItem('twinState') || '{}');
      const workers = twinState.workers ? Object.values(twinState.workers) : [];
      const machinery = twinState.machinery ? Object.values(twinState.machinery) : [];
      
      const data = await calculateDynamicEvacuationRoute(activeEmergencies, workers, machinery, userBlockedAreas);
      setRouteData(data);
    } catch (error) {
      console.error('Error calculating route:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  useEffect(() => {
    if (activeEmergencies.length > 0) {
      calculateRoute();
    } else {
      setRouteData(null);
    }
  }, [activeEmergencies.length, userBlockedAreas]);

  const handleAddBlockedArea = (e: React.FormEvent) => {
    e.preventDefault();
    if (newBlockedArea.trim() && !userBlockedAreas.includes(newBlockedArea.trim())) {
      setUserBlockedAreas(prev => [...prev, newBlockedArea.trim()]);
      setNewBlockedArea('');
    }
  };

  const handleRemoveBlockedArea = (area: string) => {
    setUserBlockedAreas(prev => prev.filter(a => a !== area));
  };

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-3xl p-5 sm:p-8 space-y-4 sm:space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20 shrink-0">
            <Navigation className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight leading-tight">Rutas Dinámicas</h3>
            <p className="text-[10px] sm:text-xs text-zinc-500 font-medium uppercase tracking-widest mt-0.5">Cálculo de Evacuación en Tiempo Real</p>
          </div>
        </div>
        {activeEmergencies.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-full animate-pulse self-start sm:self-auto">
            <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
            <span className="text-[9px] sm:text-[10px] font-black text-rose-500 uppercase tracking-widest">Emergencia Detectada</span>
          </div>
        )}
      </header>

      <div className="relative aspect-square sm:aspect-video bg-white dark:bg-black/40 rounded-xl sm:rounded-2xl border border-zinc-200 dark:border-white/5 overflow-hidden flex items-center justify-center">
        <VectorialEvacuationMap />

        <AnimatePresence mode="wait">
          {isCalculating ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 text-center bg-black/60 backdrop-blur-sm z-10"
            >
              <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-blue-500 animate-spin" />
              <p className="text-[10px] sm:text-xs font-black text-white uppercase tracking-widest animate-pulse">Recalculando Rutas Seguras...</p>
            </motion.div>
          ) : routeData ? (
            <motion.div
              key="route"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 w-full h-full p-4 sm:p-8 flex flex-col justify-center overflow-y-auto custom-scrollbar bg-black/80 backdrop-blur-md z-10"
            >
              <div className="max-w-md space-y-4 sm:space-y-6 mx-auto w-full">
                <div className="space-y-1 sm:space-y-2">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500">
                    <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                    <span className="text-xs sm:text-sm font-black uppercase tracking-widest">Ruta Óptima Encontrada</span>
                  </div>
                  <h4 className="text-lg sm:text-2xl font-black text-zinc-900 dark:text-white leading-tight uppercase tracking-tighter">
                    {routeData.safeRoute}
                  </h4>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-3 sm:p-4 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/5">
                    <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Tiempo Est.</p>
                    <p className="text-base sm:text-lg font-black text-zinc-900 dark:text-white">{routeData.estimatedTime}</p>
                  </div>
                  <div className="p-3 sm:p-4 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/5">
                    <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Prioridad</p>
                    <p className={`text-base sm:text-lg font-black uppercase ${
                      routeData.priority === 'Alta' ? 'text-rose-600 dark:text-rose-500' : 'text-emerald-600 dark:text-emerald-500'
                    }`}>{routeData.priority}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-[9px] sm:text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-2">
                      <XCircle className="w-3 h-3 shrink-0" /> Áreas Bloqueadas / Peligrosas
                    </p>
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      {routeData.blockedAreas.map((area: string, i: number) => (
                        <span key={i} className="px-2 py-1 bg-rose-500/10 border border-rose-500/20 rounded text-[9px] sm:text-[10px] font-bold text-rose-400 uppercase flex items-center gap-1">
                          {area}
                          {userBlockedAreas.includes(area) && (
                            <button onClick={() => handleRemoveBlockedArea(area)} className="hover:text-rose-300 ml-1">
                              <XCircle className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>

                  <form onSubmit={handleAddBlockedArea} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newBlockedArea}
                      onChange={(e) => setNewBlockedArea(e.target.value)}
                      placeholder="Reportar área bloqueada (ej. Pasillo 3)"
                      className="flex-1 bg-zinc-900/50 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                    />
                    <button
                      type="submit"
                      disabled={!newBlockedArea.trim() || isCalculating}
                      className="p-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="text-center space-y-3 sm:space-y-4 p-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-zinc-100 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto border border-zinc-200 dark:border-white/5">
                <MapIcon className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-400 dark:text-zinc-700" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-bold text-zinc-500">No hay emergencias activas.</p>
                <p className="text-[9px] sm:text-[10px] font-medium text-zinc-600 uppercase tracking-widest mt-1">El sistema de rutas dinámicas está en espera.</p>
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-3 sm:p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
        <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500 mt-0.5 sm:mt-1 shrink-0" />
        <div>
          <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white">Inteligencia de Evacuación</h4>
          <p className="text-[10px] sm:text-xs text-zinc-500 leading-relaxed mt-1">
            El sistema monitorea constantemente los nodos de emergencia en la Red Neuronal y recalcula las rutas de escape evitando zonas de peligro reportadas en tiempo real.
          </p>
        </div>
      </div>
    </section>
  );
}
