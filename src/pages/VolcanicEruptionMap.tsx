import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Mountain, Wind, AlertTriangle, MapPin, ShieldAlert, Navigation, Info, Loader2 } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { GoogleMap, useJsApiLoader, Marker, Circle, Polygon } from '@react-google-maps/api';

const containerStyle = {
  width: '100%',
  height: '100%'
};

// Helper to calculate destination point given distance and bearing
const getDestinationPoint = (lat: number, lng: number, distance: number, bearing: number) => {
  const R = 6371e3; // Earth's radius in meters
  const d = distance;
  const brng = (bearing * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d / R) +
      Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1),
      Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (lon2 * 180) / Math.PI };
};

export function VolcanicEruptionMap() {
  // Villarrica Volcano coordinates
  const [volcanoLocation, setVolcanoLocation] = useState({ lat: -39.4200, lng: -71.9396, name: 'Volcán Villarrica' });
  const [windDirection, setWindDirection] = useState(45); // Degrees
  const [windSpeed, setWindSpeed] = useState(20); // km/h
  const [alertLevel, setAlertLevel] = useState<'yellow' | 'orange' | 'red'>('orange');

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  });

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'yellow': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'orange': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
      case 'red': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      default: return 'text-zinc-400 bg-zinc-800 border-white/10';
    }
  };

  // Calculate ash plume polygon
  const plumePaths = useMemo(() => {
    const spreadAngle = 60; // Degrees wide
    const plumeLength = windSpeed * 1000; // 1km per km/h as an arbitrary scale for visualization
    const points = [volcanoLocation];
    
    // Create an arc for the end of the plume
    for (let angle = windDirection - spreadAngle / 2; angle <= windDirection + spreadAngle / 2; angle += 5) {
      points.push(getDestinationPoint(volcanoLocation.lat, volcanoLocation.lng, plumeLength, angle));
    }
    
    return points;
  }, [volcanoLocation, windDirection, windSpeed]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Mountain className="w-8 h-8 text-orange-500" />
            Protocolo Volcánico
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Mapeo de Dispersión de Cenizas y Evacuación
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${getAlertColor(alertLevel)}`}>
          <AlertTriangle className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Alerta {alertLevel === 'yellow' ? 'Amarilla' : alertLevel === 'orange' ? 'Naranja' : 'Roja'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            Parámetros de Simulación
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Dirección del Viento (Grados)</label>
              <input
                type="range"
                min="0"
                max="360"
                value={windDirection}
                onChange={(e) => setWindDirection(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>N (0°)</span>
                <span className="font-bold text-blue-400">{windDirection}°</span>
                <span>N (360°)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Velocidad del Viento (km/h)</label>
              <input
                type="range"
                min="0"
                max="100"
                value={windSpeed}
                onChange={(e) => setWindSpeed(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>0 km/h</span>
                <span className="font-bold text-blue-400">{windSpeed} km/h</span>
                <span>100 km/h</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Nivel de Alerta SERNAGEOMIN</label>
              <div className="flex gap-2">
                <button onClick={() => setAlertLevel('yellow')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${alertLevel === 'yellow' ? 'bg-amber-400/20 text-amber-400 border-amber-400/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Amarilla</button>
                <button onClick={() => setAlertLevel('orange')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${alertLevel === 'orange' ? 'bg-orange-500/20 text-orange-500 border-orange-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Naranja</button>
                <button onClick={() => setAlertLevel('red')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${alertLevel === 'red' ? 'bg-rose-500/20 text-rose-500 border-rose-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Roja</button>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-orange-500" />
              Acciones Requeridas
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                <span>Uso obligatorio de mascarilla N95/FFP2 o superior.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                <span>Sellar tomas de aire de maquinaria pesada.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                <span>Evacuar zonas de riesgo de lahares (cauces de ríos).</span>
              </li>
            </ul>
          </div>
        </Card>

        {/* Map Visualization */}
        <Card className="p-0 border-white/5 lg:col-span-2 overflow-hidden relative min-h-[500px] bg-zinc-900 flex items-center justify-center">
          {!isLoaded ? (
            <div className="flex flex-col items-center justify-center text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-sm font-bold uppercase tracking-widest">Cargando Mapa...</p>
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={containerStyle}
              center={volcanoLocation}
              zoom={10}
              options={{
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
                disableDefaultUI: true,
                zoomControl: true,
              }}
            >
              {/* Volcano Marker */}
              <Marker 
                position={volcanoLocation} 
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 10,
                  fillColor: "#f97316",
                  fillOpacity: 1,
                  strokeWeight: 2,
                  strokeColor: "#ffffff"
                }}
              />

              {/* Exclusion Zone (10km) */}
              <Circle
                center={volcanoLocation}
                radius={10000}
                options={{
                  fillColor: "#ef4444",
                  fillOpacity: 0.1,
                  strokeColor: "#ef4444",
                  strokeOpacity: 0.5,
                  strokeWeight: 2,
                }}
              />

              {/* Precaution Zone (20km) */}
              <Circle
                center={volcanoLocation}
                radius={20000}
                options={{
                  fillColor: "#f97316",
                  fillOpacity: 0.05,
                  strokeColor: "#f97316",
                  strokeOpacity: 0.5,
                  strokeWeight: 2,
                  strokeDasharray: "5 5"
                }}
              />

              {/* Ash Plume (Polygon) */}
              <Polygon
                paths={plumePaths}
                options={{
                  fillColor: "#a1a1aa",
                  fillOpacity: 0.4,
                  strokeColor: "#a1a1aa",
                  strokeOpacity: 0.8,
                  strokeWeight: 1,
                }}
              />
            </GoogleMap>
          )}

          {/* Wind Indicator Overlay */}
          <div className="absolute bottom-6 left-6 bg-black/70 backdrop-blur-md border border-white/10 p-3 rounded-xl flex items-center gap-3 z-10">
            <div 
              className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center transition-transform duration-500"
              style={{ transform: `rotate(${windDirection}deg)` }}
            >
              <Wind className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Viento</p>
              <p className="text-[10px] text-blue-400">{windSpeed} km/h a {windDirection}°</p>
            </div>
          </div>

          <div className="absolute top-6 right-6 bg-black/70 backdrop-blur-md border border-white/10 p-3 rounded-xl max-w-xs z-10">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-300">
                El cono de dispersión de cenizas se calcula en tiempo real basándose en la dirección y velocidad del viento. Las zonas bajo la pluma deben suspender operaciones a la intemperie.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
