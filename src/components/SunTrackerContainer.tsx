// Praeventio Guard — Rich celestial tracker (sol/arco diurno + luna/fases nocturnas).
//
// Consolidation (2026-06): this is now THE single solar/lunar widget. It ports
// the superior prototype SunTracker — radial sun/moon gradients, glow filter,
// 8 solar rays, parabolic hourly tick marks, 8 lunar phases with an
// illumination shadow, twinkling stars at night, next-event countdown and a
// rich info panel (Fase Solar · Ciclo Lunar día X/28 · % iluminada).
//
// Astronomy is 100% on-device via the pure `lib/ephemeris` module
// (getSunTimes / getMoonPhase / getLunarDay) — no network at runtime.
//
// Colours come from semantic tokens (--accent-warning sun, --accent-primary
// night, --text-* / --bg-* / --border-default). The sun keeps its dorado glow,
// the moon its silvered fill. This component is rendered inside
// WeatherBulletin's right sky panel; the old standalone duplicate on the
// dashboard was removed.

import { useEffect, useState } from 'react';
import { Sunrise, Sunset, Moon, Clock } from 'lucide-react';
import { getSunTimes, getMoonPhase, getLunarDay, type MoonData } from '../lib/ephemeris';

interface SunTrackerContainerProps {
  /** Latitude for the ephemeris (defaults to Santiago −33.4489). */
  lat?: number;
  /** Longitude for the ephemeris (defaults to Santiago −70.67). */
  lng?: number;
  className?: string;
}

interface SunState {
  sunrise: Date;
  sunset: Date;
  isDay: boolean;
  sunPosition: number; // 0-100 across the sky
  moon: MoonData;
  currentHour: number; // 0-23
  hourlyLabel: string; // Spanish solar-phase label for the current hour
  nextEvent: 'sunrise' | 'sunset';
  nextEventTime: Date;
}

// 24 Spanish-CL solar-phase labels (one per hour) — drives the "Fase Solar" chip.
const HOURLY_LABELS = [
  'Medianoche profunda', 'Madrugada temprana', 'Madrugada media', 'Pre-amanecer',
  'Amanecer temprano', 'Amanecer dorado', 'Mañana temprana', 'Mañana clara',
  'Media mañana', 'Mañana radiante', 'Pre-mediodía', 'Mediodía pleno',
  'Post-mediodía', 'Tarde temprana', 'Tarde media', 'Tarde dorada',
  'Atardecer temprano', 'Ocaso dorado', 'Crepúsculo', 'Noche temprana',
  'Noche media', 'Noche avanzada', 'Noche profunda', 'Pre-medianoche',
];

// Spanish-CL moon-phase labels keyed by the ephemeris MoonPhase union.
const MOON_LABELS: Record<MoonData['phase'], string> = {
  new: 'Luna nueva',
  waxing_crescent: 'Luna creciente',
  first_quarter: 'Cuarto creciente',
  waxing_gibbous: 'Gibosa creciente',
  full: 'Luna llena',
  waning_gibbous: 'Gibosa menguante',
  last_quarter: 'Cuarto menguante',
  waning_crescent: 'Luna menguante',
};

function computeSunState(lat: number, lng: number): SunState {
  const now = new Date();
  const { sunrise, sunset } = getSunTimes(now, lat, lng);
  const moon = getMoonPhase(now);

  const isDay = now >= sunrise && now <= sunset;
  let sunPosition = 0;
  if (isDay) {
    const dayDuration = sunset.getTime() - sunrise.getTime();
    const elapsed = now.getTime() - sunrise.getTime();
    sunPosition = Math.max(0, Math.min(100, (elapsed / dayDuration) * 100));
  } else if (now < sunrise) {
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const { sunset: yestSunset } = getSunTimes(yesterday, lat, lng);
    const nightDuration = sunrise.getTime() - yestSunset.getTime();
    const elapsed = now.getTime() - yestSunset.getTime();
    sunPosition = Math.max(0, Math.min(25, (elapsed / nightDuration) * 25));
  } else {
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const { sunrise: tmrSunrise } = getSunTimes(tomorrow, lat, lng);
    const nightDuration = tmrSunrise.getTime() - sunset.getTime();
    const elapsed = now.getTime() - sunset.getTime();
    sunPosition = Math.max(75, Math.min(100, 75 + (elapsed / nightDuration) * 25));
  }

  const toSunrise = sunrise.getTime() - now.getTime();
  const toSunset = sunset.getTime() - now.getTime();
  let nextEvent: 'sunrise' | 'sunset';
  let nextEventTime: Date;
  if (toSunrise > 0 && (toSunset < 0 || toSunrise < toSunset)) {
    nextEvent = 'sunrise'; nextEventTime = sunrise;
  } else {
    nextEvent = 'sunset'; nextEventTime = sunset;
  }

  const currentHour = now.getHours();
  return {
    sunrise, sunset, isDay, sunPosition, moon,
    currentHour,
    hourlyLabel: HOURLY_LABELS[currentHour] ?? HOURLY_LABELS[0],
    nextEvent, nextEventTime,
  };
}

