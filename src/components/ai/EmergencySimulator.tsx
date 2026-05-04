import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertCircle, Shield, Loader2, Play, X, Info, Sparkles, MapPin, Users, Phone, WifiOff, Siren, Flame, ChevronDown, ChevronUp } from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useProject } from '../../contexts/ProjectContext';
import { generateEmergencyScenario } from '../../services/geminiService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useEmergency } from '../../contexts/EmergencyContext';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { logger } from '../../utils/logger';
import { simulateFireSpread, type FireSpreadResult } from '../../services/euler/odeIntegrator';

interface Scenario {
  title: string;
  type: 'Incendio' | 'Derrame' | 'Sismo' | 'Accidente' | 'Explosión';
  description: string;
  location: string;
  coordinates: { x: number; y: number };
  criticality: 'Alta' | 'Crítica';
  responseSteps: string[];
  requiredEPP: string[];
  emergencyContacts: string[];
}

export function EmergencySimulator() {
  const { nodes } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const { addNode } = useRiskEngine();
  const { triggerEmergency } = useEmergency();
  const [isGenerating, setIsGenerating] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const isOnline = useOnlineStatus();

  // ─── ODE Fire-spread simulation (Euler-Matrix Fase 6) ─────────────────
  // Local, SLM-friendly: pure pure-function math from
  // services/euler/odeIntegrator. No network needed — works offline.
  const [propagationOpen, setPropagationOpen] = useState(false);
  const [initialArea, setInitialArea] = useState(20);
  const [spreadRate, setSpreadRate] = useState(8);
  const [suppressionRate, setSuppressionRate] = useState(15);
  const [suppressionStartT, setSuppressionStartT] = useState(5);
  const [tMax, setTMax] = useState(30);
  const [propagationResult, setPropagationResult] = useState<FireSpreadResult | null>(null);

  const runPropagationSim = () => {
    try {
      const result = simulateFireSpread(
        { initialArea, spreadRate, suppressionRate, suppressionStartT },
        0.25,
        tMax,
      );
      setPropagationResult(result);
    } catch (error) {
      logger.error('Error running fire spread simulation:', error);
    }
  };

  // Sparkline path memoised so re-renders during slider drags are cheap.
  const sparkline = useMemo(() => {
    if (!propagationResult || propagationResult.timeline.length < 2) return null;
    const W = 280;
    const H = 80;
    const padX = 4;
    const padY = 4;
    const tline = propagationResult.timeline;
    const tMin = tline[0].t;
    const tMaxLocal = tline[tline.length - 1].t;
    const aMax = Math.max(propagationResult.peakArea, 1);
    const points = tline.map((p) => {
      const x = padX + ((p.t - tMin) / (tMaxLocal - tMin || 1)) * (W - 2 * padX);
      const y = H - padY - (p.area / aMax) * (H - 2 * padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { path: `M${points.join(' L')}`, width: W, height: H };
  }, [propagationResult]);

  const generateScenario = async () => {
    if (!isOnline) return;
    setIsGenerating(true);
    setScenario(null);
    setActiveStep(0);
    try {
      // Get context from Zettelkasten
      const context = nodes
        .filter(n => n.type === 'Riesgo' || n.type === 'Activo')
        .slice(0, 15)
        .map(n => `- ${n.type}: ${n.title} (${n.description})`)
        .join('\n');

      const data = await generateEmergencyScenario(context);
      setScenario(data);
    } catch (error) {
      logger.error('Error generating scenario:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTriggerRealEmergency = async () => {
    if (!scenario || !selectedProject) return;
    
    // Trigger the global emergency state
    triggerEmergency(String(scenario.type || '').toLowerCase());

    // Add to Zettelkasten as a real incident
    await addNode({
      type: NodeType.INCIDENT,
      title: `[SIMULACRO ESCALADO] ${scenario.title}`,
      description: scenario.description,
      tags: ['simulacro', 'emergencia', String(scenario.type || '').toLowerCase()],
      projectId: selectedProject.id,
      connections: [],
      metadata: {
        location: scenario.location,
        criticality: scenario.criticality,
        isDrill: true
      }
    });
    
    setScenario(null);
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-[40px] p-8 overflow-hidden relative">
      <div className="absolute top-0 right-0 p-8">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-500">
          <Zap className="w-6 h-6" />
        </div>
      </div>

      <div className="max-w-2xl">
        <h2 className="text-3xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter mb-2">Simulador de Emergencias IA</h2>
        <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest mb-8">Entrenamiento Dinámico Basado en Riesgos Reales</p>
        
        {!scenario ? (
          <div className="space-y-6">
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              El Guardián utiliza los riesgos identificados en la Red Neuronal para generar escenarios de emergencia impredecibles. 
              Pon a prueba la capacidad de respuesta de tu equipo con simulacros generados por IA.
            </p>
            <button
              onClick={generateScenario}
              disabled={isGenerating || !isOnline}
              className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl flex items-center gap-3 disabled:opacity-50 ${
                !isOnline ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-amber-500/20'
              }`}
            >
              {!isOnline ? (
                <WifiOff className="w-5 h-5" />
              ) : isGenerating ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Play className="w-5 h-5" />
              )}
              <span>{!isOnline ? 'Requiere Conexión' : 'Generar Simulacro Dinámico'}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-6 rounded-3xl bg-rose-500/10 border border-rose-500/20"
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="px-3 py-1 rounded-full bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest">
                  {scenario.type}
                </span>
                <span className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-rose-600 dark:text-rose-500 text-[10px] font-black uppercase tracking-widest border border-rose-500/20">
                  Prioridad: {scenario.criticality}
                </span>
              </div>
              <h3 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight mb-2">{scenario.title}</h3>
              <p className="text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed">{scenario.description}</p>
              
              <div className="mt-6 flex items-center gap-6">
                <div className="flex items-center gap-2 text-zinc-400">
                  <MapPin className="w-4 h-4 text-rose-500" />
                  <span className="text-xs font-bold uppercase tracking-wider">{scenario.location}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-bold uppercase tracking-wider">Evacuación Requerida</span>
                </div>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Pasos de Respuesta
                </h4>
                <div className="space-y-3">
                  {scenario.responseSteps.map((step, i) => (
                    <div 
                      key={i}
                      className={`p-4 rounded-2xl border transition-all ${
                        activeStep === i ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-100 dark:bg-zinc-800/30 border-zinc-200 dark:border-white/5 opacity-50'
                      }`}
                      onClick={() => setActiveStep(i)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${
                          activeStep === i ? 'bg-emerald-500 text-white' : 'bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                        }`}>
                          {i + 1}
                        </div>
                        <p className="text-xs font-bold text-zinc-900 dark:text-white">{step}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5 rounded-3xl p-6">
                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    EPP Crítico
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {scenario.requiredEPP.map((epp, i) => (
                      <span key={i} className="bg-blue-500/10 text-blue-400 text-[10px] font-bold px-3 py-1.5 rounded-xl border border-blue-500/20">
                        {epp}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5 rounded-3xl p-6">
                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Contactos de Emergencia
                  </h4>
                  <div className="space-y-2">
                    {scenario.emergencyContacts.map((contact, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400 font-medium">{contact}</span>
                        <span className="text-emerald-500 font-black uppercase tracking-widest">Activo</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={handleTriggerRealEmergency}
                    className="flex-1 py-4 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-rose-500/20 flex items-center justify-center gap-2"
                  >
                    <Siren className="w-4 h-4" />
                    Escalar a Emergencia Real
                  </button>
                  <button
                    onClick={() => setScenario(null)}
                    className="flex-1 py-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-black text-[10px] uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all border border-zinc-200 dark:border-white/10"
                  >
                    Finalizar Simulacro
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Simulación de propagación (Euler-ODE) ─── */}
      {/* Local-first / offline: corre totalmente en cliente sin red. */}
      <div className="mt-8 pt-8 border-t border-zinc-200 dark:border-white/10 max-w-2xl">
        <button
          onClick={() => setPropagationOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 group"
          aria-expanded={propagationOpen}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-500">
              <Flame className="w-5 h-5" />
            </div>
            <div className="text-left">
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight">
                Simulación de Propagación
              </h3>
              <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-widest">
                Modelo local · Método de Euler · Sin nube
              </p>
            </div>
          </div>
          <div className="text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">
            {propagationOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </button>

        <AnimatePresence>
          {propagationOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-6 space-y-6">
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Estima cuánto tarda en contenerse un foco de incendio según la velocidad
                  de propagación y la capacidad de supresión. Cómputo local — útil para
                  comparar estrategias offline.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Área inicial (m²)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={initialArea}
                      onChange={(e) => setInitialArea(Math.max(0, Number(e.target.value) || 0))}
                      className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900/80 border border-zinc-300 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Tasa de propagación (m²/min)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={spreadRate}
                      onChange={(e) => setSpreadRate(Math.max(0, Number(e.target.value) || 0))}
                      className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900/80 border border-zinc-300 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Tasa de supresión (m²/min)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={suppressionRate}
                      onChange={(e) => setSuppressionRate(Math.max(0, Number(e.target.value) || 0))}
                      className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900/80 border border-zinc-300 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Inicio de intervención (min)
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={suppressionStartT}
                      onChange={(e) => setSuppressionStartT(Math.max(0, Number(e.target.value) || 0))}
                      className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900/80 border border-zinc-300 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Tiempo total de simulación (min)
                    </span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={tMax}
                      onChange={(e) => setTMax(Math.max(1, Number(e.target.value) || 1))}
                      className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900/80 border border-zinc-300 dark:border-white/10 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]"
                    />
                  </label>
                </div>

                <button
                  onClick={runPropagationSim}
                  className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-[#4db6ac] hover:bg-[#3a9e95] text-white font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-[#4db6ac]/20 flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  Ejecutar simulación
                </button>

                {propagationResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4 p-5 rounded-3xl bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5"
                  >
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                          Pico de área
                        </div>
                        <div className="text-lg font-black text-zinc-900 dark:text-white">
                          {propagationResult.peakArea.toFixed(1)} m²
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                          Tiempo de contención
                        </div>
                        <div
                          className={`text-lg font-black ${
                            propagationResult.timeToContain !== null
                              ? 'text-emerald-600 dark:text-emerald-500'
                              : 'text-rose-600 dark:text-rose-500'
                          }`}
                        >
                          {propagationResult.timeToContain !== null
                            ? `${propagationResult.timeToContain.toFixed(1)} min`
                            : 'No contenido'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                          Pasos
                        </div>
                        <div className="text-lg font-black text-zinc-900 dark:text-white">
                          {propagationResult.timeline.length}
                        </div>
                      </div>
                    </div>

                    {sparkline && (
                      <div className="rounded-2xl bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-white/5 p-3">
                        <svg
                          viewBox={`0 0 ${sparkline.width} ${sparkline.height}`}
                          className="w-full h-20"
                          aria-label="Línea de tiempo del área en combustión"
                          role="img"
                        >
                          <path
                            d={sparkline.path}
                            fill="none"
                            stroke="#f97316"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <div className="flex justify-between mt-1 text-[9px] text-zinc-500 uppercase tracking-widest font-bold">
                          <span>0 min</span>
                          <span>{tMax} min</span>
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      Modelo lineal Euler-ODE — útil para comparar estrategias.
                      Para predicción operacional usar Rothermel/FARSITE.
                    </p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
