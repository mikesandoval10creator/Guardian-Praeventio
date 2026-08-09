// Praeventio Guard — Boletín climático y seguridad.
// Upgraded to rich layout: SunTracker sky panel + NativeCompass + altitude +
// air-quality (colour-coded) + condition-based safety advisories.
// All colours via semantic tokens (no hardcoded hex).

import { Map, Wind, Droplets, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../shared/Skeleton';
import { SunTrackerContainer } from '../SunTrackerContainer';
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
  /** Legacy latitude field; used only when paired with a finite longitude. */
  lat?: number | null;
  /** Legacy longitude field; used only when paired with a finite latitude. */
  lng?: number | null;
  sourceCoordinates?: { lat: number; lng: number } | null;
  measuredAt?: number | null;
}

interface WeatherBulletinProps {
  weather: WeatherSnapshot | undefined;
  loading: boolean;
}

export function WeatherBulletin({ weather, loading }: WeatherBulletinProps) {
  const { t } = useTranslation();

  const now = Date.now();
  const sunrise = weather?.sunrise;
  const sunset = weather?.sunset;
  const isDaytime =
    typeof sunrise === 'number' && typeof sunset === 'number'
      ? now >= sunrise && now <= sunset
      : undefined;

  // Honesty fix (2026-06-16): the orchestrator emits an honest sentinel
  // `{ unavailable: true }` when OpenWeather isn't configured — but this card
  // only checked `weather ?` (truthy even then) and rendered 0°C + a fabricated
  // AQI/UV as if real telemetry. Gate ALL readings on `available`; show an
  // honest "no disponible" state otherwise. Read the real `uv` field (the
  // orchestrator populates `uv`, not `uvi`). Unknown telemetry stays unknown.
  const available = !!weather && weather.unavailable !== true;
  const uvi = weather?.uv ?? weather?.uvi ?? null;

  // Altitude: real from orchestrator/project or unavailable.
  const altMsnm = weather?.altitude != null
    ? Math.round(weather.altitude)
    : null;

  const legacyLat = weather?.lat;
  const legacyLng = weather?.lng;
  const coordinates =
    weather?.sourceCoordinates ??
    (typeof legacyLat === 'number' &&
    Number.isFinite(legacyLat) &&
    typeof legacyLng === 'number' &&
    Number.isFinite(legacyLng)
      ? { lat: legacyLat, lng: legacyLng }
      : null);
  const sourceAgeMinutes =
    typeof weather?.measuredAt === 'number' && Number.isFinite(weather.measuredAt)
      ? Math.max(0, Math.floor((now - weather.measuredAt) / 60_000))
      : null;

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
                {weather?.location ?? (coordinates
                  ? `${coordinates.lat.toFixed(3)}, ${coordinates.lng.toFixed(3)}`
                  : t('weather.location_unavailable', 'Ubicación no disponible'))}
                {sourceAgeMinutes !== null && (
                  <>
                    {' · '}
                    {t('weather.source_age', {
                      defaultValue: 'hace {{minutes}} min',
                      minutes: sourceAgeMinutes,
                    })}
                  </>
                )}
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
              {' • '}UV {uvi ?? '—'}
              {' • '}{t('weather.humidity', 'Humedad')} {weather.humidity}%
              {' • '}{altMsnm !== null
                ? `${altMsnm} msnm`
                : t('weather.altitude_unavailable', 'Altitud no disponible')}
            </p>
          ) : (
            <p
              className="text-[9px] sm:text-xs font-bold mb-1 sm:mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('weather.unavailable', 'Datos meteorológicos no disponibles')}
            </p>
          )}

          {/* Air quality — real label only; never infer Santiago pollution. */}
          {!loading && available && (
            <p
              className="text-[8px] sm:text-[11px] font-bold mb-1.5 sm:mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('weather.air_quality', 'Calidad del aire')}:{' '}
              <span className="font-black" style={{ color: 'var(--text-secondary)' }}>
                {weather.airQuality ?? t('weather.air_quality_unavailable', 'Datos no disponibles')}
              </span>
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
          {/* Rich celestial tracker: parabolic arc, sun glow + rays,
              8 lunar phases with illumination shadow, twinkling stars,
              next-event countdown and the Fase Solar / Ciclo Lunar info panel. */}
          {coordinates ? (
            <SunTrackerContainer
              lat={coordinates.lat}
              lng={coordinates.lng}
              className="w-full"
            />
          ) : (
            <p className="text-[8px] text-center" style={{ color: 'var(--text-muted)' }}>
              {t('weather.ephemeris_unavailable', 'Efemérides no disponibles')}
            </p>
          )}

          {/* Native offline compass */}
          <div className="flex justify-center">
            <NativeCompass />
          </div>
        </div>
      </div>
    </section>
  );
}
