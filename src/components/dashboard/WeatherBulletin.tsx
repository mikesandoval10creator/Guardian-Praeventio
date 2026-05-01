// Praeventio Guard — Boletín climático widget extracted from Dashboard.tsx (A11 R18).
//
// Pure presentational. Receives `weather` (and loading state) via props; the
// parent owns data-fetching via UniversalKnowledgeContext.

import {
  Map, Sun, Moon, Wind, Droplets, AlertTriangle, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { Skeleton } from '../shared/Skeleton';

export interface WeatherSnapshot {
  temp?: number;
  windSpeed?: number;
  condition?: string;
  humidity?: number;
  sunrise?: number;
  sunset?: number;
}

interface WeatherBulletinProps {
  weather: WeatherSnapshot | undefined;
  loading: boolean;
}

export function WeatherBulletin({ weather, loading }: WeatherBulletinProps) {
  return (
    <section className="bg-[#bbf7d0] dark:bg-emerald-900/20 rounded-xl sm:rounded-2xl p-1.5 sm:p-5 shadow-sm relative overflow-hidden border border-emerald-500/10">
      <div className="flex flex-col sm:flex-row justify-between gap-1.5 sm:gap-5 relative z-10">
        <div className="flex-1">
          <div className="flex justify-between items-start mb-1.5 sm:mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[10px] sm:text-base font-black text-zinc-900 dark:text-emerald-50 tracking-tight leading-none uppercase">Boletín climático</h2>
              <p className="text-[8px] sm:text-xs text-zinc-600 dark:text-emerald-200/70 flex items-center gap-1">
                <Map className="w-2.5 h-2.5 sm:w-4 sm:h-4" /> Santiago
              </p>
            </div>
            <RefreshCw
              className={`w-3 h-3 sm:w-5 sm:h-5 text-zinc-500 dark:text-emerald-400 cursor-pointer ${loading ? 'animate-spin' : ''}`}
            />
          </div>

          <div className="flex flex-row items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex w-12 h-12 sm:w-14 sm:h-14 bg-emerald-100 dark:bg-emerald-800/50 rounded-full items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              {weather && weather.sunrise && weather.sunset && (new Date().getTime() > weather.sunrise && new Date().getTime() < weather.sunset) ? <Sun className="w-7 h-7 sm:w-8 sm:h-8" /> : <Moon className="w-7 h-7 sm:w-8 sm:h-8" />}
            </div>

            {loading ? (
              <div className="grid grid-cols-4 gap-1 sm:gap-3 flex-1 w-full">
                <Skeleton className="h-8 sm:h-16 w-full rounded-lg sm:rounded-xl" />
                <Skeleton className="h-8 sm:h-16 w-full rounded-lg sm:rounded-xl" />
                <Skeleton className="h-8 sm:h-16 w-full rounded-lg sm:rounded-xl" />
                <Skeleton className="h-8 sm:h-16 w-full rounded-lg sm:rounded-xl" />
              </div>
            ) : weather ? (
              <div className="grid grid-cols-4 gap-1 sm:gap-3 flex-1 w-full">
                <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                  <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Temp</span>
                  <span className="text-xs sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none mt-0.5 sm:mt-1">{Math.round(weather.temp ?? 0)}°C</span>
                </div>
                <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                  <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Condición</span>
                  <span className="text-[9px] sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none truncate mt-0.5 sm:mt-1 max-w-full" title={weather.condition}>{weather.condition}</span>
                </div>
                <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                  <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Viento</span>
                  <span className="text-xs sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none mt-0.5 sm:mt-1">{Math.round(weather.windSpeed || 0)} <span className="text-[6px] sm:text-xs">km/h</span></span>
                </div>
                <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                  <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Humedad</span>
                  <span className="text-xs sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none mt-0.5 sm:mt-1">{weather.humidity}%</span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] sm:text-sm text-zinc-500">Cargando...</p>
            )}
          </div>

          <div className="flex flex-wrap gap-1 mt-1.5 sm:mt-4">
            {weather?.windSpeed && weather.windSpeed > 40 && (
              <span className="flex items-center gap-1 bg-rose-100 dark:bg-rose-500 text-rose-600 dark:text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                <Wind className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Alerta Viento
              </span>
            )}
            {weather?.temp && weather.temp > 30 && (
              <span className="flex items-center gap-1 bg-rose-100 dark:bg-rose-500 text-rose-600 dark:text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                <AlertTriangle className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Estrés Térmico
              </span>
            )}
            {String(weather?.condition || '').toLowerCase().includes('lluvia') && (
              <span className="flex items-center gap-1 bg-blue-100 dark:bg-blue-500 text-blue-600 dark:text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                <Droplets className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Lluvia
              </span>
            )}
            {weather?.temp && weather.temp <= 30 && (!weather.windSpeed || weather.windSpeed <= 40) && (!String(weather?.condition || '').toLowerCase().includes('lluvia')) && (
              <span className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-500 text-emerald-600 dark:text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                <CheckCircle2 className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Óptimo
              </span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex w-full sm:w-[120px] shrink-0 sm:border-l border-t sm:border-t-0 border-emerald-500/10 pt-2 sm:pt-0 sm:pl-4 flex-col justify-center relative">
          <div className="flex justify-between text-[9px] sm:text-xs font-bold text-zinc-500 dark:text-emerald-400/70 mb-1 sm:mb-2">
            <span>{weather?.sunrise ? new Date(weather.sunrise).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '07:00'}</span>
            <span>{weather?.sunset ? new Date(weather.sunset).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '19:00'}</span>
          </div>
          <div className="relative w-full h-6 sm:h-12 overflow-visible mt-1 sm:mt-2">
            <svg viewBox="-5 -5 110 60" className="w-full h-full overflow-visible">
              <path d="M 0 50 A 50 50 0 0 1 100 50" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500/20" strokeDasharray="4 2" />
              {weather && (
                <circle
                  cx={(() => {
                    const now = new Date().getTime();
                    const sunrise = weather.sunrise || new Date().setHours(7, 0, 0, 0);
                    const sunset = weather.sunset || new Date().setHours(19, 0, 0, 0);

                    if (now < sunrise) return 0;
                    if (now > sunset) return 100;

                    const progress = (now - sunrise) / (sunset - sunrise);
                    return progress * 100;
                  })()}
                  cy={(() => {
                    const now = new Date().getTime();
                    const sunrise = weather.sunrise || new Date().setHours(7, 0, 0, 0);
                    const sunset = weather.sunset || new Date().setHours(19, 0, 0, 0);

                    if (now < sunrise) return 50;
                    if (now > sunset) return 50;

                    const progress = (now - sunrise) / (sunset - sunrise);
                    const x = progress * 100;
                    return 50 - Math.sqrt(2500 - Math.pow(x - 50, 2));
                  })()}
                  r="6"
                  className="fill-amber-500"
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
