import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleMap, useJsApiLoader, OverlayView } from '@react-google-maps/api';
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
import { useZettelkasten } from '../hooks/useZettelkasten';
import { calculateDynamicEvacuationRoute, generateEmergencyPlan } from '../services/geminiService';
import { db, collection, addDoc, serverTimestamp, query, orderBy, limit } from '../services/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { NodeType } from '../types';

const containerStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '40px'
};

// Default center: Santiago, Chile
const defaultCenter = {
  lat: -33.4489,
  lng: -70.6693
};

interface IoTEvent {
  id: string;
  type: 'wearable' | 'machinery';
  source: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: any;
  status: 'normal' | 'warning' | 'critical';
}

export function Evacuation() {
  const { selectedProject } = useProject();
  const { nodes, loading: nodesLoading } = useUniversalKnowledge();
  const { addNode } = useZettelkasten();
  
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [emergencyPlan, setEmergencyPlan] = useState<string | null>(null);
  const [aiRoute, setAiRoute] = useState<any>(null);
  const [lastRecalculation, setLastRecalculation] = useState<Date | null>(null);

  const emergencyNodes = nodes.filter(n => (n.type === NodeType.EMERGENCY || n.type === NodeType.ASSET) && n.metadata?.lat && n.metadata?.lng);
  const incidentNodes = nodes.filter(n => n.type === NodeType.INCIDENT);

  // Listen for critical IoT events to trigger recalculation
  const { data: recentEvents } = useFirestoreCollection<IoTEvent>(
    'telemetry_events',
    [orderBy('timestamp', 'desc'), limit(1)]
  );

  const onLoad = useCallback(function callback(map: google.maps.Map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback(map: google.maps.Map) {
    setMap(null);
  }, []);

  const runDynamicCalculation = async (triggerReason: string = "Manual") => {
    setCalculating(true);
    try {
      // Get real workers and machinery data from local storage or context if available, 
      // otherwise fallback to a realistic default state based on the project.
      // In a real app, this would come from a global state management solution (Zustand/Redux) or context.
      const storedTelemetry = localStorage.getItem('telemetry_state');
      let workers = [];
      let machinery = [];
      
      if (storedTelemetry) {
        const parsed = JSON.parse(storedTelemetry);
        workers = parsed.workers || [];
        machinery = parsed.machinery || [];
      } else {
         workers = [
          { id: 'W-01', position: [-2, 0, 2], status: 'normal', isFallen: false },
          { id: 'W-02', position: [3, 0, -1], status: 'warning', isFallen: false },
          { id: 'W-03', position: [0, 0, 4], status: 'normal', isFallen: false },
          { id: 'W-04', position: [-4, 0, -3], status: 'critical', isFallen: true },
        ];

        machinery = [
          { id: 'M-01', type: 'truck', position: [5, 0, 5], status: 'normal' },
          { id: 'M-02', type: 'crane', position: [-5, 0, 0], status: 'warning' },
        ];
      }

      const activeEmergencies = [
        ...incidentNodes.map(n => ({ title: n.title, description: n.description })),
        ...nodes.filter(n => n.type === NodeType.EMERGENCY).map(n => ({ title: n.title, description: n.description }))
      ];
      
      const data = await calculateDynamicEvacuationRoute(activeEmergencies, workers, machinery);
      setAiRoute(data);
      setLastRecalculation(new Date());
    } catch (error) {
      console.error('Error calculating dynamic route:', error);
    } finally {
      setCalculating(false);
    }
  };

  // Auto-recalculate if a new critical event occurs
  useEffect(() => {
    if (recentEvents && recentEvents.length > 0) {
      const latestEvent = recentEvents[0];
      if (latestEvent.status === 'critical') {
        // Only recalculate if it's been at least 30 seconds since the last one to avoid spamming
        const now = new Date();
        if (!lastRecalculation || (now.getTime() - lastRecalculation.getTime() > 30000)) {
          console.log('Triggering automatic route recalculation due to critical IoT event:', latestEvent);
          runDynamicCalculation(`Evento Crítico IoT: ${latestEvent.source} - ${latestEvent.metric}`);
        }
      }
    }
  }, [recentEvents]);

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

  const handleSavePlan = async () => {
    if (!emergencyPlan) return;
    setSavingPlan(true);
    try {
      // Save to Firestore
      const path = selectedProject ? `projects/${selectedProject.id}/emergency_plans` : 'emergency_plans';
      const docRef = await addDoc(collection(db, path), {
        title: `Plan de Emergencia - ${new Date().toLocaleDateString()}`,
        content: emergencyPlan,
        createdAt: serverTimestamp(),
        projectId: selectedProject?.id || null,
        status: 'active'
      });

      // Create Zettelkasten Node
      await addNode({
        type: NodeType.DOCUMENT,
        title: `Plan de Emergencia - ${new Date().toLocaleDateString()}`,
        description: `Plan de emergencia generado por IA para ${selectedProject?.name || 'el proyecto'}.`,
        tags: ['emergencia', 'plan', 'ia'],
        metadata: {
          documentId: docRef.id,
          content: emergencyPlan,
          projectId: selectedProject?.id || null
        },
        connections: [],
        projectId: selectedProject?.id
      });

      setEmergencyPlan(null);
    } catch (error) {
      console.error('Error saving emergency plan:', error);
    } finally {
      setSavingPlan(false);
    }
  };

  // Auto-recalculate if nodes change (e.g. new incident reported)
  useEffect(() => {
    if (nodes.length > 0) {
      // Only recalculate if it's been at least 10 seconds since the last one to avoid spamming on load
      const now = new Date();
      if (!lastRecalculation || (now.getTime() - lastRecalculation.getTime() > 10000)) {
        runDynamicCalculation("Actualización de Red Neuronal (Nuevos Nodos)");
      }
    }
  }, [incidentNodes.length, emergencyNodes.length]);

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
            onClick={() => runDynamicCalculation()}
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

              <div className="p-8 border-t border-white/5 bg-zinc-900/50 flex justify-end gap-4">
                <button 
                  onClick={() => setEmergencyPlan(null)}
                  className="px-6 py-3 rounded-xl border border-white/10 text-white font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSavePlan}
                  disabled={savingPlan}
                  className="px-8 py-4 rounded-2xl bg-rose-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-rose-400 transition-all flex items-center gap-2 shadow-lg shadow-rose-500/20 disabled:opacity-50"
                >
                  {savingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {savingPlan ? 'Guardando...' : 'Guardar Plan'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-[40px] overflow-hidden relative min-h-[600px] group shadow-2xl w-full max-w-full min-w-0">
            {isLoaded ? (
              <GoogleMap
                mapContainerStyle={containerStyle}
                center={defaultCenter}
                zoom={16}
                onLoad={onLoad}
                onUnmount={onUnmount}
                options={{
                  disableDefaultUI: true,
                  zoomControl: true,
                  mapId: 'e4252f20d6f4d314', // Optional: Use a custom map ID for styling
                  styles: [
                    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
                    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
                    {
                      featureType: "administrative.locality",
                      elementType: "labels.text.fill",
                      stylers: [{ color: "#d59563" }],
                    },
                    {
                      featureType: "poi",
                      elementType: "labels.text.fill",
                      stylers: [{ color: "#d59563" }],
                    },
                    {
                      featureType: "poi.park",
                      elementType: "geometry",
                      stylers: [{ color: "#263c3f" }],
                    },
                    {
                      featureType: "poi.park",
                      elementType: "labels.text.fill",
                      stylers: [{ color: "#6b9a76" }],
                    },
                    {
                      featureType: "road",
                      elementType: "geometry",
                      stylers: [{ color: "#38414e" }],
                    },
                    {
                      featureType: "road",
                      elementType: "geometry.stroke",
                      stylers: [{ color: "#212a37" }],
                    },
                    {
                      featureType: "road",
                      elementType: "labels.text.fill",
                      stylers: [{ color: "#9ca5b3" }],
                    },
                    {
                      featureType: "road.highway",
                      elementType: "geometry",
                      stylers: [{ color: "#746855" }],
                    },
                    {
                      featureType: "road.highway",
                      elementType: "geometry.stroke",
                      stylers: [{ color: "#1f2835" }],
                    },
                    {
                      featureType: "road.highway",
                      elementType: "labels.text.fill",
                      stylers: [{ color: "#f3d19c" }],
                    },
                    {
                      featureType: "transit",
                      elementType: "geometry",
                      stylers: [{ color: "#2f3948" }],
                    },
                    {
                      featureType: "transit.station",
                      elementType: "labels.text.fill",
                      stylers: [{ color: "#d59563" }],
                    },
                    {
                      featureType: "water",
                      elementType: "geometry",
                      stylers: [{ color: "#17263c" }],
                    },
                    {
                      featureType: "water",
                      elementType: "labels.text.fill",
                      stylers: [{ color: "#515c6d" }],
                    },
                    {
                      featureType: "water",
                      elementType: "labels.text.stroke",
                      stylers: [{ color: "#17263c" }],
                    },
                  ],
                }}
              >
                {/* Emergency Nodes Overlay */}
                {emergencyNodes.slice(0, 5).map((node, i) => (
                  <OverlayView
                    key={node.id}
                    position={{ lat: node.metadata.lat, lng: node.metadata.lng }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.1 }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto group/node"
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
                  </OverlayView>
                ))}

                {incidentNodes.map((node, i) => (
                  <OverlayView
                    key={node.id}
                    position={{ lat: node.metadata?.lat || defaultCenter.lat, lng: node.metadata?.lng || defaultCenter.lng }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                    >
                      <div className="relative">
                        <div className="w-12 h-12 rounded-full bg-rose-500 animate-ping absolute -inset-4 opacity-30" />
                        <div className="w-8 h-8 rounded-full bg-rose-500 flex items-center justify-center text-white border-2 border-white shadow-xl shadow-rose-500/50">
                          <AlertCircle className="w-5 h-5" />
                        </div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2">
                          <div className="bg-rose-500 text-white px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap shadow-xl">
                            {node.title}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </OverlayView>
                ))}
              </GoogleMap>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
              </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent pointer-events-none" />
            
            {/* Map Controls */}
            <div className="absolute top-6 right-6 flex flex-col gap-2 z-20">
              <button 
                onClick={() => map?.setZoom((map.getZoom() || 15) + 1)}
                className="w-12 h-12 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl flex items-center justify-center text-white hover:bg-zinc-800 transition-all shadow-xl"
              >
                <Plus className="w-6 h-6" />
              </button>
              <button 
                onClick={() => map?.setZoom((map.getZoom() || 15) - 1)}
                className="w-12 h-12 bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl flex items-center justify-center text-white hover:bg-zinc-800 transition-all shadow-xl"
              >
                <Minus className="w-6 h-6" />
              </button>
            </div>

            {/* Map Overlay Info */}
            <div className="absolute bottom-4 sm:bottom-8 left-4 sm:left-8 right-4 sm:right-8 flex flex-col md:flex-row items-start md:items-end justify-between gap-4 z-20">
              <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 p-4 sm:p-6 rounded-[24px] sm:rounded-[32px] w-full md:max-w-sm shadow-2xl">
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
              
              <div className="flex flex-col items-end gap-4 w-full md:w-auto">
                <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 p-4 rounded-2xl flex items-center justify-between md:justify-end gap-4 shadow-2xl w-full md:w-auto">
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
