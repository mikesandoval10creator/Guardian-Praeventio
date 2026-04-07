import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, 
  AlertCircle, 
  Calendar, 
  CheckCircle2, 
  Brain, 
  Loader2,
  ChevronRight,
  ShieldCheck,
  WifiOff
} from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { forecastSafetyEvents } from '../../services/geminiService';
import { Card } from '../shared/Card';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { cacheAIResponse, getCachedAIResponse } from '../../utils/pwa-offline';

export function SafetyForecast() {
  const { nodes, environment } = useUniversalKnowledge();
  const [forecast, setForecast] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isOnline = useOnlineStatus();

  const runForecast = async () => {
    if (!isOnline) {
      setIsLoading(true);
      try {
        const cached = await getCachedAIResponse('safety-forecast');
        if (cached) {
          setForecast(cached);
        }
      } catch (e) {
        console.error('Error loading cached forecast', e);
      } finally {
        setIsLoading(false);
      }
      return;
    }
    
    setIsLoading(true);
    try {
      const nodesCtx = nodes.slice(0, 50).map(n => `${n.type}: ${n.title} (${n.description})`).join('\n');
      const envContext = environment ? `Clima actual: ${environment.weather.temp}°C, Viento: ${environment.weather.windSpeed}km/h. Sismos recientes: ${environment.earthquakes.length > 0 ? environment.earthquakes[0].Magnitud + ' en ' + environment.earthquakes[0].RefGeografica : 'Ninguno'}.` : 'Sin datos ambientales.';
      const result = await forecastSafetyEvents(nodesCtx, envContext);
      setForecast(result);
      await cacheAIResponse('safety-forecast', result);
    } catch (error) {
      console.error('Error running forecast:', error);
      const cached = await getCachedAIResponse('safety-forecast');
      if (cached) {
        setForecast(cached);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (nodes.length > 0 && !forecast) {
      runForecast();
    }
  }, [nodes, isOnline]);

  return (
    <Card className="p-8 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-white/10 overflow-hidden relative">
      <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
        <TrendingUp className="w-64 h-64 text-zinc-900 dark:text-white" />
      </div>

      <div className="relative z-10 space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
              <TrendingUp className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Pronóstico de Seguridad</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Análisis Predictivo a 7 Días</p>
            </div>
          </div>
          <button 
            onClick={runForecast}
            disabled={isLoading || !isOnline}
            className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50 ${
              !isOnline ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white'
            }`}
          >
            {!isOnline ? (
              <WifiOff className="w-4 h-4" />
            ) : isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Brain className="w-4 h-4" />
            )}
            {!isOnline ? 'Requiere Conexión' : 'Actualizar Pronóstico'}
          </button>
        </div>

        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest animate-pulse">Procesando Red Neuronal...</p>
          </div>
        ) : forecast ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Summary & Trends */}
            <div className="lg:col-span-2 space-y-8">
              <div className="p-6 bg-zinc-100 dark:bg-white/5 rounded-3xl border border-zinc-200 dark:border-white/5">
                <h3 className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-4">Resumen Ejecutivo</h3>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed font-medium">
                  {forecast.pronosticoSemanal}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    Tendencias Detectadas
                  </h3>
                  <div className="space-y-2">
                    {forecast.tendenciasDetectadas.map((trend: string, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-white/5">
                        <ChevronRight className="w-3 h-3 text-indigo-500 mt-0.5" />
                        <p className="text-[10px] text-zinc-600 dark:text-zinc-400 font-bold uppercase leading-tight">{trend}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    Recomendaciones Estratégicas
                  </h3>
                  <div className="space-y-2">
                    {forecast.recomendacionesEstrategicas.map((rec: string, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-emerald-500/5 rounded-2xl border border-emerald-500/10">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5" />
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-100/70 font-bold uppercase leading-tight">{rec}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Critical Days Timeline */}
            <div className="space-y-6">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Línea de Tiempo Crítica</h3>
              <div className="space-y-4">
                {forecast.diasCriticos.map((day: any, i: number) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="relative pl-8 pb-4 border-l border-white/5 last:border-0"
                  >
                    <div className={`absolute left-0 top-0 -translate-x-1/2 w-4 h-4 rounded-full border-4 border-zinc-50 dark:border-zinc-900 ${
                      day.nivelRiesgo === 'Crítico' ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' :
                      day.nivelRiesgo === 'Alto' ? 'bg-orange-500' :
                      day.nivelRiesgo === 'Medio' ? 'bg-blue-500' :
                      'bg-emerald-500'
                    }`} />
                    <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10 transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black text-zinc-900 dark:text-white uppercase">{day.dia}</span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${
                          day.nivelRiesgo === 'Crítico' ? 'bg-red-500/20 text-red-500' :
                          day.nivelRiesgo === 'Alto' ? 'bg-orange-500/20 text-orange-500' :
                          'bg-blue-500/20 text-blue-500'
                        }`}>{day.nivelRiesgo}</span>
                      </div>
                      <p className="text-[9px] text-zinc-500 font-bold leading-tight">{day.razon}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-zinc-500 text-sm font-medium">No hay datos suficientes para generar un pronóstico.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
