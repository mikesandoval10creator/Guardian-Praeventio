import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldAlert, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Brain, 
  Activity,
  Calendar,
  ArrowRight,
  Info,
  WifiOff,
  CloudLightning,
  Wind,
  Droplets,
  Sun,
  Thermometer,
  Eye,
  RefreshCw,
  MapPin,
  Clock,
  HeartPulse,
  Users
} from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { generatePredictiveForecast } from '../services/geminiService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function PredictiveGuard() {
  const { selectedProject } = useProject();
  const { nodes } = useRiskEngine();
  const { environment } = useUniversalKnowledge();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [forecast, setForecast] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isOnline = useOnlineStatus();

  const generateForecast = async () => {
    if (!selectedProject) return;
    setIsAnalyzing(true);

    try {
      const projectNodes = nodes.filter(n => n.projectId === selectedProject.id);
      const context = projectNodes.map(n => `- [${n.type}] ${n.title}: ${n.description}`).join('\n');
      
      const weatherContext = environment?.weather ? 
        `Temperatura: ${environment.weather.temp}°C, Viento: ${environment.weather.windSpeed || 0}km/h, Humedad: ${environment.weather.humidity}%, Condición: ${environment.weather.condition}` : 
        'Sin datos climáticos.';

      const data = await generatePredictiveForecast(selectedProject.name, context, weatherContext);
      setForecast(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error generating forecast:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (selectedProject && !forecast) {
      generateForecast();
    }
  }, [selectedProject]);

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'Crítico': return 'text-rose-500 bg-rose-500/10 border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.3)]';
      case 'Alto': return 'text-orange-500 bg-orange-500/10 border-orange-500/20 shadow-[0_0_15px_rgba(249,115,22,0.3)]';
      case 'Medio': return 'text-amber-500 bg-amber-500/10 border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.3)]';
      default: return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
    }
  };

  const getRiskStrokeColor = (score: number) => {
    if (score >= 75) return 'text-rose-500';
    if (score >= 50) return 'text-orange-500';
    if (score >= 25) return 'text-amber-500';
    return 'text-emerald-500';
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-black uppercase tracking-widest mb-2">
            <Activity className="w-3 h-3" />
            <span>Motor Predictivo Activo</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-white uppercase tracking-tighter flex items-center gap-4">
            <ShieldAlert className="w-10 h-10 sm:w-12 sm:h-12 text-indigo-500" />
            Guardián Predictivo
          </h1>
          <p className="text-zinc-400 text-sm sm:text-base font-medium max-w-2xl">
            Centro de control avanzado. Fusiona telemetría ambiental en tiempo real con análisis de riesgos mediante IA para anticipar incidentes antes de que ocurran.
          </p>
        </div>
        
        <div className="flex items-center gap-4">
          {lastUpdated && (
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Última Actualización</p>
              <p className="text-sm font-medium text-zinc-300 flex items-center justify-end gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {lastUpdated.toLocaleTimeString()}
              </p>
            </div>
          )}
          <Button 
            onClick={generateForecast} 
            disabled={isAnalyzing || !isOnline}
            className={`bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-widest px-6 py-4 rounded-2xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] ${!isOnline ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {!isOnline ? (
              <WifiOff className="w-4 h-4" />
            ) : (
              <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            )}
            {!isOnline ? 'Sin Conexión' : isAnalyzing ? 'Procesando...' : 'Actualizar Modelo'}
          </Button>
        </div>
      </div>

      {!selectedProject ? (
        <Card className="p-16 flex flex-col items-center justify-center text-center bg-zinc-900/50 border-dashed border-white/10 rounded-[3rem]">
          <div className="w-24 h-24 rounded-full bg-zinc-800/50 flex items-center justify-center mb-6 shadow-inner">
            <MapPin className="w-10 h-10 text-zinc-500" />
          </div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-3">Selecciona un Proyecto</h2>
          <p className="text-zinc-400 text-base max-w-md">
            El motor predictivo requiere un contexto operativo. Selecciona un proyecto activo en el menú lateral para inicializar el análisis.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          
          {/* Left Column: Environment & Score */}
          <div className="lg:col-span-4 space-y-6 lg:space-y-8">
            
            {/* Weather / Telemetry Widget */}
            <Card className="p-6 bg-gradient-to-br from-zinc-900 to-zinc-950 border-white/5 rounded-[2rem] relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity duration-500">
                <CloudLightning className="w-32 h-32 text-white" />
              </div>
              
              <div className="flex items-center gap-3 mb-6 relative z-10">
                <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">Telemetría Ambiental</h3>
                  <p className="text-[10px] text-zinc-400 font-medium tracking-wide">DATOS EN TIEMPO REAL</p>
                </div>
              </div>

              {environment?.weather ? (
                <div className="space-y-6 relative z-10">
                  <div className="flex items-end gap-4">
                    <span className="text-6xl font-black text-white tracking-tighter leading-none">
                      {Math.round(environment.weather.temp)}°
                    </span>
                    <div className="pb-1.5">
                      <span className="text-sm font-bold text-blue-400 uppercase tracking-widest block">{environment.weather.condition}</span>
                      <span className="text-xs text-zinc-500 font-medium flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {environment.weather.location}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                      <Wind className="w-5 h-5 text-zinc-400" />
                      <div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Viento</p>
                        <p className="text-sm font-black text-white">{environment.weather.windSpeed || 0} <span className="text-[10px] text-zinc-400">km/h</span></p>
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                      <Droplets className="w-5 h-5 text-blue-400" />
                      <div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Humedad</p>
                        <p className="text-sm font-black text-white">{environment.weather.humidity}<span className="text-[10px] text-zinc-400">%</span></p>
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                      <Sun className="w-5 h-5 text-amber-400" />
                      <div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Índice UV</p>
                        <p className="text-sm font-black text-white">{environment.weather.uv}</p>
                      </div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
                      <Thermometer className="w-5 h-5 text-rose-400" />
                      <div>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Calidad Aire</p>
                        <p className="text-sm font-black text-white">{environment.weather.airQuality}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <WifiOff className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                  <p className="text-sm font-medium text-zinc-500">Conectando con sensores meteorológicos...</p>
                </div>
              )}
            </Card>

            {/* Main Risk Score Widget */}
            <Card className="p-8 bg-zinc-900 border-none rounded-[2rem] relative overflow-hidden flex flex-col items-center justify-center text-center min-h-[320px]">
              {isAnalyzing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/80 backdrop-blur-sm z-20">
                  <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4" />
                  <p className="text-sm font-bold text-indigo-400 uppercase tracking-widest animate-pulse">Procesando Modelos...</p>
                </div>
              ) : forecast ? (
                <>
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                  
                  <div className={`mb-8 px-5 py-2 rounded-full border text-xs font-black uppercase tracking-widest ${getRiskColor(forecast.riskLevel)}`}>
                    Nivel de Riesgo: {forecast.riskLevel}
                  </div>
                  
                  <div className="relative">
                    {/* Outer glow ring */}
                    <div className={`absolute inset-0 rounded-full blur-2xl opacity-20 ${getRiskStrokeColor(forecast.score).replace('text-', 'bg-')}`} />
                    
                    <svg className="w-56 h-56 transform -rotate-90 relative z-10 drop-shadow-2xl">
                      {/* Background Track */}
                      <circle
                        cx="112"
                        cy="112"
                        r="96"
                        stroke="currentColor"
                        strokeWidth="16"
                        fill="transparent"
                        className="text-zinc-800/50"
                      />
                      {/* Progress Track */}
                      <motion.circle
                        initial={{ strokeDashoffset: 603.18 }}
                        animate={{ strokeDashoffset: 603.18 - (603.18 * forecast.score) / 100 }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        cx="112"
                        cy="112"
                        r="96"
                        stroke="currentColor"
                        strokeWidth="16"
                        fill="transparent"
                        strokeDasharray={603.18}
                        strokeLinecap="round"
                        className={getRiskStrokeColor(forecast.score)}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
                      <motion.span 
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5, type: "spring" }}
                        className="text-6xl font-black text-white tracking-tighter"
                      >
                        {forecast.score}<span className="text-2xl text-zinc-500">%</span>
                      </motion.span>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Probabilidad Global</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-zinc-500">Esperando inicialización...</div>
              )}
            </Card>

          </div>

          {/* Right Column: AI Insights & Threats */}
          <div className="lg:col-span-8 space-y-6 lg:space-y-8">
            
            {/* AI Insight Panel */}
            <Card className="p-6 sm:p-8 bg-zinc-900 border-none rounded-[2rem] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
              
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400">
                  <Brain className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white uppercase tracking-tighter">Síntesis de Inteligencia</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Análisis Contextual</p>
                </div>
              </div>

              {isAnalyzing ? (
                <div className="space-y-3">
                  <div className="h-4 bg-zinc-800 rounded-full w-full animate-pulse" />
                  <div className="h-4 bg-zinc-800 rounded-full w-5/6 animate-pulse" />
                  <div className="h-4 bg-zinc-800 rounded-full w-4/6 animate-pulse" />
                </div>
              ) : forecast ? (
                <div className="space-y-8">
                  <p className="text-zinc-300 text-lg sm:text-xl font-medium leading-relaxed">
                    {forecast.aiInsight}
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {forecast.recommendations.map((rec: string, i: number) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        key={i} 
                        className="flex items-start gap-3 p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
                      >
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                        <span className="text-sm text-zinc-300 font-medium leading-relaxed">{rec}</span>
                      </motion.div>
                    ))}
                  </div>

                  {forecast.empatheticActions && forecast.empatheticActions.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.4 }}
                      className="p-6 rounded-3xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-10">
                        <HeartPulse className="w-24 h-24 text-indigo-400" />
                      </div>
                      <div className="flex items-center gap-3 mb-5 relative z-10">
                        <div className="p-2 rounded-lg bg-indigo-500/20">
                          <Eye className="w-5 h-5 text-indigo-400" />
                        </div>
                        <h4 className="text-sm font-black text-indigo-300 uppercase tracking-widest">Cuidado Activo (Prevención Empática)</h4>
                      </div>
                      <div className="space-y-4 relative z-10">
                        {forecast.empatheticActions.map((action: string, i: number) => (
                          <div key={i} className="flex items-start gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 shrink-0 shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
                            <p className="text-sm text-indigo-100/80 font-medium leading-relaxed">{action}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>
              ) : (
                <div className="text-zinc-500 text-sm">Esperando datos...</div>
              )}
            </Card>

            {/* Radar de Contacto Humano (System 3) */}
            <Card className="p-6 sm:p-8 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-[2rem] relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-10">
                <Users className="w-32 h-32 text-amber-500" />
              </div>
              <div className="flex items-center gap-3 mb-6 relative z-10">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-500">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-amber-500 uppercase tracking-tighter">Radar de Contacto Humano</h3>
                  <p className="text-[10px] font-bold text-amber-600/80 uppercase tracking-widest">Prevención Basada en Vínculos</p>
                </div>
              </div>
              
              <div className="relative z-10 space-y-4">
                <div className="p-4 rounded-2xl bg-black/40 border border-amber-500/20">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-full bg-amber-500/20 shrink-0">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white mb-1">El Equipo 4 ha tenido desviaciones hoy</h4>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        La métrica de bienestar general indica un nivel de alerta leve y se reportó un casi-accidente reciente en su zona.
                      </p>
                      <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span className="text-xs font-medium text-amber-400">Acción: Es un buen momento para una charla de seguridad en persona.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Haki de Observación Consultivo (System 4) */}
            <AnimatePresence>
              {environment?.weather && environment.weather.windSpeed > 50 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <Card className="p-6 sm:p-8 bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border border-indigo-500/30 rounded-[2rem] relative overflow-hidden shadow-[0_0_30px_rgba(99,102,241,0.2)]">
                    <div className="absolute top-0 right-0 p-6 opacity-20">
                      <Wind className="w-32 h-32 text-indigo-400 animate-pulse" />
                    </div>
                    <div className="flex items-center gap-3 mb-6 relative z-10">
                      <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400">
                        <Brain className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-indigo-400 uppercase tracking-tighter">Haki de Observación Consultivo</h3>
                        <p className="text-[10px] font-bold text-indigo-500/80 uppercase tracking-widest">Asistente de Decisión</p>
                      </div>
                    </div>
                    
                    <div className="relative z-10 space-y-4">
                      <div className="p-5 rounded-2xl bg-black/60 border border-indigo-500/30 backdrop-blur-md">
                        <div className="flex items-start gap-4">
                          <div className="p-3 rounded-full bg-indigo-500/20 shrink-0">
                            <CloudLightning className="w-6 h-6 text-indigo-400" />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-base font-bold text-white mb-2">Condiciones adversas detectadas</h4>
                            <p className="text-sm text-zinc-300 leading-relaxed mb-4">
                              El Guardián detecta vientos de {environment.weather.windSpeed} km/h en la zona. ¿Deseas enviar una alerta para suspender trabajos en altura?
                            </p>
                            <div className="flex gap-3">
                              <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-colors">
                                Sí, Enviar Alerta
                              </button>
                              <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold uppercase tracking-widest rounded-xl transition-colors border border-zinc-700">
                                Ignorar
                              </button>
                            </div>
                            <p className="text-[9px] text-zinc-500 mt-3 italic">
                              * La IA nunca ejecuta acciones por sí sola. La responsabilidad permanece en la tripulación.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Top Threats Grid */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-lg font-black text-white uppercase tracking-tighter flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-500" />
                  Vectores de Amenaza Principales
                </h2>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Próximas 48h</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isAnalyzing ? (
                  [1, 2].map(i => (
                    <div key={i} className="h-48 bg-zinc-900/50 rounded-[2rem] animate-pulse border border-white/5" />
                  ))
                ) : forecast?.topRisks ? (
                  forecast.topRisks.map((risk: any, i: number) => (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 + (i * 0.1) }}
                      key={i}
                    >
                      <Card className="p-6 bg-zinc-900 border-none hover:bg-zinc-800 transition-all duration-300 group rounded-[2rem] h-full flex flex-col">
                        <div className="flex justify-between items-start mb-4">
                          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500 group-hover:scale-110 transition-transform duration-300">
                            <AlertTriangle className="w-6 h-6" />
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-2xl font-black text-white tracking-tighter">{risk.probability}%</span>
                            <span className="text-[8px] font-bold text-rose-500 uppercase tracking-widest">Probabilidad</span>
                          </div>
                        </div>
                        
                        <h4 className="text-lg font-black text-white uppercase tracking-tight mb-3 line-clamp-2">{risk.title}</h4>
                        
                        <div className="space-y-4 mt-auto">
                          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest block mb-1">Impacto Potencial</span>
                            <p className="text-xs text-zinc-300 font-medium line-clamp-2">{risk.impact}</p>
                          </div>
                          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                            <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest block mb-1 flex items-center gap-1">
                              <ShieldAlert className="w-3 h-3" /> Mitigación Sugerida
                            </span>
                            <p className="text-xs text-emerald-400 font-bold line-clamp-2">{risk.mitigation}</p>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))
                ) : (
                  <div className="col-span-2 text-center py-12 text-zinc-500 text-sm border border-dashed border-white/10 rounded-[2rem]">
                    No hay amenazas detectadas.
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
