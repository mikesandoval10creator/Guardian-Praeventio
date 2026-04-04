import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleMap, useJsApiLoader, OverlayView, Marker } from '@react-google-maps/api';
import { 
  Map as MapIcon, 
  AlertTriangle, 
  Info, 
  Layers, 
  Maximize2, 
  Minimize2, 
  Activity,
  Zap,
  ShieldAlert,
  Thermometer,
  Wind,
  Droplets,
  Plus,
  Search,
  X,
  Users,
  Cpu,
  Navigation,
  Eye,
  EyeOff,
  Brain,
  Loader2
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { NodeType, RiskNode, Worker, Asset } from '../types';
import { where } from 'firebase/firestore';
import { analyzeSiteMapDensity } from '../services/geminiService';
import { useSeismicMonitor } from '../hooks/useSeismicMonitor';

const containerStyle = {
  width: '100%',
  height: '100%',
  maxWidth: '100%',
  overflow: 'hidden',
  boxSizing: 'border-box' as const
};

// Default center: Santiago, Chile
const defaultCenter = {
  lat: -33.4489,
  lng: -70.6693
};

export function SiteMap() {
  const { selectedProject } = useProject();
  const { nodes } = useUniversalKnowledge();
  const { updateNode } = useRiskEngine();
  
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  });

  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<RiskNode | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [nodeToPlace, setNodeToPlace] = useState<RiskNode | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeLayers, setActiveLayers] = useState({
    risks: true,
    incidents: true,
    assets: true,
    personnel: true,
    seismic: true
  });
  const [aiInsight, setAiInsight] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const { environment } = useUniversalKnowledge();
  const weather = environment?.weather;

  const projectLat = selectedProject?.coordinates?.lat || defaultCenter.lat;
  const projectLng = selectedProject?.coordinates?.lng || defaultCenter.lng;
  const { earthquakes } = useSeismicMonitor(projectLat, projectLng);

  // Fetch workers for the project
  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : 'workers'
  );

  // Fetch assets for the project
  const { data: assets } = useFirestoreCollection<Asset>(
    'assets',
    selectedProject ? [where('projectId', '==', selectedProject.id)] : []
  );

  const hotspots = useMemo(() => {
    return nodes.filter(n => 
      n.metadata?.lat !== undefined && 
      n.metadata?.lng !== undefined &&
      (!selectedProject || n.projectId === selectedProject.id)
    );
  }, [nodes, selectedProject]);

  const unplacedNodes = useMemo(() => {
    return nodes.filter(n => 
      n.metadata?.lat === undefined && 
      (n.type === NodeType.RISK || n.type === NodeType.INCIDENT || n.type === NodeType.ASSET) &&
      n.title.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (!selectedProject || n.projectId === selectedProject.id)
    );
  }, [nodes, searchTerm, selectedProject]);

  useEffect(() => {
    const runAnalysis = async () => {
      if (!selectedProject || hotspots.length === 0) return;
      
      setIsAnalyzing(true);
      try {
        const nodesCtx = hotspots.map(h => `${h.type}: ${h.title} (${h.metadata.lat}, ${h.metadata.lng})`).join('\n');
        const workersCtx = workers.filter(w => w.coordinates?.lat).map(w => `${w.name}: (${w.coordinates?.lat}, ${w.coordinates?.lng})`).join('\n');
        const assetsCtx = assets.filter(a => a.coordinates?.lat).map(a => `${a.name}: (${a.coordinates?.lat}, ${a.coordinates?.lng})`).join('\n');
        
        const result = await analyzeSiteMapDensity(nodesCtx, workersCtx, assetsCtx);
        setAiInsight(result);
      } catch (error) {
        console.error('Error analyzing density:', error);
      } finally {
        setIsAnalyzing(false);
      }
    };

    const timer = setTimeout(runAnalysis, 2000);
    return () => clearTimeout(timer);
  }, [hotspots, workers, assets, selectedProject]);

  const onLoad = useCallback(function callback(map: google.maps.Map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback(map: google.maps.Map) {
    setMap(null);
  }, []);

  const handleMapClick = async (e: google.maps.MapMouseEvent) => {
    if (!isPlacing || !nodeToPlace || !e.latLng) return;

    const lat = e.latLng.lat();
    const lng = e.latLng.lng();

    await updateNode(nodeToPlace.id, {
      metadata: {
        ...nodeToPlace.metadata,
        lat,
        lng
      }
    });

    setIsPlacing(false);
    setNodeToPlace(null);
  };

  const getNodeColor = (type: NodeType) => {
    switch (type) {
      case NodeType.RISK: return 'bg-red-500';
      case NodeType.INCIDENT: return 'bg-rose-500';
      case NodeType.ASSET: return 'bg-blue-500';
      case NodeType.WORKER: return 'bg-emerald-500';
      default: return 'bg-zinc-500';
    }
  };

  const toggleLayer = (layer: keyof typeof activeLayers) => {
    setActiveLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  const sensorData = [
    { label: 'Temp', value: weather?.temp !== undefined ? `${Math.round(weather.temp)}°` : '--°', icon: Thermometer, color: 'text-orange-500' },
    { label: 'Viento', value: weather?.windSpeed !== undefined ? `${Math.round(weather.windSpeed)} km/h` : '--', icon: Wind, color: 'text-blue-500' },
    { label: 'Humedad', value: weather?.humidity !== undefined ? `${weather.humidity}%` : '--%', icon: Droplets, color: 'text-cyan-500' }
  ];

  return (
    <div className="p-2 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6 w-full overflow-hidden box-border">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full min-w-0">
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shrink-0">
            <MapIcon className="w-5 h-5 sm:w-8 sm:h-8 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">Mapa de Sitio</h1>
            <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mt-0.5 sm:mt-1">Inteligencia Operativa</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto min-w-0">
          <button 
            onClick={() => setIsPlacing(!isPlacing)}
            className={`flex-shrink-0 flex items-center justify-center gap-2 px-4 py-2 sm:py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all border w-full sm:w-auto ${
              isPlacing 
                ? 'bg-red-500 text-white border-red-600 shadow-lg shadow-red-500/20' 
                : 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {isPlacing ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {isPlacing ? 'Cancelar' : 'Ubicar Nodo'}
          </button>
          <div className="flex overflow-x-auto items-center gap-1.5 sm:gap-2 bg-zinc-100 dark:bg-zinc-900 p-1 sm:p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full min-w-0 custom-scrollbar">
            {[
              { id: 'risks', label: 'Riesgos', icon: AlertTriangle },
              { id: 'incidents', label: 'Incidentes', icon: ShieldAlert },
              { id: 'assets', label: 'Activos', icon: Cpu },
              { id: 'personnel', label: 'Personal', icon: Users },
              { id: 'seismic', label: 'Sismos', icon: Activity },
            ].map((layer) => (
              <button
                key={layer.id}
                onClick={() => toggleLayer(layer.id as any)}
                className={`flex-shrink-0 flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[9px] sm:text-xs font-black uppercase tracking-widest transition-all ${
                  activeLayers[layer.id as keyof typeof activeLayers] 
                    ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
              >
                <layer.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>{layer.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 w-full min-w-0">
        {/* Main Map Area */}
        <div 
          className={`lg:col-span-3 bg-zinc-100 dark:bg-zinc-900 rounded-2xl sm:rounded-[2.5rem] border border-zinc-200 dark:border-zinc-800 overflow-hidden relative transition-all duration-500 w-full max-w-full min-w-0 ${
            isExpanded ? 'h-[60vh] sm:h-[700px]' : 'h-[250px] sm:h-[500px]'
          } ${isPlacing ? 'cursor-crosshair ring-2 ring-indigo-500 ring-inset' : ''}`}
        >
          {/* Map Controls */}
          <div className="absolute top-2 right-2 sm:top-6 sm:right-6 z-20 flex flex-col gap-1 sm:gap-2">
            <button 
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
              className="p-1.5 sm:p-3 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md rounded-lg sm:rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-indigo-500 transition-colors"
            >
              {isExpanded ? <Minimize2 className="w-3 h-3 sm:w-5 sm:h-5" /> : <Maximize2 className="w-3 h-3 sm:w-5 sm:h-5" />}
            </button>
            <button className="p-1.5 sm:p-3 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md rounded-lg sm:rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-indigo-500 transition-colors">
              <Layers className="w-3 h-3 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Map Header Overlay */}
          <div className="absolute top-2 left-2 sm:top-6 sm:left-6 z-20 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md p-1.5 sm:p-4 rounded-lg sm:rounded-3xl shadow-lg border border-zinc-200 dark:border-zinc-800 max-w-[100px] sm:max-w-xs">
            <div className="flex items-center gap-1 sm:gap-3 mb-0.5 sm:mb-2">
              <div className="w-3.5 h-3.5 sm:w-8 sm:h-8 rounded sm:rounded-xl bg-indigo-500/20 flex items-center justify-center">
                <ShieldAlert className="w-2 h-2 sm:w-4 sm:h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="text-[8px] sm:text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight">Estado</h3>
            </div>
            <p className="text-[7px] sm:text-xs text-zinc-500 font-bold leading-tight truncate">
              {selectedProject?.name || 'Proyecto General'}
            </p>
            <div className="mt-0.5 sm:mt-3 flex items-center gap-1 sm:gap-2">
              <span className="flex h-1 w-1 sm:h-2 sm:w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[6px] sm:text-[10px] font-black text-emerald-600 uppercase tracking-widest">Activo</span>
            </div>
          </div>

          {/* Google Map Background */}
          <div className="absolute inset-0">
            {isLoaded ? (
              <GoogleMap
                mapContainerStyle={containerStyle}
                center={defaultCenter}
                zoom={15}
                onLoad={onLoad}
                onUnmount={onUnmount}
                onClick={handleMapClick}
                options={{
                  disableDefaultUI: true,
                  zoomControl: false,
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
                {/* Hotspots from Red Neuronal */}
                {hotspots.map((spot) => {
                  if (spot.type === NodeType.RISK && !activeLayers.risks) return null;
                  if (spot.type === NodeType.INCIDENT && !activeLayers.incidents) return null;
                  if (spot.type === NodeType.ASSET && !activeLayers.assets) return null;

                  return (
                    <OverlayView
                      key={spot.id}
                      position={{ lat: spot.metadata.lat, lng: spot.metadata.lng }}
                      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                    >
                      <motion.button
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        whileHover={{ scale: 1.2 }}
                        onClick={(e) => { e.stopPropagation(); setSelectedHotspot(spot); }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shadow-lg z-10 text-white ${getNodeColor(spot.type)}`}
                      >
                        {spot.type === NodeType.RISK ? <AlertTriangle className="w-5 h-5 sm:w-4 sm:h-4" /> : 
                         spot.type === NodeType.INCIDENT ? <ShieldAlert className="w-5 h-5 sm:w-4 sm:h-4" /> : 
                         <Activity className="w-5 h-5 sm:w-4 sm:h-4" />}
                        
                        {(spot.type === NodeType.RISK || spot.type === NodeType.INCIDENT) && (
                          <span className={`absolute inset-0 rounded-full animate-ping opacity-40 ${getNodeColor(spot.type)}`} />
                        )}
                      </motion.button>
                    </OverlayView>
                  );
                })}

                {/* Personnel Layer */}
                {activeLayers.personnel && workers.filter(w => w.coordinates?.lat).map((worker) => (
                  <OverlayView
                    key={worker.id}
                    position={{ lat: worker.coordinates!.lat, lng: worker.coordinates!.lng }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
                    >
                      <div className="relative group">
                        <div className="w-10 h-10 sm:w-8 sm:h-8 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-950 shadow-lg flex items-center justify-center overflow-hidden">
                          {worker.photoUrl ? (
                            <img src={worker.photoUrl} alt={worker.name} className="w-full h-full object-cover" />
                          ) : (
                            <Users className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
                          )}
                        </div>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <div className="bg-zinc-900 text-white px-2 py-1 rounded text-[8px] font-black uppercase whitespace-nowrap border border-white/10">
                            {worker.name}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </OverlayView>
                ))}

                {/* Seismic Layer */}
                {activeLayers.seismic && earthquakes.map((quake) => (
                  <OverlayView
                    key={quake.id}
                    position={{ lat: quake.coordinates[1], lng: quake.coordinates[0] }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      whileHover={{ scale: 1.2 }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-30 group cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(quake.url, '_blank');
                      }}
                    >
                      <div className={`w-10 h-10 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shadow-lg text-white border-2 border-white dark:border-zinc-950 ${quake.magnitude >= 5.0 ? 'bg-red-600' : quake.magnitude >= 4.0 ? 'bg-orange-500' : 'bg-yellow-500'}`}>
                        <Activity className="w-5 h-5 sm:w-4 sm:h-4" />
                      </div>
                      <span className={`absolute inset-0 rounded-full animate-ping opacity-40 ${quake.magnitude >= 5.0 ? 'bg-red-600' : quake.magnitude >= 4.0 ? 'bg-orange-500' : 'bg-yellow-500'}`} />
                      
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-40">
                        <div className="bg-zinc-900 text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase whitespace-nowrap border border-white/10 flex flex-col items-center gap-1 shadow-xl">
                          <span className="text-red-400">Mag {quake.magnitude.toFixed(1)}</span>
                          <span className="text-zinc-400 font-medium">{quake.place}</span>
                        </div>
                      </div>
                    </motion.div>
                  </OverlayView>
                ))}

                {/* Assets/Sensors Layer */}
                {activeLayers.assets && assets.filter(a => a.coordinates?.lat).map((asset) => (
                  <OverlayView
                    key={asset.id}
                    position={{ lat: asset.coordinates!.lat, lng: asset.coordinates!.lng }}
                    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-15"
                    >
                      <div className="p-2 sm:p-1.5 rounded-lg bg-zinc-800 border border-blue-500/50 shadow-lg">
                        <Cpu className="w-4 h-4 sm:w-3 sm:h-3 text-blue-400" />
                      </div>
                    </motion.div>
                  </OverlayView>
                ))}
              </GoogleMap>
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              </div>
            )}
          </div>

          {/* Node Placement Overlay */}
          <AnimatePresence>
            {isPlacing && !nodeToPlace && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute inset-x-2 sm:inset-x-6 bottom-2 sm:bottom-6 z-30 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl rounded-xl sm:rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-2xl p-2 sm:p-6"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 sm:gap-0 mb-1.5 sm:mb-4">
                  <h3 className="text-[9px] sm:text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white">Selecciona un Nodo</h3>
                  <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-3 h-3 sm:w-4 sm:h-4 text-zinc-500" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Buscar..."
                      className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg sm:rounded-xl pl-6 sm:pl-9 pr-2 sm:pr-4 py-1 sm:py-2 text-[9px] sm:text-xs text-zinc-900 dark:text-white focus:outline-none w-full sm:w-64"
                    />
                  </div>
                </div>
                <div className="flex gap-1.5 sm:gap-3 overflow-x-auto pb-1 sm:pb-2 custom-scrollbar">
                  {unplacedNodes.map(node => (
                    <button
                      key={node.id}
                      onClick={() => setNodeToPlace(node)}
                      className="flex-shrink-0 p-1.5 sm:p-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-lg sm:rounded-2xl hover:border-indigo-500/50 transition-all text-left w-24 sm:w-48"
                    >
                      <div className={`w-1 h-1 sm:w-2 sm:h-2 rounded-full mb-1 sm:mb-2 ${getNodeColor(node.type)}`} />
                      <p className="text-[8px] sm:text-xs font-black text-zinc-900 dark:text-white uppercase truncate">{node.title}</p>
                      <p className="text-[7px] sm:text-[10px] font-bold text-zinc-500 uppercase mt-0.5 sm:mt-1">{node.type}</p>
                    </button>
                  ))}
                  {unplacedNodes.length === 0 && (
                    <p className="text-[9px] sm:text-xs text-zinc-500 italic py-1 sm:py-4">No hay nodos pendientes.</p>
                  )}
                </div>
              </motion.div>
            )}

            {isPlacing && nodeToPlace && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 bg-indigo-600 text-white px-2 sm:px-6 py-1.5 sm:py-3 rounded-lg sm:rounded-2xl shadow-2xl flex items-center gap-1 sm:gap-3 pointer-events-none w-[90%] sm:w-auto justify-center text-center"
              >
                <MapIcon className="w-3 h-3 sm:w-5 sm:h-5 shrink-0" />
                <span className="text-[8px] sm:text-xs font-black uppercase tracking-widest leading-tight">Haz clic en el mapa para ubicar: {nodeToPlace.title}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Hotspot Detail Overlay */}
          <AnimatePresence>
            {selectedHotspot && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-2 sm:bottom-6 left-2 sm:left-6 right-2 sm:right-auto sm:w-80 z-30 bg-white dark:bg-zinc-950 rounded-xl sm:rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
              >
                <div className={`p-1.5 sm:p-4 flex items-center justify-between text-white ${getNodeColor(selectedHotspot.type)}`}>
                  <h4 className="text-[9px] sm:text-xs font-black uppercase tracking-widest truncate pr-2">{selectedHotspot.title}</h4>
                  <button onClick={() => setSelectedHotspot(null)} className="p-1 sm:p-1.5 hover:bg-white/20 rounded-lg transition-colors shrink-0">
                    <X className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
                </div>
                <div className="p-2 sm:p-5 space-y-1.5 sm:space-y-4">
                  <p className="text-[9px] sm:text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium line-clamp-2 sm:line-clamp-3">
                    {selectedHotspot.description}
                  </p>
                  <div className="flex flex-wrap gap-1 sm:gap-2">
                    {selectedHotspot.tags.map(tag => (
                      <span key={tag} className="px-1 sm:px-2 py-0.5 sm:py-1 bg-zinc-100 dark:bg-zinc-900 rounded sm:rounded-lg text-[7px] sm:text-[10px] font-bold text-zinc-500 uppercase">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1 sm:gap-2">
                    <button className="flex-1 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-1 sm:py-2.5 rounded-lg sm:rounded-xl text-[7px] sm:text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity">
                      Red Neuronal
                    </button>
                    <button 
                      onClick={async () => {
                        await updateNode(selectedHotspot.id, { metadata: { ...selectedHotspot.metadata, lat: undefined, lng: undefined } });
                        setSelectedHotspot(null);
                      }}
                      className="flex-1 border border-red-200 text-red-500 py-1 sm:py-2.5 rounded-lg sm:rounded-xl text-[7px] sm:text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition-colors"
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sidebar Panel */}
        <div className="space-y-4 sm:space-y-6 w-full min-w-0">
          {/* Environmental Sensors */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl sm:rounded-[2rem] border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 shadow-sm">
            <h3 className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-500 mb-3 sm:mb-6 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Sensores Ambientales
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
              {sensorData.map((sensor, i) => (
                <div key={i} className="p-2 sm:p-4 bg-zinc-50 dark:bg-zinc-950 rounded-xl sm:rounded-2xl border border-zinc-100 dark:border-zinc-800 flex flex-col items-center sm:items-start text-center sm:text-left">
                  <sensor.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${sensor.color} mb-1 sm:mb-2`} />
                  <p className="text-[9px] sm:text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{sensor.label}</p>
                  <p className="text-xs sm:text-sm font-black text-zinc-900 dark:text-white mt-0.5">{sensor.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* AI Insights */}
          <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 rounded-2xl sm:rounded-[2rem] p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-indigo-500 flex items-center justify-center text-white shrink-0">
                  <Brain className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <h3 className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-indigo-900 dark:text-indigo-300">Análisis Geoespacial</h3>
              </div>
              {isAnalyzing && <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />}
            </div>
            
            {aiInsight ? (
              <div className="space-y-3 sm:space-y-4">
                <p className="text-[10px] sm:text-xs text-indigo-700 dark:text-indigo-400/80 font-medium leading-relaxed">
                  {aiInsight.insightGlobal}
                </p>
                
                {aiInsight.puntosCalientes?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[9px] sm:text-[10px] font-black text-indigo-900/50 dark:text-indigo-300/50 uppercase tracking-widest">Puntos Críticos</p>
                    {aiInsight.puntosCalientes.slice(0, 2).map((pt: any, i: number) => (
                      <div key={i} className="p-2.5 sm:p-3 bg-white/50 dark:bg-zinc-900/50 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] sm:text-[10px] font-black text-indigo-900 dark:text-indigo-300 uppercase truncate pr-2">{pt.sector}</span>
                          <span className={`text-[8px] sm:text-[9px] font-black px-1.5 py-0.5 rounded uppercase shrink-0 ${
                            pt.nivelRiesgo === 'Crítico' ? 'bg-red-500 text-white' :
                            pt.nivelRiesgo === 'Alto' ? 'bg-orange-500 text-white' :
                            'bg-blue-500 text-white'
                          }`}>{pt.nivelRiesgo}</span>
                        </div>
                        <p className="text-[9px] sm:text-[10px] text-zinc-600 dark:text-zinc-400 leading-tight">{pt.recomendacion}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[10px] sm:text-xs text-indigo-700 dark:text-indigo-400/80 font-medium leading-relaxed italic">
                {isAnalyzing ? 'Analizando densidad...' : 'Esperando datos...'}
              </p>
            )}
          </div>

          {/* Live Log from Red Neuronal */}
          <div className="bg-zinc-900 rounded-2xl sm:rounded-[2rem] p-4 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-400">Log de Eventos</h3>
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="space-y-2 sm:space-y-3 max-h-[150px] sm:max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
              {nodes.slice(0, 10).map((node, i) => (
                <div key={i} className="flex gap-2 sm:gap-3 text-[9px] sm:text-[10px] leading-tight group">
                  <span className="text-zinc-600 font-mono flex-shrink-0">
                    {new Date(node.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={`uppercase font-bold truncate ${
                    node.type === NodeType.RISK ? 'text-red-500' :
                    node.type === NodeType.INCIDENT ? 'text-rose-500' :
                    node.type === NodeType.INSPECTION ? 'text-purple-500' :
                    'text-zinc-400'
                  }`}>
                    {node.type}: {node.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
