import React, { useState, useRef, useEffect } from 'react';
import { Camera, AlertTriangle, Thermometer, Lock, Zap, Info, X, Network, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProject } from '../contexts/ProjectContext';

interface ARMarker {
  id: string;
  x: number;
  y: number;
  type: 'loto' | 'temp' | 'iperc';
  title: string;
  value?: string;
  status?: 'safe' | 'warning' | 'danger';
  details: string;
}

export default function WebXR() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [markers, setMarkers] = useState<ARMarker[]>([]);
  const [selectedMarker, setSelectedMarker] = useState<ARMarker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zkNodes, setZkNodes] = useState<any[]>([]);
  const [zkLoading, setZkLoading] = useState(false);
  const { selectedProject } = useProject();

  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("No se pudo acceder a la cámara. Verifique los permisos.");
      }
    };

    if (isScanning) {
      startCamera();
      
      // Simulate detecting markers after a short delay
      const timer = setTimeout(() => {
        setMarkers([
          {
            id: 'm1',
            x: 30,
            y: 40,
            type: 'loto',
            title: 'Punto LOTO Principal',
            status: 'danger',
            details: 'Válvula de aislamiento de energía principal. Requiere candado rojo y tarjeta de bloqueo antes de intervenir.'
          },
          {
            id: 'm2',
            x: 70,
            y: 20,
            type: 'temp',
            title: 'Motor de Perforación',
            value: '85°C',
            status: 'warning',
            details: 'Temperatura elevada detectada. Límite operativo: 90°C. Monitoreo continuo requerido.'
          },
          {
            id: 'm3',
            x: 50,
            y: 60,
            type: 'iperc',
            title: 'IPERC: Atrapamiento',
            status: 'danger',
            details: 'Riesgo crítico de atrapamiento por partes móviles. Mantener distancia de seguridad de 2 metros.'
          }
        ]);
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      setMarkers([]);
      setSelectedMarker(null);
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isScanning]);

  // Load Zettelkasten nodes related to the selected marker whenever it changes
  useEffect(() => {
    if (!selectedMarker || !selectedProject) { setZkNodes([]); return; }
    setZkLoading(true);
    getDocs(
      query(
        collection(db, 'nodes'),
        where('projectId', '==', selectedProject.id),
        where('tags', 'array-contains', selectedMarker.title)
      )
    )
      .then(snap => setZkNodes(snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, 4)))
      .catch(() => setZkNodes([]))
      .finally(() => setZkLoading(false));
  }, [selectedMarker, selectedProject]);

  const getMarkerIcon = (type: string) => {
    switch (type) {
      case 'loto': return <Lock className="w-6 h-6 text-white" />;
      case 'temp': return <Thermometer className="w-6 h-6 text-white" />;
      case 'iperc': return <AlertTriangle className="w-6 h-6 text-white" />;
      default: return <Info className="w-6 h-6 text-white" />;
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'safe': return 'bg-emerald-500';
      case 'warning': return 'bg-amber-500';
      case 'danger': return 'bg-rose-500';
      default: return 'bg-blue-500';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Visión Aumentada (WebXR)</h1>
          <p className="text-gray-500">Escaneo de maquinaria y puntos críticos en tiempo real</p>
        </div>
        <button
          onClick={() => setIsScanning(!isScanning)}
          className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${
            isScanning 
              ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' 
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          <Camera className="w-5 h-5" />
          {isScanning ? 'Detener Escaneo' : 'Iniciar Escaneo AR'}
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <p>{error}</p>
        </div>
      )}

      <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video shadow-xl border border-gray-800">
        {!isScanning ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <Camera className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">Cámara inactiva</p>
            <p className="text-sm">Inicie el escaneo para activar la Realidad Aumentada</p>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="absolute inset-0 w-full h-full object-cover"
            />
            
            {/* AR Overlay Grid */}
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-30 pointer-events-none" />

            {/* Scanning Animation */}
            {markers.length === 0 && (
              <motion.div 
                className="absolute inset-0 border-b-2 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                animate={{ top: ['0%', '100%', '0%'] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />
            )}

            {/* AR Markers */}
            <AnimatePresence>
              {markers.map((marker) => (
                <motion.div
                  key={marker.id}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group"
                  style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                  onClick={() => setSelectedMarker(marker)}
                >
                  <div className="relative">
                    {/* Pulse effect */}
                    <div className={`absolute inset-0 rounded-full animate-ping opacity-75 ${getStatusColor(marker.status)}`} />
                    
                    {/* Marker Icon */}
                    <div className={`relative w-12 h-12 rounded-full flex items-center justify-center shadow-lg border-2 border-white ${getStatusColor(marker.status)}`}>
                      {getMarkerIcon(marker.type)}
                    </div>
                    
                    {/* Label */}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-gray-900/90 backdrop-blur-sm text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                      {marker.title}
                      {marker.value && <span className="ml-1 font-bold">{marker.value}</span>}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* Marker Details Modal */}
      <AnimatePresence>
        {selectedMarker && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-white rounded-xl shadow-lg border border-gray-200 p-6"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg text-white ${getStatusColor(selectedMarker.status)}`}>
                  {getMarkerIcon(selectedMarker.type)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{selectedMarker.title}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${getStatusColor(selectedMarker.status)}`}>
                      {selectedMarker.status === 'danger' ? 'Crítico' : selectedMarker.status === 'warning' ? 'Advertencia' : 'Seguro'}
                    </span>
                    {selectedMarker.value && (
                      <span className="text-sm font-medium text-gray-600">
                        Valor actual: {selectedMarker.value}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedMarker(null)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
              <p className="text-gray-700 leading-relaxed">
                {selectedMarker.details}
              </p>
            </div>
            
            {/* Zettelkasten nodes related to this marker */}
            <div className="mt-4 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Network className="w-4 h-4 text-indigo-500" />
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Nodos ZK Relacionados</p>
                {zkLoading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
              </div>
              {!zkLoading && zkNodes.length === 0 && (
                <p className="text-xs text-gray-400">Sin nodos registrados para este equipo.</p>
              )}
              <div className="space-y-2">
                {zkNodes.map(node => (
                  <div key={node.id} className="flex items-start gap-2 p-2 bg-indigo-50 rounded-lg border border-indigo-100">
                    <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-indigo-800">{node.title}</p>
                      {node.description && <p className="text-[10px] text-indigo-600 mt-0.5 line-clamp-2">{node.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button className="px-4 py-2 text-indigo-600 font-medium hover:bg-indigo-50 rounded-lg transition-colors">
                Ver Historial
              </button>
              <button className="px-4 py-2 bg-indigo-600 text-white font-medium hover:bg-indigo-700 rounded-lg transition-colors">
                Reportar Anomalía
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
