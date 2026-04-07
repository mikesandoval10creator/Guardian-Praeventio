import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertCircle, Shield, Loader2, Play, X, Info, Sparkles, MapPin, Users, Phone, WifiOff, Siren } from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useProject } from '../../contexts/ProjectContext';
import { generateEmergencyScenario } from '../../services/geminiService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useEmergency } from '../../contexts/EmergencyContext';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';

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
      console.error('Error generating scenario:', error);
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
    </div>
  );
}
