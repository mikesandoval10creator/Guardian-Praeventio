import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from 'react-i18next';
import { motion } from "framer-motion";
import {
  Waves,
  Map,
  AlertTriangle,
  Navigation,
  ShieldAlert,
  Users,
  ArrowUpRight,
  Loader2,
  Layers
} from "lucide-react";
import { Card, Button } from "../components/shared/Card";
import { GoogleMap, useJsApiLoader, Marker, Polyline, Polygon } from '@react-google-maps/api';
import { getMapLoaderConfig } from '../components/maps/mapConfig';
import {
  eonetAdapter,
  bboxFromCenter,
  buildCalmRecommendation,
  eonetCategoryGlyph,
  type EonetEvent,
} from '../services/external/index.js';

const containerStyle = {
  width: '100%',
  height: '100%'
};

// Valparaíso coordinates
const facilityLocation = { lat: -33.045, lng: -71.620 }; // Near the coast
const safeZoneLocation = { lat: -33.050, lng: -71.610 }; // Higher ground

export function CoastalEmergencyMap() {
  const { t } = useTranslation();
  const [isTsunamiWarning, setIsTsunamiWarning] = useState(false);
  const [evacuationProgress, setEvacuationProgress] = useState(0);

  // Sprint 39 J4b — EONET layer (eventos marítimos en zona).
  // Layer toggle ON por defecto. Click en marker → tooltip tranquilo.
  const [externalEvents, setExternalEvents] = useState<EonetEvent[]>([]);
  const [externalLayerOn, setExternalLayerOn] = useState(true);
  const [hoveredEvent, setHoveredEvent] = useState<EonetEvent | null>(null);

  const externalBbox = useMemo(
    () => bboxFromCenter(facilityLocation as { lat: number; lng: number }, 1.5),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    eonetAdapter
      .fetchEvents({
        bbox: externalBbox,
        days: 7,
        status: 'open',
        categories: ['severeStorms', 'seaLakeIce', 'floods'],
      })
      .then((events) => {
        if (cancelled) return;
        setExternalEvents(events);
      })
      .catch(() => {
        if (cancelled) return;
        setExternalEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [externalBbox]);

  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  const handleTriggerWarning = () => {
    setIsTsunamiWarning(true);
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      setEvacuationProgress(progress);
      if (progress >= 100) clearInterval(interval);
    }, 1000);
  };

  const handleCancelWarning = () => {
    setIsTsunamiWarning(false);
    setEvacuationProgress(0);
  };

  // Simple polygon to represent the ocean/inundation zone
  const inundationZone = [
    { lat: -33.030, lng: -71.630 },
    { lat: -33.060, lng: -71.630 },
    { lat: -33.060, lng: -71.618 },
    { lat: -33.045, lng: -71.615 },
    { lat: -33.030, lng: -71.620 },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Waves className="w-8 h-8 text-blue-500" />
            {t('coastalEmergency.title', 'Emergencia Costera y Tsunami')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('coastalEmergency.subtitle', 'Cálculo de Cotas de Inundación y Evacuación Vertical')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isTsunamiWarning ? (
            <Button
              variant="danger"
              onClick={handleCancelWarning}
              className="animate-pulse"
            >
              {t('coastalEmergency.cancelAlert', 'Cancelar Alerta')}
            </Button>
          ) : (
            <Button variant="danger" onClick={handleTriggerWarning}>
              Simular Alerta Tsunami
            </Button>
          )}
        </div>
      </div>

      {isTsunamiWarning && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-blue-900/40 border border-blue-500/50 flex items-start gap-4"
        >
          <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 animate-pulse">
            <Waves className="w-6 h-6 text-blue-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-blue-400 uppercase tracking-wider">
              Alerta de Tsunami Emitida (SHOA)
            </h2>
            <p className="text-sm text-blue-300/80 mt-1">
              Evacuar inmediatamente a cota 30 (Zona Segura). Tiempo estimado de
              arribo: 15 minutos.
            </p>
            <div className="mt-4">
              <div className="flex justify-between text-xs text-blue-300 mb-1">
                <span>Progreso de Evacuación</span>
                <span>{evacuationProgress}%</span>
              </div>
              <div className="w-full h-2 bg-blue-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
                  style={{ width: `${evacuationProgress}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Info & Status */}
        <div className="space-y-6">
          <Card className="p-6 border-white/5 space-y-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Map className="w-4 h-4 text-zinc-400" />
              Datos de la Instalación
            </h3>

            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                  Cota Actual (Nivel del Mar)
                </p>
                <p className="text-2xl font-black text-white">12 m.s.n.m.</p>
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Zona de Riesgo de
                  Inundación
                </p>
              </div>

              <div className="p-3 rounded-lg bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                  Distancia a Zona Segura (Cota 30)
                </p>
                <p className="text-2xl font-black text-blue-400">850 m</p>
                <p className="text-xs text-zinc-400 mt-1">
                  Tiempo est. a pie: 12 min
                </p>
              </div>

              <div className="p-3 rounded-lg bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                  Personal en Zona de Riesgo
                </p>
                <div className="flex items-center justify-between">
                  <p className="text-2xl font-black text-white">42</p>
                  <Users className="w-5 h-5 text-zinc-500" />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6 border-white/5 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-zinc-400" />
              Puntos de Encuentro (PEE)
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-blue-900/20 border border-blue-500/30">
                <div>
                  <span className="text-sm font-bold text-blue-400 block">
                    PEE-01 (Cerro La Cruz)
                  </span>
                  <span className="text-xs text-blue-300/70">
                    Cota 45 - Capacidad: 200 pers.
                  </span>
                </div>
                <ArrowUpRight className="w-5 h-5 text-blue-500" />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-white/5">
                <div>
                  <span className="text-sm font-bold text-zinc-300 block">
                    PEE-02 (Estadio Municipal)
                  </span>
                  <span className="text-xs text-zinc-500">
                    Cota 35 - Capacidad: 500 pers.
                  </span>
                </div>
                <ArrowUpRight className="w-5 h-5 text-zinc-600" />
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Map */}
        <Card className="p-6 border-white/5 lg:col-span-2 min-h-[500px] flex flex-col">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="text-lg font-bold text-white">
              Mapa de Evacuación y Cotas
            </h3>
            <button
              type="button"
              onClick={() => setExternalLayerOn((v) => !v)}
              aria-pressed={externalLayerOn}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border transition-colors ${
                externalLayerOn
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                  : 'bg-zinc-900 border-white/5 text-zinc-400'
              }`}
            >
              <Layers className="w-4 h-4" aria-hidden="true" />
              Eventos en zona ({externalEvents.length})
            </button>
          </div>
          {hoveredEvent && (
            <div className="mb-3 p-3 rounded-xl bg-zinc-900 border border-white/5 text-xs text-zinc-300">
              <span className="mr-2" aria-hidden="true">
                {eonetCategoryGlyph(hoveredEvent.categories[0]?.id ?? 'manmade')}
              </span>
              <span className="font-bold">{hoveredEvent.title}</span>
              <p className="mt-1 text-[11px] text-zinc-400">
                {buildCalmRecommendation(hoveredEvent).body}
              </p>
            </div>
          )}
          <div className="flex-1 bg-zinc-900 rounded-xl border border-white/5 relative overflow-hidden flex items-center justify-center">
            {!isLoaded ? (
              <div className="flex flex-col items-center justify-center text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin mb-2" />
                <p className="text-sm font-bold uppercase tracking-widest">Cargando Mapa...</p>
              </div>
            ) : (
              <GoogleMap
                mapContainerStyle={containerStyle}
                center={facilityLocation}
                zoom={14}
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
                {/* Inundation Zone (Polygon) */}
                <Polygon
                  paths={inundationZone}
                  options={{
                    fillColor: "#3b82f6",
                    fillOpacity: 0.2,
                    strokeColor: "#3b82f6",
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                  }}
                />

                {/* Facility Marker */}
                <Marker 
                  position={facilityLocation} 
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: "#ef4444",
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: "#ffffff"
                  }}
                />

                {/* Safe Zone Marker */}
                <Marker 
                  position={safeZoneLocation} 
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 10,
                    fillColor: "#10b981",
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: "#ffffff"
                  }}
                />

                {/* Sprint 39 J4b — EONET maritime markers (calm tone). */}
                {externalLayerOn && externalEvents.map((ev) => {
                  const geom = ev.geometry[0];
                  const coords = Array.isArray(geom?.coordinates)
                    ? (geom!.coordinates as number[])
                    : null;
                  if (!coords || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') {
                    return null;
                  }
                  const position = { lat: coords[1] as number, lng: coords[0] as number };
                  return (
                    <Marker
                      key={ev.id}
                      position={position}
                      title={`${ev.title} — ${buildCalmRecommendation(ev).body}`}
                      onMouseOver={() => setHoveredEvent(ev)}
                      onMouseOut={() => setHoveredEvent(null)}
                      icon={{
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 7,
                        fillColor: '#f59e0b',
                        fillOpacity: 0.9,
                        strokeWeight: 2,
                        strokeColor: '#ffffff',
                      }}
                    />
                  );
                })}

                {/* Evacuation Route */}
                {isTsunamiWarning && (
                  <Polyline
                    path={[facilityLocation, safeZoneLocation]}
                    options={{
                      strokeColor: "#10b981",
                      strokeOpacity: 0.8,
                      strokeWeight: 4,
                      icons: [{
                        icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW },
                        offset: '100%'
                      }]
                    }}
                  />
                )}
              </GoogleMap>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
