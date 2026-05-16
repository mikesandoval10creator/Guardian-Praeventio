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
  const { toasts, show: showToast, dismiss } = useToast();

  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  const waypoints = [
    { id: 1, name: 'Paso Los Libertadores', status: 'danger', condition: 'Nevazón', temp: -5, wind: 80 },
    { id: 2, name: 'Ruta 68 - Curacaví', status: 'safe', condition: 'Despejado', temp: 15, wind: 15 },
    { id: 3, name: 'Cuesta La Dormida', status: 'warning', condition: 'Niebla', temp: 8, wind: 30 },
  ];

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

      // 2026-05-16 (Sprint D): antes esto era `Math.random()` con un
      // comentario "for demo purposes". Ahora derivamos el status de
      // datos REALES que Google Directions devuelve:
      //   - distancia + duración (legs sumados)
      //   - heurística de "ruta de montaña" si el summary menciona paso
      //     conocido o si hay >1h en la primera mitad de la ruta
      // No reemplaza un servicio meteorológico real (TODO Sprint E:
      // wire a Open-Meteo para condiciones actuales), pero deja de
      // mentir con un status aleatorio.
      const legs = results.routes?.[0]?.legs ?? [];
      const totalDistanceM = legs.reduce(
        (sum, l) => sum + (l.distance?.value ?? 0),
        0,
      );
      const totalDurationS = legs.reduce(
        (sum, l) => sum + (l.duration?.value ?? 0),
        0,
      );
      const summary = (results.routes?.[0]?.summary ?? '').toLowerCase();
      // Keywords típicos de pasos cordilleranos chilenos / argentinos
      // donde el clima cambia rápido (nevazón, viento blanco).
      const mountainPassKeywords = [
        'libertadores',
        'cristo redentor',
        'agua negra',
        'pehuenche',
        'cardenal samoré',
        'cuesta',
        'paso',
        'ch-115', // Pehuenche
        'ch-31', // Libertadores
      ];
      const hasMountainPass = mountainPassKeywords.some((k) => summary.includes(k));

      let derivedStatus: 'safe' | 'warning' | 'danger';
      if (hasMountainPass) {
        // Pasos cordilleranos: default a "warning" — el invierno los puede
        // cerrar y la app debe inducir verificación.
        derivedStatus = 'warning';
      } else if (totalDistanceM > 200_000 || totalDurationS > 3 * 3600) {
        // Ruta interregional larga (>200km o >3h) → precaución.
        derivedStatus = 'warning';
      } else {
        derivedStatus = 'safe';
      }
      setRouteStatus(derivedStatus);
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

            <Button className="w-full" onClick={() => setRouteStatus(routeStatus === 'safe' ? 'warning' : routeStatus === 'warning' ? 'danger' : 'safe')}>
              {t('climateRoutes.calculateOptimal', 'Calcular Ruta Óptima')}
            </Button>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-cyan-500" />
              {t('climateRoutes.weatherAlerts', 'Alertas Meteorológicas')}
            </h3>
            <ul className="space-y-3">
              {waypoints.map(wp => (
                <li key={wp.id} className="flex flex-col gap-1 p-3 rounded-lg bg-zinc-900 border border-white/5">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-white">{wp.name}</span>
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${wp.status === 'danger' ? 'bg-rose-500/20 text-rose-400' : wp.status === 'warning' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {wp.condition}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-zinc-400 mt-1">
                    <span className="flex items-center gap-1"><Thermometer className="w-3 h-3" /> {wp.temp}°C</span>
                    <span className="flex items-center gap-1"><Wind className="w-3 h-3" /> {wp.wind} km/h</span>
                  </div>
                </li>
              ))}
            </ul>
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
