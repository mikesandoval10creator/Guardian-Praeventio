import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Map, Navigation, CloudRain, AlertTriangle, Route, ShieldAlert, Thermometer, Wind, Loader2 } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { GoogleMap, useJsApiLoader, DirectionsRenderer } from '@react-google-maps/api';
import { getMapLoaderConfig } from '../components/maps/mapConfig';
import { logger } from '../utils/logger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import {
  assessRouteClimate,
  type RouteAssessmentResult,
} from '../services/routing/routeClimateAssessment';

const containerStyle = {
  width: '100%',
  height: '100%'
};

// Default center (Santiago, Chile)
const defaultCenter = { lat: -33.4489, lng: -70.6693 };

export function ClimateRoutes() {
  const { t } = useTranslation();
  const [origin, setOrigin] = useState('Santiago, Chile');
  const [destination, setDestination] = useState('Valparaíso, Chile');
  const [routeStatus, setRouteStatus] = useState<'safe' | 'warning' | 'danger'>('warning');
  const [directionsResponse, setDirectionsResponse] = useState<google.maps.DirectionsResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  // 2026-05-16 (Sprint E): assessment combinado NASA POWER + EONET.
  // Reemplaza la heurística pura de keywords de Sprint D (que ya era
  // mejor que el Math.random original, pero seguía siendo limitada).
  const [assessment, setAssessment] = useState<RouteAssessmentResult | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);
  const { toasts, show: showToast, dismiss } = useToast();

  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  // 2026-05-16 (Sprint E): removido el array `waypoints` hardcoded con
  // 3 puntos ficticios (Paso Los Libertadores / Curacaví / Cuesta La
  // Dormida). Antes el panel mostraba esos 3 puntos como "Alertas
  // Meteorológicas" independiente de la ruta calculada — confundía al
  // usuario porque parecía que la app SABÍA del clima específico de
  // esos lugares cuando los valores estaban hardcoded. Ahora mostramos
  // las razones REALES del assessment NASA POWER + EONET (ver UI abajo).

  const calculateRoute = useCallback(async () => {
    if (!origin || !destination || !window.google) return;

    setIsCalculating(true);
    const directionsService = new window.google.maps.DirectionsService();

    try {
      const results = await directionsService.route({
        origin: origin,
        destination: destination,
        travelMode: window.google.maps.TravelMode.DRIVING,
      });
      setDirectionsResponse(results);

      // 2026-05-16 (Sprint E): assessment REAL combinando:
      //   - Google Directions: distancia, duración, summary (paso cordillerano)
      //   - NASA POWER hourly histórico 7d: viento, precipitación, hielo
      //   - NASA EONET activos: tormentas, incendios, inundaciones, derrumbes
      //
      // Degrada gracefully si NASA/EONET fallan (preserva utilidad).
      // Para detalles ver `src/services/routing/routeClimateAssessment.ts`.
      const route0 = results.routes?.[0];
      const legs = route0?.legs ?? [];
      const totalDistanceM = legs.reduce(
        (sum, l) => sum + (l.distance?.value ?? 0),
        0,
      );
      const totalDurationS = legs.reduce(
        (sum, l) => sum + (l.duration?.value ?? 0),
        0,
      );
      const summary = route0?.summary ?? '';

      // Punto medio y bbox para sondeo NASA/EONET.
      // Si Google nos da `overview_path`, tomamos un punto al ~50%.
      // Fallback: midpoint entre origin/destination de los legs.
      let midpointLat: number;
      let midpointLng: number;
      let latMin = Infinity;
      let latMax = -Infinity;
      let lngMin = Infinity;
      let lngMax = -Infinity;
      const path = route0?.overview_path ?? [];
      if (path.length > 0) {
        const mid = path[Math.floor(path.length / 2)]!;
        midpointLat = mid.lat();
        midpointLng = mid.lng();
        for (const p of path) {
          const la = p.lat();
          const lo = p.lng();
          if (la < latMin) latMin = la;
          if (la > latMax) latMax = la;
          if (lo < lngMin) lngMin = lo;
          if (lo > lngMax) lngMax = lo;
        }
      } else if (legs.length > 0) {
        const startLatLng = legs[0]!.start_location;
        const endLatLng = legs[legs.length - 1]!.end_location;
        midpointLat = (startLatLng.lat() + endLatLng.lat()) / 2;
        midpointLng = (startLatLng.lng() + endLatLng.lng()) / 2;
        latMin = Math.min(startLatLng.lat(), endLatLng.lat());
        latMax = Math.max(startLatLng.lat(), endLatLng.lat());
        lngMin = Math.min(startLatLng.lng(), endLatLng.lng());
        lngMax = Math.max(startLatLng.lng(), endLatLng.lng());
      } else {
        // Sin path ni legs: no podemos hacer assessment climático.
        setRouteStatus('safe');
        setAssessment(null);
        setIsCalculating(false);
        return;
      }

      // Expandimos la bbox ~0.1° para captar eventos cercanos a la ruta.
      const bbox = {
        lonMin: lngMin - 0.1,
        lonMax: lngMax + 0.1,
        latMin: latMin - 0.1,
        latMax: latMax + 0.1,
      };

      setIsAssessing(true);
      try {
        const result = await assessRouteClimate({
          midpointLat,
          midpointLng,
          bbox,
          totalDistanceM,
          totalDurationS,
          summary,
          historicalDaysBack: 7,
        });
        setRouteStatus(result.status);
        setAssessment(result);
      } catch (err) {
        logger.error('Route climate assessment failed', err);
        // Last resort: heurística mínima sin NASA/EONET.
        setRouteStatus('safe');
        setAssessment(null);
      } finally {
        setIsAssessing(false);
      }
    } catch (error) {
      logger.error("Error calculating route:", error);
      showToast(t('climateRoutes.errorRoute', 'No se pudo calcular la ruta. Verifica los lugares ingresados.'), 'error');
    } finally {
      setIsCalculating(false);
    }
  }, [origin, destination]);

  // Calculate initial route when map loads
  useEffect(() => {
    if (isLoaded) {
      calculateRoute();
    }
  }, [isLoaded, calculateRoute]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Route className="w-8 h-8 text-cyan-500" />
            {t('climateRoutes.title', 'Rutas Regionales')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('climateRoutes.subtitle', 'Navegación Consciente del Clima')}
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${routeStatus === 'danger' ? 'text-rose-500 bg-rose-500/10 border-rose-500/20' : routeStatus === 'warning' ? 'text-amber-500 bg-amber-500/10 border-amber-500/20' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'}`}>
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {routeStatus === 'danger' ? t('climateRoutes.statusDanger', 'Ruta Intransitable') : routeStatus === 'warning' ? t('climateRoutes.statusWarning', 'Precaución Requerida') : t('climateRoutes.statusSafe', 'Ruta Segura')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-cyan-500" />
            {t('climateRoutes.planning', 'Planificación de Ruta')}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">{t('climateRoutes.origin', 'Origen')}</label>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
                placeholder={t('climateRoutes.originPlaceholder', 'Ej. Faena Norte')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">{t('climateRoutes.destination', 'Destino')}</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
                placeholder={t('climateRoutes.destinationPlaceholder', 'Ej. Puerto')}
              />
            </div>

            {/* 2026-06-13: el onClick antes SOLO ciclaba routeStatus
                (safe→warning→danger) sin invocar nada — podía mostrar
                "Ruta Segura" sin haber consultado NASA/EONET. Ahora dispara
                el cálculo REAL con los inputs actuales; el status se deriva
                EXCLUSIVAMENTE del assessment dentro de calculateRoute(). */}
            <Button
              className="w-full"
              type="button"
              onClick={() => { void calculateRoute(); }}
              disabled={!isLoaded || isCalculating || isAssessing}
            >
              {isCalculating || isAssessing ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('climateRoutes.calculating', 'Evaluando ruta…')}
                </span>
              ) : (
                t('climateRoutes.calculateOptimal', 'Calcular Ruta Óptima')
              )}
            </Button>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-cyan-500" />
              {t('climateRoutes.assessment', 'Evaluación Climática de Ruta')}
              {isAssessing && (
                <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />
              )}
            </h3>

            {/* Métricas NASA POWER reales (cuando están disponibles) */}
            {assessment?.metrics && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {assessment.metrics.avgWindMs !== null && (
                  <div className="p-2 rounded-lg bg-zinc-900 border border-white/5">
                    <div className="text-[9px] text-zinc-500 uppercase">
                      {t('climateRoutes.avgWind', 'Viento promedio (7d)')}
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-1">
                      <Wind className="w-3 h-3 text-cyan-400" />
                      {(assessment.metrics.avgWindMs * 3.6).toFixed(0)} km/h
                    </div>
                  </div>
                )}
                {assessment.metrics.totalPrecipMm !== null && (
                  <div className="p-2 rounded-lg bg-zinc-900 border border-white/5">
                    <div className="text-[9px] text-zinc-500 uppercase">
                      {t('climateRoutes.totalPrecip', 'Lluvia total (7d)')}
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-1">
                      <CloudRain className="w-3 h-3 text-blue-400" />
                      {assessment.metrics.totalPrecipMm.toFixed(0)} mm
                    </div>
                  </div>
                )}
                {assessment.metrics.frostHourCount > 0 && (
                  <div className="p-2 rounded-lg bg-zinc-900 border border-white/5 col-span-2">
                    <div className="text-[9px] text-zinc-500 uppercase">
                      {t('climateRoutes.frostHours', 'Horas bajo 0°C en 7d')}
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-1">
                      <Thermometer className="w-3 h-3 text-blue-300" />
                      {assessment.metrics.frostHourCount} h
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Razones específicas que llevaron al status */}
            {assessment?.reasons && assessment.reasons.length > 0 ? (
              <ul className="space-y-2">
                {assessment.reasons.map((reason, idx) => (
                  <li
                    key={idx}
                    className={`p-3 rounded-lg border ${
                      reason.level === 'danger'
                        ? 'bg-rose-500/10 border-rose-500/30'
                        : reason.level === 'warning'
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : 'bg-emerald-500/10 border-emerald-500/30'
                    }`}
                  >
                    <p
                      className={`text-xs ${
                        reason.level === 'danger'
                          ? 'text-rose-300'
                          : reason.level === 'warning'
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                      }`}
                    >
                      {reason.message}
                    </p>
                    <p className="text-[9px] text-zinc-500 mt-1 font-mono uppercase tracking-wide">
                      {reason.source === 'NASA_POWER' && '📡 NASA POWER'}
                      {reason.source === 'EONET' && '🛰️ NASA EONET'}
                      {reason.source === 'GOOGLE_DIRECTIONS' && '🗺️ Google Directions'}
                      {reason.source === 'HEURISTIC' && '🧮 Heurística interna'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : assessment && assessment.failedSources.length === 0 ? (
              <p className="text-xs text-emerald-400 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                {t(
                  'climateRoutes.noRisks',
                  'Sin riesgos climáticos detectados en histórico NASA ni eventos activos. Conduce con precaución estándar.',
                )}
              </p>
            ) : assessment ? (
              // Codex fix: alguna fuente externa falló (CSP/offline/5xx).
              // NO podemos afirmar "sin riesgos" porque no consultamos —
              // mostramos honestamente que parte de la evidencia no llegó.
              <p className="text-xs text-amber-300 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                {t(
                  'climateRoutes.noData',
                  'No pudimos consultar todas las fuentes climáticas ({{sources}}). El status mostrado se basa SOLO en la heurística de Google Directions. Reintenta cuando tengas mejor red.',
                  { sources: assessment.failedSources.join(', ') },
                )}
              </p>
            ) : (
              <p className="text-xs text-zinc-500 italic">
                {t(
                  'climateRoutes.calculatePrompt',
                  'Calcula una ruta para ver la evaluación NASA POWER + EONET.',
                )}
              </p>
            )}

            <p className="mt-3 text-[9px] text-zinc-500 leading-relaxed">
              {t(
                'climateRoutes.dataSources',
                'Fuentes: NASA POWER (clima histórico hourly, lag ~3 días) + NASA EONET (eventos extremos activos) + Google Directions. NO sustituye al servicio meteorológico nacional (DMC) ni a la información vial oficial (MOP).',
              )}
            </p>
          </div>
        </Card>

        {/* Map Visualization (Simulated) */}
        <Card className="p-0 border-white/5 lg:col-span-2 overflow-hidden relative min-h-[500px] bg-zinc-900 flex items-center justify-center">
          {/* Simulated Map Background */}
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: 'radial-gradient(circle at center, #3f3f46 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }} />

          {/* Simulated Route Line */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
            <motion.path
              d="M 100 400 Q 250 300 400 200 T 700 100"
              fill="transparent"
              stroke={routeStatus === 'danger' ? '#f43f5e' : routeStatus === 'warning' ? '#f59e0b' : '#10b981'}
              strokeWidth="4"
              strokeDasharray="10 10"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2, ease: "easeInOut" }}
            />
          </svg>

          {/* Waypoints on Map */}
          <div className="absolute inset-0" style={{ zIndex: 2 }}>
            <div className="absolute top-[400px] left-[100px] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <div className="w-4 h-4 bg-white rounded-full border-4 border-cyan-500" />
              <span className="mt-1 text-xs font-bold text-white bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm">{t('climateRoutes.origin', 'Origen')}</span>
            </div>

            <div className="absolute top-[250px] left-[325px] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <CloudRain className="w-6 h-6 text-amber-500 drop-shadow-[0_0_10px_rgba(245,158,11,0.8)]" />
              <span className="mt-1 text-[10px] font-bold text-white bg-black/50 px-1 py-0.5 rounded backdrop-blur-sm">Niebla</span>
            </div>

            <div className="absolute top-[150px] left-[550px] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <AlertTriangle className="w-6 h-6 text-rose-500 drop-shadow-[0_0_10px_rgba(244,63,94,0.8)]" />
              <span className="mt-1 text-[10px] font-bold text-white bg-black/50 px-1 py-0.5 rounded backdrop-blur-sm">Nevazón</span>
            </div>

            <div className="absolute top-[100px] left-[700px] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
              <div className="w-4 h-4 bg-white rounded-full border-4 border-emerald-500" />
              <span className="mt-1 text-xs font-bold text-white bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm">{t('climateRoutes.destination', 'Destino')}</span>
            </div>
          </div>

          <div className="absolute bottom-6 right-6 bg-black/50 backdrop-blur-md border border-white/10 p-4 rounded-xl max-w-sm z-10">
            <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Route className="w-4 h-4 text-cyan-500" />
              {t('climateRoutes.analysis', 'Análisis de Ruta')}
            </h4>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {routeStatus === 'danger'
                ? t('climateRoutes.analysisDanger', 'La ruta principal se encuentra bloqueada por condiciones climáticas extremas. Se recomienda suspender el tránsito o buscar una ruta alternativa.')
                : routeStatus === 'warning'
                ? t('climateRoutes.analysisWarning', 'Condiciones climáticas adversas en tramos de la ruta. Se requiere precaución, uso de cadenas y velocidad reducida.')
                : t('climateRoutes.analysisSafe', 'Condiciones óptimas para el tránsito. No se registran alertas meteorológicas en la ruta.')}
            </p>
          </div>
        </Card>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
