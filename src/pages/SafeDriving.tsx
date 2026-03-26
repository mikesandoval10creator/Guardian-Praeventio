import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { 
  Map as MapIcon, 
  Navigation, 
  AlertTriangle, 
  Clock, 
  Truck, 
  ShieldAlert,
  PhoneCall,
  CheckCircle2,
  Camera,
  Loader2
} from 'lucide-react';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useProject } from '../contexts/ProjectContext';
import { NodeType } from '../types';

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

const containerStyle = {
  width: '100%',
  height: '100%',
  maxWidth: '100%',
  overflow: 'hidden',
  borderRadius: '2rem',
  boxSizing: 'border-box' as const
};

const defaultCenter = {
  lat: -33.4489,
  lng: -70.6693
};

export function SafeDriving() {
  const [activeTab, setActiveTab] = useState<'route' | 'report'>('route');
  const [description, setDescription] = useState('');
  const [incidentType, setIncidentType] = useState<'Accidente' | 'Falla Mecánica' | null>(null);
  const [loading, setLoading] = useState(false);
  const [reported, setReported] = useState(false);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  
  const { addNode } = useZettelkasten();
  const { selectedProject } = useProject();

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  });

  const onLoad = useCallback(function callback(map: google.maps.Map) {
    setMap(map);
  }, []);

  const onUnmount = useCallback(function callback(map: google.maps.Map) {
    setMap(null);
  }, []);

  const handleSendReport = async () => {
    if (!incidentType || !description || !selectedProject) return;
    setLoading(true);
    try {
      let locationString = 'Ubicación desconocida';
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
        });
        locationString = `Lat: ${position.coords.latitude.toFixed(4)}, Lng: ${position.coords.longitude.toFixed(4)}`;
      } catch (geoError) {
        console.warn("No se pudo obtener la ubicación:", geoError);
        locationString = 'Ubicación no disponible (Permiso denegado o error)';
      }

      // 1. Save to dedicated driving_incidents collection
      const docRef = await addDoc(collection(db, `projects/${selectedProject.id}/driving_incidents`), {
        type: incidentType,
        description: description,
        location: locationString,
        status: 'Reportado',
        timestamp: new Date().toISOString(),
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });

      // 2. Save to Zettelkasten
      const node = await addNode({
        type: NodeType.INCIDENT,
        title: `Incidente en Ruta: ${incidentType}`,
        description: description,
        tags: ['Seguridad Vial', incidentType, 'Urgente'],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          incidentId: docRef.id,
          type: incidentType,
          status: 'Reportado',
          timestamp: new Date().toISOString(),
          location: locationString
        }
      });
      
      setReported(true);
      setDescription('');
      setIncidentType(null);
    } catch (error) {
      console.error('Error sending report:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 w-full overflow-hidden box-border">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
            <Truck className="w-8 h-8 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Conducción Segura</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Gestión de Rutas y Logística</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('route')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === 'route' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Ruta Activa
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === 'report' ? 'bg-red-500 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Reportar Incidente
          </button>
        </div>
      </div>

      {activeTab === 'route' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full min-w-0">
          {/* Map Area */}
          <div className="lg:col-span-2 bg-zinc-100 dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 overflow-hidden relative min-h-[400px] flex flex-col w-full max-w-full min-w-0">
            <div className="absolute top-4 left-4 z-10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md p-3 rounded-2xl shadow-lg border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <Navigation className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Destino Actual</p>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">Planta Industrial Norte</p>
                </div>
              </div>
            </div>
            
            {/* Real Map */}
            <div className="flex-1 w-full h-full bg-[#e5e3df] dark:bg-[#1e1e1e] flex items-center justify-center relative">
              {isLoaded ? (
                <GoogleMap
                  mapContainerStyle={containerStyle}
                  center={defaultCenter}
                  zoom={12}
                  onLoad={onLoad}
                  onUnmount={onUnmount}
                  options={{
                    disableDefaultUI: false,
                    zoomControl: true,
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: true,
                    styles: [
                      {
                        featureType: "all",
                        elementType: "labels.text.fill",
                        stylers: [{ color: "#ffffff" }]
                      },
                      {
                        featureType: "all",
                        elementType: "labels.text.stroke",
                        stylers: [{ color: "#000000" }, { lightness: 13 }]
                      },
                      {
                        featureType: "administrative",
                        elementType: "geometry.fill",
                        stylers: [{ color: "#000000" }]
                      },
                      {
                        featureType: "administrative",
                        elementType: "geometry.stroke",
                        stylers: [{ color: "#144b53" }, { lightness: 14 }, { weight: 1.4 }]
                      },
                      {
                        featureType: "landscape",
                        elementType: "all",
                        stylers: [{ color: "#08304b" }]
                      },
                      {
                        featureType: "poi",
                        elementType: "geometry",
                        stylers: [{ color: "#0c4152" }, { lightness: 5 }]
                      },
                      {
                        featureType: "road.highway",
                        elementType: "geometry.fill",
                        stylers: [{ color: "#000000" }]
                      },
                      {
                        featureType: "road.highway",
                        elementType: "geometry.stroke",
                        stylers: [{ color: "#0b434f" }, { lightness: 25 }]
                      },
                      {
                        featureType: "road.arterial",
                        elementType: "geometry.fill",
                        stylers: [{ color: "#000000" }]
                      },
                      {
                        featureType: "road.arterial",
                        elementType: "geometry.stroke",
                        stylers: [{ color: "#0b3d51" }, { lightness: 16 }]
                      },
                      {
                        featureType: "road.local",
                        elementType: "geometry",
                        stylers: [{ color: "#000000" }]
                      },
                      {
                        featureType: "transit",
                        elementType: "all",
                        stylers: [{ color: "#146474" }]
                      },
                      {
                        featureType: "water",
                        elementType: "all",
                        stylers: [{ color: "#021019" }]
                      }
                    ]
                  }}
                >
                  <Marker position={defaultCenter} icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/truck.png' }} />
                </GoogleMap>
              ) : (
                <div className="flex flex-col items-center justify-center text-zinc-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <span className="text-xs font-bold uppercase tracking-widest">Cargando Mapa...</span>
                </div>
              )}
            </div>
          </div>

          {/* Logistics Panel */}
          <div className="space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[2rem] p-6 shadow-sm">
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-4">Estado del Viaje</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-blue-500" />
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Tiempo Estimado</p>
                      <p className="text-sm font-black text-zinc-900 dark:text-white">1h 45m</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-emerald-500">A tiempo</span>
                </div>

                <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Checklist Vehículo</p>
                      <p className="text-sm font-black text-zinc-900 dark:text-white">Completado</p>
                    </div>
                  </div>
                  <button className="text-[10px] font-bold text-blue-500 hover:underline">Ver</button>
                </div>
              </div>

              <button className="w-full mt-6 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors">
                Finalizar Ruta
              </button>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-[2rem] p-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-800 dark:text-blue-300 mb-1">Alerta de Ruta</h4>
                  <p className="text-xs text-blue-600 dark:text-blue-400/80 font-medium leading-relaxed">
                    Condiciones de lluvia ligera en el km 45. Reduzca la velocidad y mantenga distancia de seguridad.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-2xl mx-auto bg-white dark:bg-zinc-900 border border-red-100 dark:border-red-900/30 rounded-[2rem] p-6 sm:p-8 shadow-xl shadow-red-500/5"
        >
          <div className="flex items-center gap-4 mb-8 pb-6 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Reporte de Incidente en Ruta</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Protocolo de Emergencia Inmediato</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => setIncidentType('Accidente')}
                className={`flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 transition-all group ${
                  incidentType === 'Accidente' ? 'border-red-500 bg-red-50 dark:bg-red-500/10' : 'border-zinc-200 dark:border-zinc-800 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
                }`}
              >
                <AlertTriangle className={`w-8 h-8 ${incidentType === 'Accidente' ? 'text-red-500' : 'text-zinc-400 group-hover:text-red-500'}`} />
                <span className={`text-[10px] font-black uppercase tracking-widest ${incidentType === 'Accidente' ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-red-600 dark:group-hover:text-red-400'}`}>Accidente</span>
              </button>
              <button 
                onClick={() => setIncidentType('Falla Mecánica')}
                className={`flex flex-col items-center justify-center gap-3 p-6 rounded-2xl border-2 transition-all group ${
                  incidentType === 'Falla Mecánica' ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10' : 'border-zinc-200 dark:border-zinc-800 hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                }`}
              >
                <Truck className={`w-8 h-8 ${incidentType === 'Falla Mecánica' ? 'text-amber-500' : 'text-zinc-400 group-hover:text-amber-500'}`} />
                <span className={`text-[10px] font-black uppercase tracking-widest ${incidentType === 'Falla Mecánica' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-600 dark:text-zinc-400 group-hover:text-amber-600 dark:group-hover:text-amber-400'}`}>Falla Mecánica</span>
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Descripción Rápida</label>
              <textarea 
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 text-sm text-zinc-900 dark:text-white focus:ring-2 focus:ring-red-500/50 outline-none resize-none"
                placeholder="Describa brevemente la situación..."
              />
            </div>

            <div className="flex gap-4">
              <button className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2">
                <Camera className="w-4 h-4" />
                Adjuntar Foto
              </button>
              <button 
                onClick={handleSendReport}
                disabled={loading || !incidentType || !description || reported}
                className="flex-1 bg-red-500 text-white py-4 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : reported ? <CheckCircle2 className="w-4 h-4" /> : null}
                {reported ? 'Reportado' : 'Enviar Reporte'}
              </button>
            </div>

            <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
              <button className="w-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2">
                <PhoneCall className="w-4 h-4" />
                Llamar a Central de Emergencias
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
