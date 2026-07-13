import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Wind, AlertTriangle, MapPin, Navigation, Info, Droplet, Loader2 } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { GoogleMap, useJsApiLoader, Marker, Circle, Polygon } from '@react-google-maps/api';
import { getMapLoaderConfig } from '../components/maps/mapConfig';
import { useTranslation } from 'react-i18next';
import {
  computeExposureDistances,
  estimatePlumeConeDegrees,
  periodFromDate,
  type HazmatClass,
} from '../services/hazmat/hazmatExposureCalculator';
import * as environmentBackend from '../services/environmentBackend.client';

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

export function HazmatMap() {
  const { t } = useTranslation();
  const [incidentLocation, setIncidentLocation] = useState({ lat: -33.4489, lng: -70.6693, name: 'Planta Química' });
  // ── Real-wind seeding (2026-05-17) ─────────────────────────────────
  // Antes: windDirection=120° y windSpeed=15 km/h hardcoded "para
  // visualización". Una pluma tóxica calculada con viento ficticio
  // puede orientar la zona de evacuación hacia la dirección opuesta al
  // viento real — directamente peligroso. Ahora consultamos
  // `environmentBackend.getCurrentWeather` (OpenWeather /weather) en
  // mount y cuando cambia la ubicación del incidente. Mantenemos los
  // setters como override manual: el usuario puede pasar a "modo
  // simulación" para hipotetizar otros escenarios. Si el fetch falla,
  // degradamos a los defaults y mostramos una nota visible.
  const [windDirection, setWindDirection] = useState(120); // Degrees (direction wind is blowing towards)
  const [windSpeed, setWindSpeed] = useState(15); // km/h
  const [useRealWind, setUseRealWind] = useState(true);
  const [windUnavailable, setWindUnavailable] = useState(false);
  const [loadingWind, setLoadingWind] = useState(false);
  // 2026-05-15 (Sprint C): antes este UI usaba dos toggles ('gas'/'liquid' y
  // 'small'/'large') y hardcoded los radios (30/60 isolation, 100/300
  // protection) sin referenciar fuente. Ahora aceptamos hazmatClass NU
  // (Class 2.1, 2.3, 3, 8, etc.) y delegamos al calculador GRE 2024.
  const [hazmatClass, setHazmatClass] = useState<HazmatClass>('class_2_3');
  const [spillSize, setSpillSize] = useState<'small' | 'large'>('large');

  // Fetch real wind on mount + whenever the incident location changes (or the
  // user toggles back into "viento real"). If we're in simulation mode the
  // effect short-circuits so the user's manual values stick.
  useEffect(() => {
    if (!useRealWind) return;
    let cancelled = false;
    setLoadingWind(true);
    environmentBackend
      .getCurrentWeather({ lat: incidentLocation.lat, lng: incidentLocation.lng })
      .then((wx) => {
        if (cancelled) return;
        if (wx.unavailable) {
          setWindUnavailable(true);
          // Leave windSpeed/windDirection at their last value — they default
          // to 15/120 if the user never touched the sliders.
          return;
        }
        setWindUnavailable(false);
        setWindDirection(wx.windDirectionDeg);
        setWindSpeed(Math.round(wx.windSpeedKmh));
      })
      .finally(() => {
        if (!cancelled) setLoadingWind(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentLocation.lat, incidentLocation.lng, useRealWind]);

  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  // Distancias reales según GRE 2024 Green Pages. Día/noche se decide
  // por hora local — la noche dispara la zona de acción protectiva por
  // inversión térmica.
  const period = useMemo(() => periodFromDate(), []);
  const exposure = useMemo(
    () => computeExposureDistances(hazmatClass, spillSize, period),
    [hazmatClass, spillSize, period],
  );
  const protectionDistanceNight = useMemo(
    () => computeExposureDistances(hazmatClass, spillSize, 'night').protectiveActionDistanceM,
    [hazmatClass, spillSize],
  );
  const isolationDistance = exposure.initialIsolationRadiusM;
  const protectionDistance = exposure.protectiveActionDistanceM;

  // Calculate plume polygon (cone shape) — ancho depende del viento real
  // (estabilidad atmosférica Pasquill aproximada). 45° era arbitrario y
  // hacía la pluma idéntica con viento de 5 km/h o 50 km/h.
  const plumePaths = useMemo(() => {
    const spreadAngle = estimatePlumeConeDegrees(windSpeed);
    const points: { lat: number; lng: number }[] = [{ lat: incidentLocation.lat, lng: incidentLocation.lng }];

    for (let angle = windDirection - spreadAngle / 2; angle <= windDirection + spreadAngle / 2; angle += 5) {
      points.push(getDestinationPoint(incidentLocation.lat, incidentLocation.lng, protectionDistance, angle));
    }

    return points;
  }, [incidentLocation, windDirection, windSpeed, protectionDistance]);

  // Color de la pluma — gas tóxico/inflamable vs. corrosivo/líquido.
  const plumeColor =
    hazmatClass === 'class_2_1' || hazmatClass === 'class_2_3' || hazmatClass === 'class_2_2'
      ? '#8b5cf6'
      : hazmatClass === 'class_8'
        ? '#f59e0b'
        : '#10b981';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Droplet className="w-8 h-8 text-violet-500" />
            {t('hazmat.title', 'Mapeo Hazmat')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('hazmat.subtitle', 'Radio de Exposición y Evacuación GRE')}
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border text-violet-500 bg-violet-500/10 border-violet-500/20 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {t('hazmat.status.active', 'Protocolo Activo')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-default-token space-y-6">
          <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            {t('hazmat.params.title', 'Parámetros del Incidente')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-token mb-2">
                {t('hazmat.params.class', 'Clase NU (UN Class)')}
              </label>
              <select
                value={hazmatClass}
                onChange={(e) => setHazmatClass(e.target.value as HazmatClass)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-default-token text-primary-token text-sm focus:outline-none focus:border-violet-500"
              >
                <option value="class_1">Clase 1 — Explosivos</option>
                <option value="class_2_1">Clase 2.1 — Gas Inflamable</option>
                <option value="class_2_2">Clase 2.2 — Gas No-Inflamable</option>
                <option value="class_2_3">Clase 2.3 — Gas Tóxico (TIH)</option>
                <option value="class_3">Clase 3 — Líquido Inflamable</option>
                <option value="class_4">Clase 4 — Sólido Inflamable</option>
                <option value="class_5">Clase 5 — Oxidante/Peróxido</option>
                <option value="class_6_1">Clase 6.1 — Tóxico</option>
                <option value="class_6_2">Clase 6.2 — Infeccioso</option>
                <option value="class_7">Clase 7 — Radioactivo</option>
                <option value="class_8">Clase 8 — Corrosivo</option>
                <option value="class_9">Clase 9 — Misceláneos</option>
                <option value="unknown">Desconocido (fallback conservador)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-token mb-2">Tamaño del Derrame</label>
              <div className="flex gap-2">
                <button onClick={() => setSpillSize('small')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${spillSize === 'small' ? 'bg-amber-500/20 text-amber-400 border-amber-500/50' : 'bg-surface border-default-token text-muted-token'}`}>Pequeño</button>
                <button onClick={() => setSpillSize('large')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${spillSize === 'large' ? 'bg-rose-500/20 text-rose-400 border-rose-500/50' : 'bg-surface border-default-token text-muted-token'}`}>Grande</button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-muted-token">Modo Viento</label>
                <button
                  type="button"
                  onClick={() => setUseRealWind((v) => !v)}
                  aria-pressed={useRealWind}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                    useRealWind
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                      : 'bg-surface text-muted-token border-default-token'
                  }`}
                  data-testid="hazmat-wind-mode-toggle"
                >
                  {useRealWind ? '🌐 Viento real' : '✋ Modo simulación'}
                </button>
              </div>
              {useRealWind && windUnavailable && (
                <p className="text-[10px] text-amber-400 mb-2" role="status">
                  Viento no disponible — usando valores manuales.
                </p>
              )}
              {useRealWind && loadingWind && (
                <p className="text-[10px] text-muted-token mb-2" role="status">
                  Consultando viento real…
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-token mb-2">Dirección del Viento (Grados)</label>
              <input
                type="range"
                min="0"
                max="360"
                value={windDirection}
                onChange={(e) => setWindDirection(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-muted-token mt-1">
                <span>N (0°)</span>
                <span className="font-bold text-blue-400">{windDirection}°</span>
                <span>N (360°)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted-token mb-2">Velocidad del Viento (km/h)</label>
              <input
                type="range"
                min="0"
                max="100"
                value={windSpeed}
                onChange={(e) => setWindSpeed(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-muted-token mt-1">
                <span>0 km/h</span>
                <span className="font-bold text-blue-400">{windSpeed} km/h</span>
                <span>100 km/h</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-default-token">
            <h3 className="text-sm font-bold text-primary-token mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-violet-500" />
              {t('hazmat.distances.title', 'Distancias GRE 2024')}
            </h3>
            <ul className="space-y-2 text-sm text-muted-token">
              <li className="flex items-center justify-between">
                <span>{t('hazmat.distances.isolation', 'Aislamiento Inicial:')}</span>
                <span className="font-bold text-rose-400">{isolationDistance} m</span>
              </li>
              <li className="flex items-center justify-between">
                <span>{t('hazmat.distances.protectionDay', 'Acción Protectora (Día):')}</span>
                <span className="font-bold text-orange-400">{protectionDistance} m</span>
              </li>
              <li className="flex items-center justify-between">
                <span>{t('hazmat.distances.protectionNight', 'Acción Protectora (Noche):')}</span>
                <span className="font-bold text-orange-400">{protectionDistanceNight} m</span>
              </li>
            </ul>
            <p className="mt-3 text-[10px] text-muted-token leading-relaxed">
              <span className="font-bold text-secondary-token">{exposure.reference}</span>
              {' — '}
              {t('hazmat.disclaimerShort', 'Aproximación según GRE Green Pages. Consulta el GRE físico y al protocolo de emergencia local para respuesta operativa.')}
            </p>
          </div>
        </Card>

        {/* Map Visualization */}
        <Card className="p-0 border-default-token lg:col-span-2 overflow-hidden relative min-h-[500px] bg-surface flex items-center justify-center">
          {!isLoaded ? (
            <div className="flex flex-col items-center justify-center text-muted-token">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-sm font-bold uppercase tracking-widest">Cargando Mapa...</p>
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={containerStyle}
              center={incidentLocation}
              zoom={16}
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
              {/* Incident Marker */}
              <Marker 
                position={incidentLocation} 
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: "#ef4444",
                  fillOpacity: 1,
                  strokeWeight: 2,
                  strokeColor: "#ffffff"
                }}
              />

              {/* Isolation Zone (Circle) */}
              <Circle
                center={incidentLocation}
                radius={isolationDistance}
                options={{
                  fillColor: "#ef4444",
                  fillOpacity: 0.2,
                  strokeColor: "#ef4444",
                  strokeOpacity: 0.8,
                  strokeWeight: 2,
                }}
              />

              {/* Toxic Plume (Polygon) */}
              <Polygon
                paths={plumePaths}
                options={{
                  fillColor: plumeColor,
                  fillOpacity: 0.4,
                  strokeColor: plumeColor,
                  strokeOpacity: 0.8,
                  strokeWeight: 2,
                }}
              />
            </GoogleMap>
          )}

          {/* Wind Indicator Overlay */}
          <div className="absolute bottom-6 left-6 bg-black/70 backdrop-blur-md border border-default-token p-3 rounded-xl flex items-center gap-3 z-10">
            <div 
              className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center transition-transform duration-500"
              style={{ transform: `rotate(${windDirection}deg)` }}
            >
              <Wind className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-primary-token">Viento</p>
              <p className="text-[10px] text-blue-400">{windSpeed} km/h a {windDirection}°</p>
            </div>
          </div>

          <div className="absolute top-6 right-6 bg-black/70 backdrop-blur-md border border-default-token p-3 rounded-xl max-w-xs z-10">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-muted-token shrink-0 mt-0.5" />
              <p className="text-xs text-secondary-token">
                {t(
                  'hazmat.mapInfo',
                  'Basado en GRE 2024 Green Pages (Initial Isolation + Protective Action Distances). El polígono muestra la zona de acción protectora a favor del viento; ancho calculado por estabilidad atmosférica (Pasquill) según velocidad de viento.',
                )}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
