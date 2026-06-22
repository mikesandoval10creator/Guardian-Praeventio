import { useState, useEffect } from 'react';
import { Sunrise, Sunset, Moon } from 'lucide-react';
import { getSunTimes, getMoonPhase, getLunarDay, type MoonData } from '../../lib/ephemeris';

interface SunTrackerProps {
  lat: number;
  lng: number;
  className?: string;
}

interface SunState {
  sunrise: Date;
  sunset: Date;
  isDay: boolean;
  sunPosition: number;   // 0-100
  moon: MoonData;
  lunarDay: number;
  nextEvent: 'sunrise' | 'sunset';
  nextEventTime: Date;
}

function computeSunState(lat: number, lng: number): SunState {
  const now = new Date();
  const { sunrise, sunset } = getSunTimes(now, lat, lng);
  const moon = getMoonPhase(now);
  const lunarDay = getLunarDay(now);

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
  const toSunset  = sunset.getTime()  - now.getTime();
  let nextEvent: 'sunrise' | 'sunset';
  let nextEventTime: Date;
  if (toSunrise > 0 && (toSunset < 0 || toSunrise < toSunset)) {
    nextEvent = 'sunrise'; nextEventTime = sunrise;
  } else {
    nextEvent = 'sunset';  nextEventTime = sunset;
  }

  return { sunrise, sunset, isDay, sunPosition, moon, lunarDay, nextEvent, nextEventTime };
}

export function SunTracker({ lat, lng, className = '' }: SunTrackerProps) {
  const [state, setState] = useState<SunState | null>(null);

  useEffect(() => {
    setState(computeSunState(lat, lng));
    const interval = setInterval(() => setState(computeSunState(lat, lng)), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [lat, lng]);

  if (!state) return null;

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });

  const { sunrise, sunset, isDay, sunPosition, moon, nextEvent, nextEventTime } = state;

  const now = new Date();
  const timeDiff = nextEventTime.getTime() - now.getTime();
  const hrs  = Math.floor(timeDiff / 3600000);
  const mins = Math.floor((timeDiff % 3600000) / 60000);
  const countdown = hrs > 0 ? `en ${hrs}h ${mins}m` : `en ${mins}m`;

  // SVG arc geometry
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
              <stop offset="0%" stopColor="var(--accent-warning)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--accent-warning)" stopOpacity="0.7" />
            </radialGradient>
            <radialGradient id="prv-moonGrad" cx="30%" cy="30%" r="70%">
              <stop offset="0%" stopColor="var(--text-primary)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--text-muted)" stopOpacity="0.6" />
            </radialGradient>
            <linearGradient id="prv-arcDay" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--accent-warning)" stopOpacity="0.3" />
              <stop offset="50%" stopColor="var(--accent-warning)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--accent-warning)" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="prv-arcNight" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.2" />
              <stop offset="50%" stopColor="var(--accent-primary)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0.2" />
            </linearGradient>
            <filter id="prv-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.8" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Background arc */}
          <path d="M 8 17 Q 50 2 92 17" stroke="var(--border-default)" strokeWidth="1.5"
            fill="none" opacity="0.3" />

          {/* Progress arc */}
          <path d="M 8 17 Q 50 2 92 17"
            stroke={isDay ? 'url(#prv-arcDay)' : 'url(#prv-arcNight)'}
            strokeWidth="2.5" fill="none"
            strokeDasharray="84"
            strokeDashoffset={84 - sunPosition * 0.84}
            style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
          />

          {/* Tick marks */}
          {Array.from({ length: 13 }, (_, i) => {
            const px = (i / 12) * 84 + 8;
            const py = 17 - Math.sin((i / 12) * Math.PI) * 15;
            return (
              <circle key={i} cx={px} cy={py} r="0.3"
                fill="var(--text-muted)" opacity="0.4" />
            );
          })}

          {/* Sun or Moon body */}
          {isDay ? (
            <circle
              cx={sunX} cy={sunY} r="2.5"
              fill="url(#prv-sunGrad)"
              filter="url(#prv-glow)"
              className="sun-element"
              style={{ transition: 'cx 0.5s ease-out, cy 0.5s ease-out' }}
            />
          ) : (
            <circle
              cx={sunX} cy={sunY} r="2.5"
              fill="url(#prv-moonGrad)"
              className="moon-element"
              style={{ transition: 'cx 0.5s ease-out, cy 0.5s ease-out' }}
            />
          )}

          {/* Sun rays (daytime only) */}
          {isDay && Array.from({ length: 8 }, (_, i) => {
            const angle = (i * 45) * Math.PI / 180;
            return (
              <line key={i}
                x1={sunX + Math.cos(angle) * 3.2}
                y1={sunY + Math.sin(angle) * 3.2}
                x2={sunX + Math.cos(angle) * 4.7}
                y2={sunY + Math.sin(angle) * 4.7}
                stroke="var(--accent-warning)" strokeWidth="0.3" opacity="0.5"
              />
            );
          })}

          {/* Moon phase shadow */}
          {!isDay && moon.phase !== 'full' && moon.phase !== 'new' && (
            <ellipse
              cx={sunX} cy={sunY}
              rx={2.5 * (1 - moon.illumination / 100)}
              ry={2.5}
              fill="var(--bg-surface)" opacity="0.8"
            />
          )}

          {/* Stars (night only) */}
          {!isDay && Array.from({ length: 3 }, (_, i) => (
            <circle key={i}
              cx={20 + i * 25 + Math.sin(i) * 10}
              cy={5 + Math.cos(i) * 3}
              r="0.3"
              fill="var(--text-muted)"
              className="twinkle-star"
              style={{ animation: `twinkle ${2 + i * 0.5}s ease-in-out infinite alternate` }}
            />
          ))}

          {/* Drop line to horizon */}
          <line
            x1={sunX} y1={sunY}
            x2={sunX} y2="17"
            stroke={isDay ? 'url(#prv-arcDay)' : 'url(#prv-arcNight)'}
            strokeWidth="1" strokeDasharray="1.5,1.5" opacity="0.5"
          />

          {/* Horizon dot */}
          <circle cx={sunX} cy="17" r="0.8"
            fill={isDay ? 'var(--accent-warning)' : 'var(--accent-primary)'}
          />
        </svg>
      </div>

      {/* Moon info row */}
      {!isDay && (
        <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-1">
            <Moon className="h-3 w-3" />
            <span>{moon.phase.replace(/_/g, ' ')}</span>
          </div>
          <span className="font-mono">{moon.illumination}% iluminada</span>
        </div>
      )}
    </div>
  );
}
