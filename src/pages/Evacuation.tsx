import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Map as MapIcon, 
  Navigation, 
  Shield, 
  AlertCircle, 
  Users, 
  ChevronRight, 
  MapPin,
  Maximize2,
  Clock,
  Plus,
  Minus,
  Zap,
  Loader2,
  CheckCircle2,
  FileText,
  X,
  Brain
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { calculateDynamicEvacuation, generateEmergencyPlan } from '../services/geminiService';
import { NodeType } from '../types';

export function Evacuation() {
  const { selectedProject } = useProject();
  const { nodes, loading: nodesLoading } = useUniversalKnowledge();
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [emergencyPlan, setEmergencyPlan] = useState<string | null>(null);
  const [aiRoute, setAiRoute] = useState<any>(null);
  const [simulatedIncident, setSimulatedIncident] = useState<string | null>(null);

  const emergencyNodes = nodes.filter(n => n.type === NodeType.EMERGENCY || n.type === NodeType.ASSET);
  const incidentNodes = nodes.filter(n => n.type === NodeType.INCIDENT);

  const runDynamicCalculation = async () => {
    setCalculating(true);
    try {
      const context = nodes
        .filter(n => [NodeType.EMERGENCY, NodeType.ASSET, NodeType.HYGIENE, NodeType.RISK].includes(n.type))
        .map(n => `- [${n.type}] ${n.title}: ${n.description} (Tags: ${n.tags.join(', ')})`)
        .join('\n');
      
      const data = await calculateDynamicEvacuation(context, simulatedIncident || (incidentNodes[0]?.title));
      setAiRoute(data);
    } catch (error) {
      console.error('Error calculating dynamic route:', error);
    } finally {
      setCalculating(false);
    }
  };

  const handleGenerateEmergencyPlan = async () => {
    setGeneratingPlan(true);
    try {
      const context = nodes.map(n => `- [${n.type}] ${n.title}: ${n.description}`).join('\n');
      const plan = await generateEmergencyPlan(selectedProject?.name || 'Proyecto Actual', context);
      setEmergencyPlan(plan);
    } catch (error) {
      console.error('Error generating emergency plan:', error);
    } finally {
      setGeneratingPlan(false);
    }
  };

  useEffect(() => {
    if (nodes.length > 0 && !aiRoute) {
      runDynamicCalculation();
    }
  }, [nodes]);

  const routes = [
    { id: 'R1', name: 'Ruta Principal Norte', status: aiRoute?.rutasBloqueadas?.includes('R1') ? 'blocked' : 'clear', capacity: '120 personas', time: '2.5 min' },
    { id: 'R2', name: 'Ruta Secundaria Sur', status: aiRoute?.rutasBloqueadas?.includes('R2') ? 'blocked' : 'clear', capacity: '80 personas', time: '3.1 min' },
    { id: 'R3', name: 'Ruta de Emergencia Este', status: aiRoute?.rutasBloqueadas?.includes('R3') ? 'blocked' : 'clear', capacity: '50 personas', time: 'N/A' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <MapIcon className="w-8 h-8 text-emerald-500" />
            Mapa de Evacuación Dinámico
          </h1>
          <p className="text-zinc-400 mt-1 font-medium">
            {selectedProject 
              ? `Plan de evacuación inteligente para: ${selectedProject.name}`
              : 'Gestión de rutas adaptativas basadas en el Grafo de Conocimiento'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleGenerateEmergencyPlan}
            disabled={generatingPlan}
            className="flex items-center gap-2 bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            {generatingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            <span>Generar Plan de Emergencia (PE)</span>
          </button>
          <button 
            onClick={() => setSimulatedIncident(simulatedIncident ? null : "Incendio en Almacén Central")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all border ${
              simulatedIncident 
                ? 'bg-rose-500/10 border-rose-500 text-rose-500' 
                : 'bg-zinc-900/50 border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            <AlertCircle className="w-4 h-4" />
            <span>{simulatedIncident ? 'Incidente Activo' : 'Simular Incidente'}</span>
          </button>
          <button 
            onClick={runDynamicCalculation}
            disabled={calculating}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
          >
            {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span>Recalcular Ruta</span>
          </button>
        </div>
      </div>

      {/* Emergency Plan Modal */}
      <AnimatePresence>
        {emergencyPlan && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-rose-500/10 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-rose-500/20 flex items-center justify-center text-rose-400">
                    <Shield className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">Plan de Emergencia (PE)</h2>
                    <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest">Generado por El Guardián AI</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEmergencyPlan(null)}
                  className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                <div className="prose prose-invert max-w-none">
                  <div className="whitespace-pre-wrap font-sans text-zinc-300 leading-relaxed text-lg">
                    {emergencyPlan}
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-white/5 bg-zinc-900/50 flex justify-end">
                <button 
                  onClick={() => setEmergencyPlan(null)}
                  className="px-8 py-4 rounded-2xl bg-rose-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-rose-400 transition-all flex items-center gap-2 shadow-lg shadow-rose-500/20"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Finalizar Revisión
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Map View Placeholder */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-[40px] overflow-hidden relative min-h-[600px] group shadow-2xl">
            <div className="absolute inset-0 bg-[url('https://picsum.photos/seed/blueprint/1200/800')] bg-cover bg-center opacity-30 group-hover:scale-105 transition-transform duration-1000" />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
            
            {/* Map Controls */}
            <div className="absolute top-6 right-6 flex flex-col gap-2 z-20">
              <button className="w-12 h-12 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl flex items-center justify-center text-white hover:bg-zinc-800 transition-all shadow-xl">
                <Plus className="w-6 h-6" />
              </button>
              <button className="w-12 h-12 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl flex items-center justify-center text-white hover:bg-zinc-800 transition-all shadow-xl">
                <Minus className="w-6 h-6" />
              </button>
            </div>

            {/* Emergency Nodes Overlay */}
            <div className="absolute inset-0 p-12 pointer-events-none">
              {emergencyNodes.slice(0, 5).map((node, i) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1 }}
                  style={{ 
                    position: 'absolute', 
                    top: `${20 + (i * 15)}%`, 
                    left: `${30 + (i * 10)}%` 
                  }}
                  className="pointer-events-auto group/node"
                >
                  <div className="relative">
                    <div className="w-4 h-4 rounded-full bg-emerald-500 animate-ping absolute inset-0 opacity-50" />
                    <div className="w-4 h-4 rounded-full bg-emerald-500 relative border-2 border-white shadow-lg shadow-emerald-500/50 cursor-pointer" />
                    
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/node:opacity-100 transition-opacity whitespace-nowrap">
                      <div className="bg-zinc-900/90 backdrop-blur-md border border-white/10 p-3 rounded-xl shadow-2xl">
                        <p className="text-[10px] font-black text-white uppercase tracking-widest">{node.title}</p>
                        <p className="text-[8px] text-zinc-400 uppercase tracking-widest mt-0.5">{node.type}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}

              {simulatedIncident && (
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{ top: '45%', left: '55%' }}
                  className="absolute pointer-events-auto"
                >
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full bg-rose-500 animate-ping absolute -inset-4 opacity-30" />
                    <div className="w-8 h-8 rounded-full bg-rose-500 flex items-center justify-center text-white border-2 border-white shadow-xl shadow-rose-500/50">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2">
                      <div className="bg-rose-500 text-white px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap shadow-xl">
                        {simulatedIncident}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Map Overlay Info */}
            <div className="absolute bottom-8 left-8 right-8 flex items-end justify-between z-20">
              <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 p-6 rounded-[32px] max-w-sm shadow-2xl">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Punto de Encuentro Óptimo</span>
                    <h4 className="text-white font-black uppercase tracking-tight">
                      {aiRoute?.puntoEncuentroNombre || 'Calculando...'}
                    </h4>
                  </div>
                </div>
                <p className="text-zinc-400 text-xs leading-relaxed font-medium">
                  {aiRoute?.instrucciones?.[0] || 'El Guardián está analizando la red de nodos para determinar la salida más segura.'}
                </p>
              </div>
              
              <div className="flex flex-col items-end gap-4">
                <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 p-4 rounded-2xl flex items-center gap-4 shadow-2xl">
                  <div className="text-right">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Tiempo Estimado</p>
                    <p className="text-xl font-black text-white tracking-tighter">{aiRoute?.tiempoEstimado || '--:--'}</p>
                  </div>
                  <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <Shield className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {aiRoute && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                    <Navigation className="w-6 h-6 text-blue-500" />
                    Instrucciones de Evacuación
                  </h3>
                  <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                    aiRoute.nivelAlerta === 'Rojo' ? 'bg-rose-500 text-white' : 
                    aiRoute.nivelAlerta === 'Amarillo' ? 'bg-amber-500 text-black' : 
                    'bg-emerald-500 text-white'
                  }`}>
                    Alerta: {aiRoute.nivelAlerta}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {aiRoute.instrucciones.map((step: string, i: number) => (
                    <div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 font-black text-xs shrink-0">
                        {i + 1}
                      </div>
                      <p className="text-zinc-300 text-sm leading-relaxed font-medium">{step}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Routes & Status */}
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-[32px] p-8 shadow-xl">
            <h3 className="text-xl font-black text-white mb-6 flex items-center gap-3 uppercase tracking-tight">
              <Navigation className="w-6 h-6 text-indigo-500" />
              Rutas Disponibles
            </h3>
            <div className="space-y-4">
              {routes.map((route) => (
                <button
                  key={route.id}
                  onClick={() => setActiveRoute(route.id)}
                  className={`w-full text-left p-5 rounded-2xl border transition-all group relative overflow-hidden ${
                    activeRoute === route.id 
                      ? 'bg-emerald-500/10 border-emerald-500/50' 
                      : 'bg-zinc-800/50 border-white/5 hover:border-white/10'
                  }`}
                >
                  {route.status === 'blocked' && (
                    <div className="absolute inset-0 bg-rose-500/5 backdrop-blur-[1px] pointer-events-none" />
                  )}
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">{route.id}</span>
                      <span className={`px-3 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                        route.status === 'clear' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                      }`}>
                        {route.status === 'clear' ? 'Despejada' : 'Obstruida'}
                      </span>
                    </div>
                    <h4 className="font-black text-white group-hover:text-emerald-400 transition-colors uppercase tracking-tight">{route.name}</h4>
                    <div className="flex items-center gap-6 mt-4">
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-black uppercase tracking-widest">
                        <Users className="w-4 h-4" />
                        <span>{route.capacity}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-black uppercase tracking-widest">
                        <Clock className="w-4 h-4" />
                        <span>{route.time}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-white/10 rounded-[32px] p-8 shadow-xl">
            <h3 className="text-xl font-black text-white mb-6 flex items-center gap-3 uppercase tracking-tight">
              <Shield className="w-6 h-6 text-amber-500" />
              Estado Crítico
            </h3>
            <div className="space-y-6">
              {[
                { label: 'Sensores de Humo', status: 'Online', color: 'text-emerald-500' },
                { label: 'Luces de Emergencia', status: 'Online', color: 'text-emerald-500' },
                { label: 'Rociadores', status: 'Mantenimiento', color: 'text-amber-500' },
                { label: 'Red de Incendio', status: 'Online', color: 'text-emerald-500' },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm font-bold text-zinc-400 uppercase tracking-tight">{item.label}</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${item.color.replace('text', 'bg')} animate-pulse`} />
                    <span className={`text-[10px] font-black uppercase tracking-widest ${item.color}`}>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
