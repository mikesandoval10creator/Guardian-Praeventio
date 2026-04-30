import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cloud, Droplets, Wind, Thermometer, Sun, Moon, MapPin, AlertTriangle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useProject } from '../contexts/ProjectContext';
import { fetchWeatherData } from '../services/orchestratorService';
import { WeatherData } from '../types';

interface WeatherBulletinProps {
  className?: string;
  compact?: boolean;
}

// Particles for cross-inversion states
function StarParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
      {Array.from({ length: 12 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 bg-white rounded-full"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
          }}
          animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
          transition={{
            duration: 2 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 2,
          }}
        />
      ))}
    </div>
  );
}

function AmberParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 bg-amber-400/60 rounded-full blur-sm"
          style={{
            left: `${10 + Math.random() * 80}%`,
            top: `${10 + Math.random() * 80}%`,
          }}
          animate={{ opacity: [0.3, 0.8, 0.3], y: [0, -8, 0] }}
          transition={{
            duration: 3 + Math.random() * 2,
            repeat: Infinity,
            delay: Math.random() * 3,
          }}
        />
      ))}
    </div>
  );
}

function getConditionIcon(condition: string, isDayTime: boolean) {
  const lower = condition.toLowerCase();
  if (lower.includes('lluvia') || lower.includes('rain') || lower.includes('llovizna')) return '🌧️';
  if (lower.includes('nube') || lower.includes('cloud') || lower.includes('nublado')) return isDayTime ? '⛅' : '☁️';
  if (lower.includes('niebla') || lower.includes('fog') || lower.includes('neblina')) return '🌫️';
  if (lower.includes('nieve') || lower.includes('snow')) return '❄️';
  if (lower.includes('tormenta') || lower.includes('thunder')) return '⛈️';
  if (lower.includes('despejado') || lower.includes('clear')) return isDayTime ? '☀️' : '🌙';
  return isDayTime ? '🌤️' : '🌙';
}

export function WeatherBulletin({ className = '', compact = false }: WeatherBulletinProps) {
  const { isDarkMode, isDayTime } = useTheme();
  const { selectedProject } = useProject();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  // Cross-inversion logic from proto 1
  const isLightTheme = !isDarkMode;
  const shouldUseDarkStyle = isLightTheme && !isDayTime;   // light theme at night → dark stars
  const shouldUseLightStyle = isDarkMode && isDayTime;      // dark theme at day → amber glow

  useEffect(() => {
    const lat = selectedProject?.coordinates?.lat ?? -33.4489;
    const lon = selectedProject?.coordinates?.lng ?? -70.6693;
    setLoading(true);
    fetchWeatherData(lat, lon)
      .then(setWeather)
      .finally(() => setLoading(false));

    // Refresh every 10 minutes
    const interval = setInterval(() => {
      fetchWeatherData(lat, lon).then(setWeather);
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedProject?.id]);

  const containerClass = shouldUseDarkStyle
    ? 'bg-zinc-900/95 text-white border-zinc-700'
    : shouldUseLightStyle
    ? 'bg-amber-50/95 text-amber-900 border-amber-200'
    : 'bg-white/80 dark:bg-zinc-800/80 text-zinc-800 dark:text-white border-zinc-200 dark:border-zinc-700';

  if (loading) {
    return (
      <div className={`relative rounded-2xl border p-4 backdrop-blur-sm ${containerClass} ${className}`}>
        <div className="flex items-center gap-2 animate-pulse">
          <Cloud className="w-5 h-5 opacity-50" />
          <span className="text-sm opacity-50">Cargando boletín climático…</span>
        </div>
      </div>
    );
  }

  if (!weather) return null;

  const sunriseTime = weather.sunrise ? new Date(weather.sunrise).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : null;
  const sunsetTime = weather.sunset ? new Date(weather.sunset).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : null;

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative rounded-2xl border p-3 backdrop-blur-sm transition-all duration-700 ${containerClass} ${className}`}
      >
        {shouldUseDarkStyle && <StarParticles />}
        {shouldUseLightStyle && <AmberParticles />}
        <div className="relative z-10 flex items-center gap-3">
          <span className="text-2xl">{getConditionIcon(weather.condition, isDayTime)}</span>
          <div>
            <p className="text-lg font-bold">{weather.temp}°C</p>
            <p className="text-xs opacity-70 capitalize">{weather.condition}</p>
          </div>
          <div className="ml-auto text-right">
            <div className="flex items-center gap-1 text-xs opacity-70">
              <Droplets className="w-3 h-3" />
              <span>{weather.humidity}%</span>
            </div>
            <div className="flex items-center gap-1 text-xs opacity-70">
              <Wind className="w-3 h-3" />
              <span>{Math.round(weather.windSpeed)} km/h</span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-2xl border p-5 backdrop-blur-sm transition-all duration-700 ${containerClass} ${className}`}
    >
      {shouldUseDarkStyle && <StarParticles />}
      {shouldUseLightStyle && <AmberParticles />}

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs opacity-60 mb-1">
              <MapPin className="w-3 h-3" />
              <span>{weather.location || selectedProject?.name || 'Santiago, Chile'}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-4xl">{getConditionIcon(weather.condition, isDayTime)}</span>
              <div>
                <p className="text-3xl font-bold">{weather.temp}°C</p>
                <p className="text-sm opacity-70 capitalize">{weather.condition}</p>
              </div>
            </div>
          </div>

          {/* Day/Night indicator */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            isDayTime
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
              : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
          }`}>
            {isDayTime ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
            <span>{isDayTime ? 'Día' : 'Noche'}</span>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="flex items-center gap-2 text-sm opacity-75">
            <Droplets className="w-4 h-4 text-blue-400" />
            <span>Humedad: <strong>{weather.humidity}%</strong></span>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-75">
            <Wind className="w-4 h-4 text-teal-400" />
            <span>Viento: <strong>{Math.round(weather.windSpeed)} km/h</strong></span>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-75">
            <Thermometer className="w-4 h-4 text-orange-400" />
            <span>UV: <strong>{weather.uv}</strong></span>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-75">
            <Cloud className="w-4 h-4 text-gray-400" />
            <span>Aire: <strong>{weather.airQuality}</strong></span>
          </div>
        </div>

        {/* Sunrise/Sunset */}
        {(sunriseTime || sunsetTime) && (
          <div className="flex gap-4 text-xs opacity-60 mb-3">
            {sunriseTime && (
              <span className="flex items-center gap-1">
                <Sun className="w-3 h-3 text-amber-400" />
                {sunriseTime}
              </span>
            )}
            {sunsetTime && (
              <span className="flex items-center gap-1">
                <Moon className="w-3 h-3 text-indigo-400" />
                {sunsetTime}
              </span>
            )}
          </div>
        )}

        {/* OHS Recommendations */}
        {weather.recommendations && weather.recommendations.length > 0 && (
          <div className={`rounded-lg p-2.5 text-xs ${
            shouldUseDarkStyle ? 'bg-white/10' : shouldUseLightStyle ? 'bg-amber-100/70' : 'bg-zinc-100 dark:bg-zinc-700/50'
          }`}>
            <div className="flex items-center gap-1.5 mb-1.5 font-medium opacity-80">
              <AlertTriangle className="w-3 h-3" />
              <span>Recomendaciones de seguridad</span>
            </div>
            <ul className="space-y-1 opacity-70">
              {weather.recommendations.slice(0, 2).map((rec, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="mt-0.5 shrink-0">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </motion.div>
  );
}
