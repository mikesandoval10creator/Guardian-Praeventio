import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cloud, Droplets, Wind, Thermometer, Sun, MapPin,
  AlertTriangle, Activity, RefreshCw, Mountain,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useSeismicMonitor } from '../hooks/useSeismicMonitor';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenMeteoCurrentUnits {
  temperature_2m: string;
  relative_humidity_2m: string;
  precipitation: string;
  wind_speed_10m: string;
  uv_index: string;
}

interface OpenMeteoCurrentWeather {
  temperature_2m: number;
  relative_humidity_2m: number;
  precipitation: number;
  wind_speed_10m: number;
  uv_index: number;
}

interface OpenMeteoResponse {
  current_units: OpenMeteoCurrentUnits;
  current: OpenMeteoCurrentWeather;
}

interface WeatherState {
  tempC: number;
  humidity: number;
  precipMm: number;
  windKph: number;
  uvIndex: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPEN_METEO_URL =
  'https://api.open-meteo.com/v1/forecast' +
  '?latitude=-33.45&longitude=-70.67' +
  '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,uv_index' +
  '&timezone=America%2FSantiago';

const REFRESH_MS = 600_000; // 10 minutes

// ---------------------------------------------------------------------------
// UV helpers
// ---------------------------------------------------------------------------

interface UvMeta {
  label: string;
  /** Tailwind text colour classes (light + dark) */
  textClass: string;
  /** Tailwind bg badge classes */
  badgeClass: string;
}

function getUvMeta(uv: number): UvMeta {
  if (uv > 10) return { label: 'Extremo', textClass: 'text-violet-600 dark:text-violet-400', badgeClass: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' };
  if (uv >= 8)  return { label: 'Muy alto', textClass: 'text-red-600 dark:text-red-400',    badgeClass: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' };
  if (uv >= 6)  return { label: 'Alto',     textClass: 'text-orange-500 dark:text-orange-400', badgeClass: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' };
  if (uv >= 3)  return { label: 'Moderado', textClass: 'text-yellow-600 dark:text-yellow-400', badgeClass: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' };
  return         { label: 'Bajo',      textClass: 'text-green-600 dark:text-green-400',  badgeClass: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' };
}

// ---------------------------------------------------------------------------
// Altitude O2 classification
// ---------------------------------------------------------------------------

interface AltitudeTier {
  label: string;
  o2Label: string;
  /** True when acclimation is mandatory */
  mandatory: boolean;
  badgeClass: string;
}

function getAltitudeTier(altM: number): AltitudeTier {
  if (altM > 2400) return {
    label: '> 2.400 m',
    o2Label: '-25 % O₂ — Aclimatación obligatoria',
    mandatory: true,
    badgeClass: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  };
  if (altM > 1500) return {
    label: '1.500–2.400 m',
    o2Label: '-15 % O₂',
    mandatory: false,
    badgeClass: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  };
  if (altM > 500) return {
    label: '500–1.500 m',
    o2Label: '-5 % O₂',
    mandatory: false,
    badgeClass: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  };
  return {
    label: '0–500 m',
    o2Label: 'Normal',
    mandatory: false,
    badgeClass: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  };
}

// ---------------------------------------------------------------------------
// Skeleton shimmer
// ---------------------------------------------------------------------------

function SkeletonRow({ wide = false }: { wide?: boolean }) {
  return (
    <div
      className={`h-4 rounded-md bg-zinc-200 dark:bg-zinc-700 animate-pulse ${wide ? 'w-3/4' : 'w-1/2'}`}
      aria-hidden="true"
    />
  );
}

function BulletinSkeleton() {
  return (
    <div className="rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 animate-pulse" aria-hidden="true" />
        <SkeletonRow wide />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric row
// ---------------------------------------------------------------------------

interface MetricRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}

function MetricRow({ icon, label, value, accent = false }: MetricRowProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`shrink-0 ${accent ? 'text-[#4db6ac] dark:text-[#d4af37]' : 'text-zinc-500 dark:text-zinc-400'}`}>
        {icon}
      </span>
      <span className="text-zinc-600 dark:text-zinc-400 truncate">{label}</span>
      <span className="ml-auto font-semibold text-zinc-800 dark:text-zinc-100 tabular-nums whitespace-nowrap">
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WeatherBulletinProps {
  altitudeM?: number;
  compact?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeatherBulletin({
  altitudeM = 0,
  compact = false,
  className = '',
}: WeatherBulletinProps) {
  const { isDayTime } = useTheme();
  const { earthquakes, criticalAlert } = useSeismicMonitor();

  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch(OPEN_METEO_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OpenMeteoResponse = await res.json() as OpenMeteoResponse;
      const c = json.current;
      setWeather({
        tempC: c.temperature_2m,
        humidity: c.relative_humidity_2m,
        precipMm: c.precipitation,
        windKph: c.wind_speed_10m,
        uvIndex: c.uv_index,
      });
      setFetchError(false);
      setLastUpdated(new Date());
    } catch (err) {
      logger.error('WeatherBulletin: Open-Meteo fetch failed', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(fetchWeather, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchWeather]);

  // Seismic derived state
  const latestQuake = earthquakes[0] ?? null;
  const seismicOk = !criticalAlert;

  // Altitude
  const altTier = getAltitudeTier(altitudeM);

  // UV
  const uvMeta = weather ? getUvMeta(weather.uvIndex) : null;

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (loading) return <BulletinSkeleton />;

  // ---------------------------------------------------------------------------
  // Error fallback (still show seismic + altitude even without weather)
  // ---------------------------------------------------------------------------

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7 }}
      aria-label="Boletín Climático y Sísmico"
      className={`relative overflow-hidden rounded-2xl border border-zinc-200/50 dark:border-white/5 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-zinc-100/80 dark:border-white/5">
        <div className="flex items-center gap-2">
          {isDayTime
            ? <Sun className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" aria-hidden="true" />
            : <Cloud className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" aria-hidden="true" />
          }
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Boletín Climático
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <MapPin className="w-3 h-3" aria-hidden="true" />
            Santiago, Chile
          </span>
          <button
            onClick={fetchWeather}
            aria-label="Actualizar datos climáticos"
            className="p-1 rounded-md text-zinc-400 hover:text-[#4db6ac] dark:hover:text-[#d4af37] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {fetchError && !weather && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
            No se pudo obtener datos meteorológicos. Reintentando en {REFRESH_MS / 60_000} min.
          </p>
        )}

        <div className={`grid gap-x-6 gap-y-1 ${compact ? '' : 'grid-cols-2'}`}>
          {/* ---- Left column: weather metrics ---- */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-wide mb-2">
              Condiciones actuales
            </p>

            {weather ? (
              <>
                <MetricRow
                  icon={<Thermometer className="w-4 h-4" />}
                  label="Temperatura"
                  value={`${weather.tempC.toFixed(1)} °C`}
                  accent
                />
                <MetricRow
                  icon={<Droplets className="w-4 h-4" />}
                  label="Humedad"
                  value={`${weather.humidity} %`}
                />
                <MetricRow
                  icon={<Wind className="w-4 h-4" />}
                  label="Viento"
                  value={`${weather.windKph.toFixed(1)} km/h`}
                />
                {!compact && (
                  <MetricRow
                    icon={<Cloud className="w-4 h-4" />}
                    label="Precipitación"
                    value={`${weather.precipMm.toFixed(1)} mm`}
                  />
                )}

                {/* UV badge */}
                <div className="flex items-center gap-2 text-sm pt-0.5">
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                    <Sun className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">UV</span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={uvMeta?.label}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold ${uvMeta?.badgeClass ?? ''}`}
                      aria-label={`Índice UV ${weather.uvIndex.toFixed(1)} — ${uvMeta?.label}`}
                    >
                      {weather.uvIndex.toFixed(1)} — {uvMeta?.label}
                    </motion.span>
                  </AnimatePresence>
                </div>

                {/* AQI placeholder */}
                {!compact && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                      <Activity className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">Calidad del aire</span>
                    <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500 italic">
                      Sin datos AQI
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">Sin datos meteorológicos</p>
            )}
          </div>

          {/* ---- Right column: seismic + altitude ---- */}
          {!compact && (
            <div className="space-y-1.5">
              {/* Seismic */}
              <p className="text-xs font-medium text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-wide mb-2">
                Actividad sísmica
              </p>

              <AnimatePresence mode="wait">
                {seismicOk ? (
                  <motion.div
                    key="ok"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="flex items-center gap-2"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
                    <span className="text-sm text-green-600 dark:text-green-400 font-medium">Sin actividad</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="alert"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    role="alert"
                    aria-live="assertive"
                    className="space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${criticalAlert && criticalAlert.magnitude >= 6 ? 'bg-red-500' : 'bg-amber-500'}`}
                        aria-hidden="true"
                      />
                      <span className={`text-sm font-semibold ${criticalAlert && criticalAlert.magnitude >= 6 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        M {criticalAlert?.magnitude.toFixed(1)} — {criticalAlert?.place}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 pl-4">
                      {criticalAlert ? new Date(criticalAlert.time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Latest quake (informational, below critical) */}
              {latestQuake && seismicOk && (
                <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  Último: M {latestQuake.magnitude.toFixed(1)} — {latestQuake.place}
                </div>
              )}

              {/* Altitude */}
              <div className="pt-3 border-t border-zinc-100/80 dark:border-white/5 mt-2">
                <p className="text-xs font-medium text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-wide mb-2">
                  Altitud y oxígeno
                </p>
                <div className="flex items-start gap-2">
                  <Mountain className="w-4 h-4 shrink-0 text-zinc-500 dark:text-zinc-400 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${altTier.badgeClass}`}>
                      {altTier.o2Label}
                    </span>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{altTier.label}</p>
                    {altTier.mandatory && (
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                        Aclimatación obligatoria (DS 594)
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Compact mode: seismic + altitude summary row */}
        {compact && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-100/80 dark:border-white/5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${seismicOk ? 'bg-green-500' : criticalAlert && criticalAlert.magnitude >= 6 ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {seismicOk ? 'Sin actividad sísmica' : `M ${criticalAlert?.magnitude.toFixed(1)}`}
            </span>
            <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-semibold ${altTier.badgeClass}`}>
              {altTier.o2Label}
            </span>
          </div>
        )}

        {/* Footer: last updated */}
        {lastUpdated && (
          <p className="text-right text-xs text-zinc-400 dark:text-zinc-600 mt-2 pt-1">
            Actualizado: {lastUpdated.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </motion.section>
  );
}
