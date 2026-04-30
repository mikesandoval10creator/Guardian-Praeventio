import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon, Sunrise, Sunset, Star } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

// 24 hourly solar states in Spanish
const SOLAR_STATES: Record<number, { label: string; emoji: string }> = {
  0:  { label: 'Medianoche',      emoji: '🌑' },
  1:  { label: 'Madrugada',       emoji: '🌑' },
  2:  { label: 'Madrugada',       emoji: '🌒' },
  3:  { label: 'Antes del alba',  emoji: '🌒' },
  4:  { label: 'Pre-amanecer',    emoji: '🌓' },
  5:  { label: 'Amanecer',        emoji: '🌄' },
  6:  { label: 'Alba',            emoji: '🌅' },
  7:  { label: 'Mañana temprana', emoji: '🌤️' },
  8:  { label: 'Mañana',          emoji: '☀️' },
  9:  { label: 'Media mañana',    emoji: '☀️' },
  10: { label: 'Mañana',          emoji: '🌞' },
  11: { label: 'Antes del mediodía', emoji: '🌞' },
  12: { label: 'Mediodía',        emoji: '🌞' },
  13: { label: 'Primeras horas tarde', emoji: '☀️' },
  14: { label: 'Tarde',           emoji: '🌤️' },
  15: { label: 'Tarde media',     emoji: '⛅' },
  16: { label: 'Tarde avanzada',  emoji: '⛅' },
  17: { label: 'Antes del atardecer', emoji: '🌇' },
  18: { label: 'Atardecer',       emoji: '🌆' },
  19: { label: 'Crepúsculo',      emoji: '🌇' },
  20: { label: 'Anochecer',       emoji: '🌆' },
  21: { label: 'Noche temprana',  emoji: '🌙' },
  22: { label: 'Noche',           emoji: '🌙' },
  23: { label: 'Noche avanzada',  emoji: '🌙' },
};

// 8 lunar phases
function getLunarPhase(date: Date): { label: string; emoji: string } {
  const knownNew = new Date('2000-01-06T18:14:00Z');
  const lunation = 29.53058770576;
  const diff = (date.getTime() - knownNew.getTime()) / (1000 * 60 * 60 * 24);
  const phase = ((diff % lunation) + lunation) % lunation;
  const idx = Math.floor((phase / lunation) * 8);
  const phases = [
    { label: 'Luna Nueva',        emoji: '🌑' },
    { label: 'Cuarto Creciente',  emoji: '🌒' },
    { label: 'Creciente',         emoji: '🌓' },
    { label: 'Gibosa Creciente',  emoji: '🌔' },
    { label: 'Luna Llena',        emoji: '🌕' },
    { label: 'Gibosa Menguante',  emoji: '🌖' },
    { label: 'Cuarto Menguante',  emoji: '🌗' },
    { label: 'Menguante',         emoji: '🌘' },
  ];
  return phases[idx] ?? phases[0];
}

// Solar elevation angle (simplified) for visual sun position
function getSolarElevation(lat: number, date: Date): number {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const decl = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81)) * (Math.PI / 180);
  const latRad = lat * (Math.PI / 180);
  const hour = date.getHours() + date.getMinutes() / 60;
  const hourAngle = (hour - 12) * 15 * (Math.PI / 180);
  const elevation = Math.asin(
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle)
  ) * (180 / Math.PI);
  return elevation;
}

interface SunTrackerContainerProps {
  lat?: number;
  className?: string;
}

