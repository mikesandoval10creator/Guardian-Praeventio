import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, AlertTriangle, Wind, ThermometerSun, Zap, ArrowRight, X } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { predictGlobalIncidents } from '../../services/geminiService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { cacheAIResponse, getCachedAIResponse } from '../../utils/pwa-offline';

export function PredictiveAlertWidget() {
  const { nodes } = useRiskEngine();
  const { environment } = useUniversalKnowledge();
  const [insights, setInsights] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    const fetchInsights = async () => {
      if (nodes.length === 0) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      try {
        if (!isOnline) {
          const cached = await getCachedAIResponse('predictive-alert');
          if (cached) {
            setInsights(cached);
          }
          setLoading(false);
          return;
        }

        const context = nodes.slice(0, 20).map(n => `${n.type}: ${n.title}`).join(', ');
        
        let envContext = '';
        if (environment?.weather) {
          envContext += `Clima: ${environment.weather.temp}°C, Viento: ${environment.weather.windSpeed} km/h, Condición: ${environment.weather.condition}. `;
        }
        if (environment?.seismic) {
          envContext += `Último Sismo: ${environment.seismic.magnitude} magnitud en ${environment.seismic.location}.`;
        }

        const data = await predictGlobalIncidents(context, envContext);
        setInsights(data);
        await cacheAIResponse('predictive-alert', data);
      } catch (error) {
        console.error('Error fetching AI insights:', error);
        // Try to load from cache on error
        const cached = await getCachedAIResponse('predictive-alert');
        if (cached) {
          setInsights(cached);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
  }, [nodes.length, environment, isOnline]);

  const topPrediction = insights?.predicciones?.[0];
  const isVisible = !loading && !dismissed && insights && topPrediction;

  const isCritical = insights?.nivelRiesgo === 'Crítico' || insights?.nivelRiesgo === 'Alto';
  
  const styles = isCritical ? {
    container: 'bg-gradient-to-r from-rose-500/20 via-rose-500/10 to-transparent border-rose-500/30',
    glow: 'bg-rose-500/10',
    iconBg: 'bg-rose-500/20 border-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.3)]',
    icon: 'text-rose-500',
    title: 'text-rose-500',
    badge: 'bg-rose-500/20 text-rose-400',
    box1: 'bg-rose-500/10 border-rose-500/20',
    box1Title: 'text-rose-400',
    box1Text: 'text-rose-100/80'
  } : {
    container: 'bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent border-amber-500/30',
    glow: 'bg-amber-500/10',
    iconBg: 'bg-amber-500/20 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.3)]',
    icon: 'text-amber-500',
    title: 'text-amber-500',
    badge: 'bg-amber-500/20 text-amber-400',
    box1: 'bg-amber-500/10 border-amber-500/20',
    box1Title: 'text-amber-400',
    box1Text: 'text-amber-100/80'
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="predictive-alert"
          initial={{ opacity: 0, y: -20, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -20, height: 0 }}
          className="mb-4 overflow-hidden"
        >
        <div className={`${styles.container} border rounded-2xl p-3 sm:p-4 relative overflow-hidden group`}>
          {/* Background effects */}
          <div className={`absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 ${styles.glow} rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none`} />
          
          <div className="flex items-start gap-2 sm:gap-4 relative z-10">
            <div className={`w-8 h-8 sm:w-12 sm:h-12 rounded-xl ${styles.iconBg} flex items-center justify-center shrink-0 border`}>
              <ShieldAlert className={`w-4 h-4 sm:w-6 sm:h-6 ${styles.icon} animate-pulse`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 sm:gap-4 mb-1">
                <h3 className={`text-[10px] sm:text-sm font-black ${styles.title} uppercase tracking-widest flex items-center gap-1 sm:gap-2`}>
                  $$ALERTA PREDICTIVA$$
                  <span className={`px-1.5 sm:px-2 py-0.5 rounded-full ${styles.badge} text-[7px] sm:text-[9px] tracking-widest`}>
                    {insights.nivelRiesgo}
                  </span>
                </h3>
                <button 
                  onClick={() => setDismissed(true)}
                  className="text-zinc-500 hover:text-white transition-colors p-0.5 sm:p-1"
                >
                  <X className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
              </div>
              
              <p className="text-[10px] sm:text-sm text-zinc-700 dark:text-zinc-300 font-medium leading-relaxed mb-1.5 sm:mb-3">
                <strong className="text-zinc-900 dark:text-white">{topPrediction.titulo}:</strong> {topPrediction.razon}
              </p>
              
              <div className="flex flex-col sm:flex-row gap-1.5 sm:gap-2">
                <div className={`flex-1 ${styles.box1} border rounded-lg p-2 sm:p-3`}>
                  <p className={`text-[8px] sm:text-[10px] font-bold ${styles.box1Title} uppercase tracking-widest mb-0.5 sm:mb-1 flex items-center gap-1`}>
                    <AlertTriangle className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> Riesgo Inminente
                  </p>
                  <p className={`text-[9px] sm:text-xs ${styles.box1Text}`}>Probabilidad: <strong className="text-zinc-900 dark:text-white">{topPrediction.probabilidad}%</strong></p>
                </div>
                
                <div className="flex-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 sm:p-3">
                  <p className="text-[8px] sm:text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-0.5 sm:mb-1 flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> Acción Automatizada
                  </p>
                  <p className="text-[9px] sm:text-xs text-emerald-800 dark:text-emerald-100/80 leading-snug">{topPrediction.mitigacionSugerida}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
