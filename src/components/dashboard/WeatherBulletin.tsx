// Praeventio Guard — Boletín climático y seguridad.
// Matches the prototype design: arc solar panel with mode-aware border,
// UV / AQI / safety recommendations derived from weather data.

import { Map, Wind, Droplets, AlertTriangle, CheckCircle2, RefreshCw, Sun, Moon, Sunrise } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '../shared/Skeleton';

export interface WeatherSnapshot {
  temp?: number;
  windSpeed?: number;
  condition?: string;
  humidity?: number;
  sunrise?: number;
  sunset?: number;
  location?: string;
  uvi?: number;
  /** Real UV index from the orchestrator (the field it actually populates; null = unknown). */
  uv?: number | null;
  aqi?: number;
  /** Real air-quality label from the orchestrator; null/absent → unknown (don't fabricate). */
  airQuality?: string | null;
  /** Honest sentinel: the weather provider (OpenWeather) is not configured/available. */
  unavailable?: boolean;
}

interface WeatherBulletinProps {
  weather: WeatherSnapshot | undefined;
  loading: boolean;
}

// Santiago, Chile altitude (default location)
const SANTIAGO_ALT_MSNM = 567;

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
function estimateAQI(condition: string | undefined): { value: number; label: string; color: string } {
  const month = new Date().getMonth();
  const cond = (condition || '').toLowerCase();
  const winterBase = [4, 5, 6, 7, 8].includes(month) ? 4 : 2;
  const rainy = cond.includes('lluvia') ? -1 : 0;
  const raw = Math.min(5, Math.max(1, winterBase + rainy));
  const map: Record<number, { label: string; color: string }> = {
    1: { label: 'Buena',     color: 'text-teal-600 dark:text-teal-400' },
    2: { label: 'Aceptable', color: 'text-green-600 dark:text-green-400' },
    3: { label: 'Moderada',  color: 'text-amber-600 dark:text-amber-400' },
    4: { label: 'Mala',      color: 'text-orange-600 dark:text-orange-400' },
    5: { label: 'Pésima',    color: 'text-red-600 dark:text-red-400' },
  };
  return { value: raw, ...map[raw] };
}

// Generate safety recommendations from weather context
function getSafetyRecs(
  w: WeatherSnapshot,
  uvi: number,
  aqiValue: number,
  isDaytime: boolean,
): { icon: string; text: string; level: 'red' | 'amber' | 'blue' }[] {
  const recs: { icon: string; text: string; level: 'red' | 'amber' | 'blue' }[] = [];
  const cond = (w.condition || '').toLowerCase();

  if (cond.includes('lluvia') || cond.includes('mojad'))
    recs.push({ icon: '⚠️', text: 'Use calzado antideslizante en superficies mojadas.', level: 'red' });
  if ((w.windSpeed ?? 0) > 40)
    recs.push({ icon: '⚠️', text: 'Viento fuerte: asegure elementos sueltos y use arnés en altura.', level: 'red' });
  if ((w.temp ?? 20) > 30)
    recs.push({ icon: '🌡️', text: 'Estrés térmico: hidratación cada 20 min y pausas a la sombra.', level: 'red' });
  if (uvi >= 6)
    recs.push({ icon: '☀️', text: 'UV alto: protector solar 50+, casco con ala y manga larga.', level: 'amber' });
  if (aqiValue >= 4)
    recs.push({ icon: '🚶', text: 'Evite actividad física intensa al aire libre por calidad de aire deficiente.', level: 'amber' });
  if (!isDaytime)
    recs.push({ icon: '🔦', text: 'Use iluminación adecuada en trabajo nocturno.', level: 'blue' });

  if (recs.length === 0)
    recs.push({ icon: '✅', text: 'Condiciones favorables. Mantenga su EPP estándar.', level: 'blue' });

  return recs.slice(0, 3);
}

// Determine solar event label and minutes remaining
function getSolarEvent(
  now: number,
  sunrise: number,
  sunset: number,
): { label: string; time: number; minutesAway: number; isDaytime: boolean } {
  if (now < sunrise) {
    return { label: 'Amanecer', time: sunrise, minutesAway: Math.round((sunrise - now) / 60000), isDaytime: false };
  }
  if (now < sunset) {
    return { label: 'Ocaso', time: sunset, minutesAway: Math.round((sunset - now) / 60000), isDaytime: true };
  }
  // After sunset — show tomorrow's sunrise estimate
  const tomorrowSunrise = sunrise + 24 * 60 * 60 * 1000;
  return { label: 'Amanecer', time: tomorrowSunrise, minutesAway: Math.round((tomorrowSunrise - now) / 60000), isDaytime: false };
}