export function SunTrackerContainer({
  lat = -33.4489,
  lng = -70.67,
  className = '',
}: SunTrackerContainerProps) {
  const [state, setState] = useState<SunState | null>(null);

  useEffect(() => {
    setState(computeSunState(lat, lng));
    // Recompute hourly (astronomy changes slowly; the hourly state chip flips on the hour).
    const interval = setInterval(() => setState(computeSunState(lat, lng)), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [lat, lng]);

  if (!state) return null;

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });

  const { sunrise, sunset, isDay, sunPosition, moon, currentHour, hourlyLabel, nextEvent, nextEventTime } = state;

  const now = new Date();
  const timeDiff = nextEventTime.getTime() - now.getTime();
  const hrs = Math.floor(timeDiff / 3600000);
  const mins = Math.floor((timeDiff % 3600000) / 60000);
  const countdown = hrs > 0 ? `en ${hrs}h ${mins}m` : `en ${mins}m`;

  // SVG arc geometry (viewBox 0 0 100 20).
  const sunX = 8 + sunPosition * 0.84;
  const sunY = 17 - Math.sin((sunPosition / 100) * Math.PI) * 15;

  return (
    <div className={`space-y-2 ${className}`} data-testid="sun-tracker">
      {/* Next event row */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          {nextEvent === 'sunrise'
            ? <Sunrise className="h-3 w-3" style={{ color: 'var(--accent-warning)' }} />
            : <Sunset className="h-3 w-3" style={{ color: 'var(--accent-primary)' }} />}
          <span className="font-medium text-xs">
            {nextEvent === 'sunrise' ? 'Amanecer' : 'Ocaso'}
          </span>
        </div>
        <div className="text-right">
          <div className="font-mono font-medium text-xs" style={{ color: 'var(--text-primary)' }}>
            {fmtTime(nextEventTime)}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{countdown}</div>
        </div>
      </div>

      {/* Horizon labels */}
      <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <span>{fmtTime(sunrise)}</span>
        <span>{fmtTime(sunset)}</span>
      </div>

      {/* SVG arc */}
      <div className="relative h-12">
        {/* Horizon line */}
        <div className="absolute bottom-0 left-0 right-0 h-px opacity-30"
          style={{ background: 'var(--border-default)' }} />

        <svg viewBox="0 0 100 20" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMax meet">
          <defs>
            <radialGradient id="prv-sunGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FCD34D" stopOpacity="1" />
              <stop offset="70%" stopColor="var(--accent-warning)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#D97706" stopOpacity="0.8" />
            </radialGradient>
            <radialGradient id="prv-moonGrad" cx="30%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#F1F5F9" stopOpacity="1" />
              <stop offset="70%" stopColor="#CBD5E1" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#94A3B8" stopOpacity="0.8" />
            </radialGradient>
            <linearGradient id="prv-arcDay" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--accent-warning)" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#FCD34D" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--accent-warning)" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="prv-arcNight" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.2" />
              <stop offset="50%" stopColor="var(--accent-primary)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0.2" />
            </linearGradient>
            <filter id="prv-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.8" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="prv-softShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0.5" stdDeviation="0.5" floodOpacity="0.3" />
            </filter>
          </defs>

          {/* Background arc */}
          <path d="M 8 17 Q 50 2 92 17" stroke="var(--border-default)" strokeWidth="1.5"
            fill="none" opacity="0.3" filter="url(#prv-softShadow)" />

          {/* Progress arc */}
          <path d="M 8 17 Q 50 2 92 17"
            stroke={isDay ? 'url(#prv-arcDay)' : 'url(#prv-arcNight)'}
            strokeWidth="2.5" fill="none"
            strokeDasharray="84"
            strokeDashoffset={84 - sunPosition * 0.84}
            style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
          />

          {/* Hourly parabolic tick marks */}
          {Array.from({ length: 13 }, (_, i) => {
            const px = (i / 12) * 84 + 8;
            const py = 17 - Math.sin((i / 12) * Math.PI) * 15;
            const isCurrent = Math.abs(px - sunX) < 4;
            return (
              <g key={i}>
                <line x1={px} y1={py} x2={px} y2="17"
                  stroke={isCurrent ? 'url(#prv-arcDay)' : 'var(--text-muted)'}
                  strokeWidth={isCurrent ? 1 : 0.4}
                  opacity={isCurrent ? 0.85 : 0.25} />
                <circle cx={px} cy={py} r={isCurrent ? 0.5 : 0.3}
                  fill={isCurrent ? '#FCD34D' : 'var(--text-muted)'}
                  filter={isCurrent ? 'url(#prv-glow)' : undefined}
                  opacity={isCurrent ? 0.95 : 0.4} />
              </g>
            );
          })}

          {/* Sun or Moon body */}
          {isDay ? (
            <circle cx={sunX} cy={sunY} r="2.5" fill="url(#prv-sunGrad)" filter="url(#prv-glow)"
              className="sun-element"
              style={{ transition: 'cx 0.5s ease-out, cy 0.5s ease-out' }} />
          ) : (
            <circle cx={sunX} cy={sunY} r="2.5" fill="url(#prv-moonGrad)" filter="url(#prv-softShadow)"
              className="moon-element"
              style={{ transition: 'cx 0.5s ease-out, cy 0.5s ease-out' }} />
          )}

          {/* Sun rays (daytime only) */}
          {isDay && Array.from({ length: 8 }, (_, i) => {
            const angle = (i * 45) * Math.PI / 180;
            return (
              <line key={i}
                x1={sunX + Math.cos(angle) * 3.2} y1={sunY + Math.sin(angle) * 3.2}
                x2={sunX + Math.cos(angle) * 4.7} y2={sunY + Math.sin(angle) * 4.7}
                stroke="url(#prv-sunGrad)" strokeWidth="0.3" opacity="0.6" />
            );
          })}

          {/* Moon-phase illumination shadow (waxing/waning) */}
          {!isDay && moon.phase !== 'full' && moon.phase !== 'new' && (
            <ellipse cx={sunX} cy={sunY}
              rx={2.5 * (1 - moon.illumination / 100)} ry={2.5}
              fill="var(--bg-surface)" opacity="0.8" />
          )}

          {/* New moon — faint dashed ring */}
          {!isDay && moon.phase === 'new' && (
            <circle cx={sunX} cy={sunY} r="2.2" fill="none"
              stroke="#CBD5E1" strokeWidth="0.6" strokeDasharray="2,1" opacity="0.5" />
          )}

          {/* Twinkling stars (night only) */}
          {!isDay && Array.from({ length: 3 }, (_, i) => (
            <circle key={i}
              cx={20 + i * 25 + Math.sin(i) * 10}
              cy={5 + Math.cos(i) * 3}
              r="0.3"
              fill="#CBD5E1"
              className="twinkle-star"
              style={{ animation: `twinkle ${2 + i * 0.5}s ease-in-out infinite alternate` }} />
          ))}

          {/* Drop line to horizon */}
          <line x1={sunX} y1={sunY} x2={sunX} y2="17"
            stroke={isDay ? 'url(#prv-arcDay)' : 'url(#prv-arcNight)'}
            strokeWidth="1" strokeDasharray="1.5,1.5" opacity="0.6" />

          {/* Horizon dot */}
          <circle cx={sunX} cy="17" r="0.8"
            fill={isDay ? 'var(--accent-warning)' : 'var(--accent-primary)'}
            filter="url(#prv-softShadow)" />
        </svg>
      </div>

      {/* Rich info panel — Estado Actual: Fase Solar · Ciclo Lunar · % iluminada */}
      <div className="rounded-lg p-2 space-y-1.5"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <Clock className="h-3 w-3" style={{ color: 'var(--accent-primary)' }} />
            <span className="text-[10px] font-medium">Estado actual</span>
          </div>
          <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {currentHour.toString().padStart(2, '0')}:00
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[9px]">
          <div className="space-y-0.5">
            <span style={{ color: 'var(--text-muted)' }}>Fase solar</span>
            <div className="font-mono px-1.5 py-0.5 rounded leading-tight"
              style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--accent-warning)' }}>
              {hourlyLabel}
            </div>
          </div>
          <div className="space-y-0.5">
            <span style={{ color: 'var(--text-muted)' }}>Ciclo lunar</span>
            <div className="font-mono px-1.5 py-0.5 rounded leading-tight"
              style={{ background: 'rgba(77,182,172,0.12)', color: 'var(--accent-primary)' }}>
              Día {getLunarDay(now) + 1}/28
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1"
          style={{ borderTop: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Moon className="h-3 w-3" />
            <span className="text-[9px]">{MOON_LABELS[moon.phase]}</span>
          </div>
          <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {moon.illumination}% iluminada
          </span>
        </div>
      </div>
    </div>
  );
}
