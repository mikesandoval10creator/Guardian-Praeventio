// Praeventio Guard — Boletín climático y seguridad.
// Upgraded to rich layout: SunTracker sky panel + NativeCompass + altitude +
// air-quality (colour-coded) + condition-based safety advisories.
// All colours via semantic tokens (no hardcoded hex).

import { Map, Wind, Droplets, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../shared/Skeleton';
import { SunTracker } from '../weather/SunTracker';
import { NativeCompass } from '../weather/NativeCompass';
import { getWeatherAdvice } from '../../services/weather/weatherAdvice';

export interface WeatherSnapshot {
  temp?: number;
  windSpeed?: number;
  condition?: string;
  humidity?: number;
  sunrise?: number;
  sunset?: number;
  location?: string | null;
  uvi?: number;
  /** Real UV index from the orchestrator (the field it actually populates; null = unknown). */
  uv?: number | null;
  aqi?: number;
  /** Real air-quality label from the orchestrator; null/absent → unknown (don't fabricate). */
  airQuality?: string | null;
  /** Honest sentinel: the weather provider (OpenWeather) is not configured/available. */
  unavailable?: boolean;
  /** Altitude above sea level in metres (from geolocation or project data). */
  altitude?: number | null;
  /** Latitude for the SunTracker ephemeris (defaults to Santiago −33.45 if absent). */
  lat?: number | null;
  /** Longitude for the SunTracker ephemeris (defaults to Santiago −70.67 if absent). */
  lng?: number | null;
}

interface WeatherBulletinProps {
  weather: WeatherSnapshot | undefined;
  loading: boolean;
}

// Santiago, Chile altitude (default location)
const SANTIAGO_ALT_MSNM = 567;
const SANTIAGO_LAT = -33.45;
const SANTIAGO_LNG = -70.67;

// Estimate sunrise/sunset in ms for Santiago by current month if not provided
function estimateSunriseSunset(): { sunrise: number; sunset: number } {
  const month = new Date().getMonth(); // 0-11
  // [sunrise HH, sunrise MM, sunset HH, sunset MM] per month (Jan–Dec)
  const table: [number, number, number, number][] = [
    [6, 45, 20, 50], // Jan
    [6, 56, 20, 30], // Feb
    [7, 12, 19, 55], // Mar
    [7, 30, 19, 15], // Apr
    [7, 48, 18, 45], // May
    [8,  2, 18, 28], // Jun
    [7, 57, 18, 40], // Jul
    [7, 32, 19,  5], // Aug
    [6, 57, 19, 28], // Sep
    [6, 20, 19, 50], // Oct
    [6,  0, 20, 15], // Nov
    [6,  2, 20, 45], // Dec
  ];
  const [srH, srM, ssH, ssM] = table[month];
  const today = new Date();
  const sunrise = new Date(today.getFullYear(), today.getMonth(), today.getDate(), srH, srM).getTime();
  const sunset  = new Date(today.getFullYear(), today.getMonth(), today.getDate(), ssH, ssM).getTime();
  return { sunrise, sunset };
}

// Rough UV estimate from condition string + time of day
function estimateUVI(condition: string | undefined, now: number, sunrise: number, sunset: number): number {
  const cond = (condition || '').toLowerCase();
  if (cond.includes('lluvia') || cond.includes('tormenta')) return 0;
  const dayFraction = (now - sunrise) / (sunset - sunrise);
  if (dayFraction < 0 || dayFraction > 1) return 0;
  const peakMonth = new Date().getMonth(); // Southern hemisphere: peak Dec-Feb
  const summerPeak = [11, 0, 1].includes(peakMonth) ? 12 : [10, 2].includes(peakMonth) ? 9 : [9, 3].includes(peakMonth) ? 6 : 4;
  const arc = Math.sin(dayFraction * Math.PI);
  const cloud = cond.includes('nublado') || cond.includes('nubes') ? 0.5 : cond.includes('parcial') ? 0.75 : 1;
  return Math.round(arc * summerPeak * cloud);
}

// AQI for Santiago: seasonal + condition based (1=Good, 5=Very Poor)
function estimateAQI(condition: string | undefined): { value: number; label: string; cssVar: string } {
  const month = new Date().getMonth();
  const cond = (condition || '').toLowerCase();
  const winterBase = [4, 5, 6, 7, 8].includes(month) ? 4 : 2;
  const rainy = cond.includes('lluvia') ? -1 : 0;
  const raw = Math.min(5, Math.max(1, winterBase + rainy));
  const map: Record<number, { label: string; cssVar: string }> = {
    1: { label: 'Buena',     cssVar: 'var(--accent-success)' },
    2: { label: 'Aceptable', cssVar: 'var(--accent-success)' },
    3: { label: 'Moderada',  cssVar: 'var(--accent-warning)' },
    4: { label: 'Mala',      cssVar: 'var(--accent-hazard)' },
    5: { label: 'Pésima',    cssVar: 'var(--accent-hazard)' },
  };
  return { value: raw, ...map[raw] };
}

export function WeatherBulletin({ weather, loading }: WeatherBulletinProps) {
  const { t } = useTranslation();

  const now = Date.now();
  const estimated = estimateSunriseSunset();
  const sunrise = weather?.sunrise ?? estimated.sunrise;
  const sunset  = weather?.sunset  ?? estimated.sunset;
  const isDaytime = now >= sunrise && now <= sunset;

  // Honesty fix (2026-06-16): the orchestrator emits an honest sentinel
  // `{ unavailable: true }` when OpenWeather isn't configured — but this card
  // only checked `weather ?` (truthy even then) and rendered 0°C + a fabricated
  // AQI/UV as if real telemetry. Gate ALL readings on `available`; show an
  // honest "no disponible" state otherwise. Read the real `uv` field (the
  // orchestrator populates `uv`, not `uvi`), falling back to a labelled estimate.
  const available = !!weather && weather.unavailable !== true;
  const uvi = weather?.uv ?? weather?.uvi ?? estimateUVI(weather?.condition, now, sunrise, sunset);
  const uvIsReal = weather?.uv != null || weather?.uvi != null;
  const aqi = estimateAQI(weather?.condition);

  // Altitude: real from orchestrator/project or Santiago default
  const altMsnm = weather?.altitude != null
    ? Math.round(weather.altitude)
    : SANTIAGO_ALT_MSNM;

  // Lat/lng for ephemeris: real or Santiago default
  const lat = weather?.lat ?? SANTIAGO_LAT;
  const lng = weather?.lng ?? SANTIAGO_LNG;

  // Condition-based safety advisories via pure weatherAdvice fn
  const recs = available
    ? getWeatherAdvice({
        temp: weather?.temp,
        windSpeed: weather?.windSpeed,
        condition: weather?.condition,
        uv: uvi,
        airQuality: weather?.airQuality,
        aqi: weather?.aqi,
        humidity: weather?.humidity,
        isDaytime,
      })
    : [];

  const recLevelCssVar: Record<'red' | 'amber' | 'blue', string> = {
    red:   'var(--accent-hazard)',
    amber: 'var(--accent-warning)',
    blue:  'var(--accent-info)',
  };

  return (
    <section
      className="overflow-hidden shadow-mode"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: '1rem',
      }}
    >
      {/* Main body — row layout so the sky panel stays on the right */}
      <div className="flex flex-row gap-0">

        {/* Left — data + recommendations */}
        <div className="flex-1 p-2 sm:p-4 min-w-0">
          {/* Title row */}
          <div className="flex items-center justify-between mb-1 sm:mb-2">
            <div>
              <h2
                className="text-[10px] sm:text-sm font-black uppercase tracking-tight leading-none"
                style={{ color: 'var(--accent-primary)' }}
              >
                {t('weather.title', 'Boletín climático y seguridad')}
              </h2>
              <p
                className="flex items-center gap-1 text-[8px] sm:text-[10px] mt-0.5"
                style={{ color: 'var(--text-muted)' }}
              >
                <Map className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                {weather?.location
                  ? `${weather.location}, Chile`
                  : t('weather.default_city', 'Ubicación simulada, Chile')}
              </p>
            </div>
            <RefreshCw
              className={`w-3 h-3 sm:w-4 sm:h-4 cursor-pointer shrink-0 ${loading ? 'animate-spin' : ''}`}
              style={{ color: 'var(--text-muted)' }}
            />
          </div>

          {/* Main data line: temp · UV · humidity · altitude */}
          {loading ? (
            <div className="flex gap-1 mb-2">
              <Skeleton className="h-4 w-full rounded-lg" />
            </div>
          ) : available ? (
            <p
              className="text-[9px] sm:text-xs font-bold mb-1 sm:mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {Math.round(weather.temp ?? 0)}°C
              {' • '}UV {uvi}{uvIsReal ? '' : ' (est.)'}
              {' • '}{t('weather.humidity', 'Humedad')} {weather.humidity}%
              {' • '}{altMsnm} msnm
            </p>
          ) : (
            <p
              className="text-[9px] sm:text-xs font-bold mb-1 sm:mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('weather.unavailable', 'Datos meteorológicos no disponibles')}
            </p>
          )}

          {/* Air quality — real label from the orchestrator, or a clearly
              labelled estimate; never a fabricated reading shown as live. */}
          {!loading && available && (
            <p
              className="text-[8px] sm:text-[11px] font-bold mb-1.5 sm:mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('weather.air_quality', 'Calidad del aire')}:{' '}
              {weather.airQuality ? (
                <span
                  className="font-black"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {weather.airQuality}
                </span>
              ) : (
                <span
                  className="font-black"
                  style={{ color: aqi.cssVar }}
                >
                  {aqi.label} (est.)
                </span>
              )}
            </p>
          )}

          {/* Safety recommendations (from weatherAdvice pure fn) */}
          {!loading && recs.length > 0 && (
            <div>
              <p
                className="text-[7px] sm:text-[9px] font-black uppercase tracking-widest mb-1"
                style={{ color: 'var(--accent-primary)' }}
              >
                {t('weather.safety_recs', 'Recomendaciones de seguridad')}
              </p>
              <ul className="space-y-0.5 sm:space-y-1">
                {recs.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1 text-[8px] sm:text-[10px] leading-snug"
                    style={{ color: recLevelCssVar[r.level] }}
                  >
                    <span className="shrink-0 mt-px">{r.icon}</span>
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Alert badges — gated on `available` */}
          {!loading && available && (
            <div className="flex flex-wrap gap-1 mt-1.5 sm:mt-3">
              {(weather.windSpeed ?? 0) > 40 && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest"
                  style={{ background: 'rgba(220,38,38,0.12)', color: 'var(--accent-hazard)' }}
                >
                  <Wind className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                  {t('weather.alert_wind', 'Viento')}
                </span>
              )}
              {(weather.temp ?? 20) > 30 && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest"
                  style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--accent-warning)' }}
                >
                  <AlertTriangle className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                  {t('weather.alert_heat', 'Calor')}
                </span>
              )}
              {(weather.condition ?? '').toLowerCase().includes('lluvia') && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest"
                  style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent-info)' }}
                >
                  <Droplets className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                  {t('weather.alert_rain', 'Lluvia')}
                </span>
              )}
              {(weather.windSpeed ?? 0) <= 40 &&
               (weather.temp ?? 20) <= 30 &&
               !(weather.condition ?? '').toLowerCase().includes('lluvia') && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest"
                  style={{ background: 'rgba(77,182,172,0.12)', color: 'var(--accent-primary)' }}
                >
                  <CheckCircle2 className="w-2 h-2 sm:w-2.5 sm:h-2.5" />
                  {t('weather.alert_optimal', 'Óptimo')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right — SunTracker sky panel + NativeCompass
            Mode-aware border via --accent-primary token. */}
        <div
          className="shrink-0 w-[96px] sm:w-[180px] flex flex-col justify-between p-2 sm:p-3 gap-2"
          style={{
            background: 'var(--bg-elevated)',
            borderLeft: '1px solid var(--accent-primary)',
          }}
        >
          {/* SunTracker: parabolic arc with sun/moon/stars */}
          <SunTracker lat={lat} lng={lng} className="w-full" />

          {/* Native offline compass */}
          <div className="flex justify-center">
            <NativeCompass />
          </div>
        </div>
      </div>
    </section>
  );
}