// Compute sun position on the arc (0–100 horizontal, -50–50 vertical)
function sunPosition(now: number, sunrise: number, sunset: number): { cx: number; cy: number } {
  if (now < sunrise || now > sunset) return { cx: now < sunrise ? 0 : 100, cy: 50 };
  const p = (now - sunrise) / (sunset - sunrise);
  const cx = p * 100;
  const cy = 50 - Math.sqrt(Math.max(0, 2500 - Math.pow(cx - 50, 2)));
  return { cx, cy };
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
  const recs = available ? getSafetyRecs(weather, uvi, aqi.value, isDaytime) : [];

  const solar = getSolarEvent(now, sunrise, sunset);
  const { cx, cy } = sunPosition(now, sunrise, sunset);

  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

  const recLevelColor = {
    red:   'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    blue:  'text-blue-600 dark:text-blue-400',
  };

  return (
    <section className="bg-surface border border-default-token rounded-xl sm:rounded-2xl overflow-hidden shadow-mode">
      {/* Main body — always row so the arc panel stays compact on mobile */}
      <div className="flex flex-row gap-0">

        {/* Left — data + recommendations */}
        <div className="flex-1 p-2 sm:p-4 min-w-0">
          {/* Title row */}
          <div className="flex items-center justify-between mb-1 sm:mb-2">
            <div>
              <h2 className="text-[10px] sm:text-sm font-black text-primary-token uppercase tracking-tight leading-none">
                {t('weather.title', 'Boletín climático y seguridad')}
              </h2>
              <p className="flex items-center gap-1 text-[8px] sm:text-[10px] text-muted-token mt-0.5">
                <Map className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                {weather?.location
                  ? `${weather.location}, Chile`
                  : t('weather.default_city', 'Ubicación simulada, Chile')}
              </p>
            </div>
            <RefreshCw className={`w-3 h-3 sm:w-4 sm:h-4 text-muted-token cursor-pointer shrink-0 ${loading ? 'animate-spin' : ''}`} />
          </div>

          {/* Main data line */}
          {loading ? (
            <div className="flex gap-1 mb-2">
              <Skeleton className="h-4 w-full rounded-lg" />
            </div>
          ) : available ? (
            <p className="text-[9px] sm:text-xs font-bold text-secondary-token mb-1 sm:mb-2">
              {Math.round(weather.temp ?? 0)}°C
              {' • '}UV {uvi}{uvIsReal ? '' : ' (est.)'}
              {' • '}{t('weather.humidity', 'Humedad')} {weather.humidity}%
              {' • '}{SANTIAGO_ALT_MSNM} msnm
            </p>
          ) : (
            <p className="text-[9px] sm:text-xs font-bold text-muted-token mb-1 sm:mb-2">
              {t('weather.unavailable', 'Datos meteorológicos no disponibles')}
            </p>
          )}

          {/* Air quality — real label from the orchestrator, or a clearly
              labelled estimate; never a fabricated reading shown as live. */}
          {!loading && available && (
            <p className="text-[8px] sm:text-[11px] font-bold text-muted-token mb-1.5 sm:mb-3">
              {t('weather.air_quality', 'Calidad del aire')}:{' '}
              {weather.airQuality ? (
                <span className="font-black text-secondary-token">{weather.airQuality}</span>
              ) : (
                <span className={`${aqi.color} font-black`}>{aqi.label} (est.)</span>
              )}
            </p>
          )}

          {/* Safety recommendations */}
          {!loading && recs.length > 0 && (
            <div>
              <p className="text-[7px] sm:text-[9px] font-black uppercase tracking-widest accent-text mb-1">
                {t('weather.safety_recs', 'Recomendaciones de seguridad')}
              </p>
              <ul className="space-y-0.5 sm:space-y-1">
                {recs.map((r, i) => (
                  <li key={i} className={`flex items-start gap-1 text-[8px] sm:text-[10px] leading-snug ${recLevelColor[r.level]}`}>
                    <span className="shrink-0 mt-px">{r.icon}</span>
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Alert badges — gated on `available`, not just `weather`: with the
              `{ unavailable: true }` sentinel the nullish fallbacks (?? 0 / ?? 20)
              would otherwise satisfy the "Óptimo" branch and paint a green
              all-clear badge next to "Datos no disponibles" (WB-1). */}
          {!loading && available && (
            <div className="flex flex-wrap gap-1 mt-1.5 sm:mt-3">
              {(weather.windSpeed ?? 0) > 40 && (
                <span className="flex items-center gap-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest">
                  <Wind className="w-2 h-2 sm:w-2.5 sm:h-2.5" /> {t('weather.alert_wind', 'Viento')}
                </span>
              )}
              {(weather.temp ?? 20) > 30 && (
                <span className="flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest">
                  <AlertTriangle className="w-2 h-2 sm:w-2.5 sm:h-2.5" /> {t('weather.alert_heat', 'Calor')}
                </span>
              )}
              {(weather.condition ?? '').toLowerCase().includes('lluvia') && (
                <span className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest">
                  <Droplets className="w-2 h-2 sm:w-2.5 sm:h-2.5" /> {t('weather.alert_rain', 'Lluvia')}
                </span>
              )}
              {(weather.windSpeed ?? 0) <= 40 && (weather.temp ?? 20) <= 30 && !(weather.condition ?? '').toLowerCase().includes('lluvia') && (
                <span className="flex items-center gap-1 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded text-[7px] sm:text-[9px] font-bold uppercase tracking-widest">
                  <CheckCircle2 className="w-2 h-2 sm:w-2.5 sm:h-2.5" /> {t('weather.alert_optimal', 'Óptimo')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right — Solar arc panel (mode-aware border color via --accent-primary) */}
        <div
          className="shrink-0 w-[88px] sm:w-[160px] bg-[#0a1628] flex flex-col justify-between p-1.5 sm:p-3"
          style={{ borderLeft: '1px solid var(--accent-primary)' }}
        >
          {/* Header: event label + time */}
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-0.5 text-[7px] sm:text-[9px] font-bold text-amber-400">
              {solar.isDaytime
                ? <Sunrise className="w-2 h-2 sm:w-3 sm:h-3" />
                : <Moon className="w-2 h-2 sm:w-3 sm:h-3" />}
              <span>{solar.label}</span>
            </div>
            <span className="text-[7px] sm:text-[10px] font-black text-white tabular-nums">
              {fmt(solar.time)}
            </span>
          </div>

          {/* Sunrise / sunset time labels */}
          <div className="flex justify-between text-[5px] sm:text-[8px] font-bold text-zinc-500 mb-0.5">
            <span>{fmt(sunrise)}</span>
            <span>{fmt(sunset)}</span>
          </div>

          {/* SVG arc — fixed height on mobile, aspect-ratio on desktop */}
          <div className="relative w-full h-[42px] sm:h-auto sm:[padding-top:52%]">
            <svg
              viewBox="-5 -5 110 60"
              className="absolute inset-0 w-full h-full overflow-visible"
            >
              {/* Tick marks */}
              {Array.from({ length: 13 }, (_, i) => {
                const px = (i / 12) * 100;
                const pxC = px - 50;
                const yBase = 50;
                const yArc = yBase - Math.sqrt(Math.max(0, 2500 - pxC * pxC));
                return (
                  <line
                    key={i}
                    x1={px} y1={yArc - 3}
                    x2={px} y2={yArc}
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth="1"
                  />
                );
              })}
              {/* Arc path */}
              <path
                d="M 0 50 A 50 50 0 0 1 100 50"
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              {/* Sun/Moon dot */}
              {weather && (
                <circle
                  cx={cx}
                  cy={cy}
                  r="5"
                  fill={isDaytime ? '#f59e0b' : '#e2e8f0'}
                  style={{ filter: `drop-shadow(0 0 4px ${isDaytime ? '#f59e0b' : '#94a3b8'})` }}
                />
              )}
            </svg>
          </div>

          {/* Countdown */}
          <p className="text-center text-[6px] sm:text-[9px] text-zinc-400 font-bold mt-0.5">
            {solar.minutesAway > 0
              ? `en ${solar.minutesAway < 60
                  ? `${solar.minutesAway}m`
                  : `${Math.floor(solar.minutesAway / 60)}h ${solar.minutesAway % 60}m`}`
              : solar.label}
          </p>
        </div>
      </div>
    </section>
  );
}
