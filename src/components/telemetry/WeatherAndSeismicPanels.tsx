import { Activity, Wind, ThermometerSun, Clock, CloudLightning, WifiOff } from 'lucide-react';

export interface Earthquake {
  Fecha: string;
  Profundidad: string;
  Magnitud: string;
  RefGeografica: string;
  FechaUpdate: string;
}

interface WeatherShape {
  temp: number;
  /**
   * Wind speed in km/h. Optional because the upstream
   * `UniversalKnowledgeContext` exposes it as optional on `WeatherData`.
   */
  windSpeed?: number;
}

interface WeatherAndSeismicPanelsProps {
  loading: boolean;
  isOnline: boolean;
  weather: WeatherShape | null | undefined;
  earthquakes: Earthquake[];
}

/**
 * Two-column read-only block showing current climatic conditions
 * (Open-Meteo) and the latest five seismic events (CSN). Renders
 * a loading spinner while data is being fetched.
 */
export function WeatherAndSeismicPanels({
  loading,
  isOnline,
  weather,
  earthquakes,
}: WeatherAndSeismicPanelsProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Weather Panel */}
      <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
            <CloudLightning className="w-4 h-4 text-blue-400" />
            Condiciones Climáticas
          </h3>
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Open-Meteo API</span>
        </div>

        {weather ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
              <ThermometerSun className={`w-8 h-8 ${weather.temp > 30 ? 'text-rose-500' : 'text-amber-500'}`} />
              <div>
                <p className="text-2xl font-black text-white">{Math.round(weather.temp)}°C</p>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Temperatura</p>
              </div>
            </div>
            <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
              <Wind className={`w-8 h-8 ${(weather.windSpeed as number) > 40 ? 'text-rose-500' : 'text-blue-400'}`} />
              <div>
                <p className="text-2xl font-black text-white">{Math.round(weather.windSpeed as number)} <span className="text-sm">km/h</span></p>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Viento</p>
              </div>
            </div>
          </div>
        ) : !isOnline ? (
          <div className="flex flex-col items-center justify-center py-8 text-center bg-zinc-950/50 rounded-2xl border border-white/5">
            <WifiOff className="w-8 h-8 text-zinc-600 mb-2" />
            <p className="text-sm font-medium text-zinc-400">Sin conexión</p>
            <p className="text-xs text-zinc-500">No se pueden obtener datos climáticos en tiempo real.</p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No se pudo cargar la información climática.</p>
        )}
      </div>

      {/* Earthquakes Panel */}
      <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-500" />
            Monitor Sísmico (CSN)
          </h3>
          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Últimos 5 eventos</span>
        </div>

        <div className="space-y-3">
          {!isOnline ? (
            <div className="flex flex-col items-center justify-center py-8 text-center bg-zinc-950/50 rounded-2xl border border-white/5">
              <WifiOff className="w-8 h-8 text-zinc-600 mb-2" />
              <p className="text-sm font-medium text-zinc-400">Sin conexión</p>
              <p className="text-xs text-zinc-500">No se pueden obtener datos sísmicos en tiempo real.</p>
            </div>
          ) : earthquakes.length > 0 ? (
            earthquakes.map((eq, i) => (
              <div key={i} className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg ${
                    parseFloat(eq.Magnitud) >= 5.0 ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30' :
                    parseFloat(eq.Magnitud) >= 4.0 ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>
                    {eq.Magnitud}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{eq.RefGeografica}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span className="text-[10px] font-medium text-zinc-500">{eq.Fecha}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Profundidad</p>
                  <p className="text-xs font-medium text-zinc-300">{eq.Profundidad} km</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">No se pudo cargar la información sísmica.</p>
          )}
        </div>
      </div>
    </div>
  );
}