export function SunTrackerContainer({ lat = -33.4489, className = '' }: SunTrackerContainerProps) {
  const { isDarkMode, isDayTime } = useTheme();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const hour = now.getHours();
  const solarState = SOLAR_STATES[hour] ?? SOLAR_STATES[0];
  const lunarPhase = getLunarPhase(now);
  const elevation = getSolarElevation(lat, now);
  const elevationPct = Math.max(0, Math.min(100, ((elevation + 90) / 180) * 100));

  const isLightTheme = !isDarkMode;
  const shouldUseDarkStyle = isLightTheme && !isDayTime;
  const shouldUseLightStyle = isDarkMode && isDayTime;

  const bgClass = shouldUseDarkStyle
    ? 'bg-gradient-to-b from-indigo-950 via-zinc-900 to-zinc-950 text-white'
    : shouldUseLightStyle
    ? 'bg-gradient-to-b from-amber-50 via-orange-50 to-yellow-50 text-amber-900'
    : isDayTime
    ? 'bg-gradient-to-b from-sky-100 via-blue-50 to-white text-sky-900 dark:from-sky-900 dark:via-zinc-800 dark:to-zinc-900 dark:text-sky-100'
    : 'bg-gradient-to-b from-indigo-900 via-zinc-900 to-zinc-950 text-indigo-100';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.7 }}
      className={`relative overflow-hidden rounded-2xl p-5 ${bgClass} ${className}`}
    >
      {/* Stars overlay when light theme at night */}
      <AnimatePresence>
        {shouldUseDarkStyle && (
          <motion.div
            key="stars"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 pointer-events-none"
          >
            {Array.from({ length: 20 }).map((_, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full bg-white"
                style={{
                  width: Math.random() > 0.7 ? 2 : 1,
                  height: Math.random() > 0.7 ? 2 : 1,
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 70}%`,
                }}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{
                  duration: 1.5 + Math.random() * 2.5,
                  repeat: Infinity,
                  delay: Math.random() * 3,
                }}
              />
            ))}
          </motion.div>
        )}

        {/* Amber glow overlay when dark theme at day */}
        {shouldUseLightStyle && (
          <motion.div
            key="glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="absolute inset-0 pointer-events-none"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full bg-amber-400/30 blur-xl"
                style={{
                  width: 60 + Math.random() * 80,
                  height: 60 + Math.random() * 80,
                  left: `${Math.random() * 80}%`,
                  top: `${Math.random() * 80}%`,
                }}
                animate={{ opacity: [0.2, 0.6, 0.2], scale: [0.9, 1.1, 0.9] }}
                transition={{
                  duration: 3 + Math.random() * 2,
                  repeat: Infinity,
                  delay: Math.random() * 3,
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="relative z-10">
        {/* Solar arc */}
        <div className="relative h-20 mb-4">
          <svg viewBox="0 0 200 60" className="w-full h-full" preserveAspectRatio="none">
            {/* Arc path */}
            <path
              d="M 10 55 Q 100 5 190 55"
              fill="none"
              stroke={shouldUseDarkStyle ? 'rgba(255,255,255,0.15)' : shouldUseLightStyle ? 'rgba(251,146,60,0.3)' : 'rgba(99,102,241,0.2)'}
              strokeWidth="1.5"
              strokeDasharray="4 2"
            />
            {/* Sun/Moon position on arc */}
            {(() => {
              const t = elevationPct / 100;
              // Quadratic Bezier point: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
              const x = (1 - t) * (1 - t) * 10 + 2 * (1 - t) * t * 100 + t * t * 190;
              const y = (1 - t) * (1 - t) * 55 + 2 * (1 - t) * t * 5 + t * t * 55;
              return (
                <g>
                  {isDayTime ? (
                    <>
                      <circle cx={x} cy={y} r="8" fill={shouldUseLightStyle ? '#f59e0b' : '#fbbf24'} opacity="0.9" />
                      <circle cx={x} cy={y} r="12" fill="#fbbf24" opacity="0.2" />
                    </>
                  ) : (
                    <circle cx={x} cy={y} r="7" fill="#c7d2fe" opacity="0.85" />
                  )}
                </g>
              );
            })()}
          </svg>
        </div>

        {/* State + time */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{solarState.emoji}</span>
              <span className="text-base font-semibold">{solarState.label}</span>
            </div>
            <p className="text-xs opacity-60">
              {now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} —{' '}
              {now.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>

          <div className="text-right">
            <span className="text-2xl">{lunarPhase.emoji}</span>
            <p className="text-xs opacity-60 mt-0.5">{lunarPhase.label}</p>
          </div>
        </div>

        {/* Elevation badge */}
        <div className="mt-3 flex items-center gap-2">
          {isDayTime ? (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-indigo-300" />
          )}
          <span className="text-xs opacity-60">
            Elevación solar: <strong>{elevation.toFixed(1)}°</strong>
          </span>
          {shouldUseDarkStyle && (
            <span className="ml-auto text-xs opacity-50 flex items-center gap-1">
              <Star className="w-3 h-3" /> Modo noche activo
            </span>
          )}
          {shouldUseLightStyle && (
            <span className="ml-auto text-xs opacity-60 flex items-center gap-1">
              <Sun className="w-3 h-3 text-amber-500" /> Día en modo oscuro
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
