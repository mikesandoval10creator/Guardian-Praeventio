import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mountain, MapPin, Navigation, AlertTriangle, Wind, ThermometerSnowflake, ShieldAlert, Info } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function MountainRefuges() {
  const [userLocation, setUserLocation] = useState({ lat: -33.4, lng: -70.6 });
  const [weatherCondition, setWeatherCondition] = useState<'clear' | 'blizzard' | 'storm'>('blizzard');
  const [temperature, setTemperature] = useState(-15);

  const refuges = [
    { id: 1, name: 'Refugio Alfa', distance: 2.5, capacity: 20, current: 5, supplies: 'high', status: 'open' },
    { id: 2, name: 'Refugio Beta', distance: 5.1, capacity: 15, current: 15, supplies: 'low', status: 'full' },
    { id: 3, name: 'Refugio Gamma', distance: 8.3, capacity: 30, current: 0, supplies: 'high', status: 'open' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Mountain className="w-8 h-8 text-blue-500" />
            Refugios de Montaña
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Gestión de Supervivencia en Alta Montaña
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${weatherCondition === 'blizzard' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20' : 'text-zinc-400 bg-zinc-800 border-white/10'}`}>
          <ThermometerSnowflake className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {temperature}°C - {weatherCondition === 'blizzard' ? 'Tormenta Blanca' : 'Despejado'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            Condiciones de Ruta
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Clima Actual</label>
              <div className="flex gap-2">
                <button onClick={() => setWeatherCondition('clear')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${weatherCondition === 'clear' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Despejado</button>
                <button onClick={() => setWeatherCondition('blizzard')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${weatherCondition === 'blizzard' ? 'bg-blue-500/20 text-blue-400 border-blue-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Tormenta</button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Temperatura (°C)</label>
              <input
                type="range"
                min="-40"
                max="10"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>-40°C</span>
                <span className="font-bold text-blue-400">{temperature}°C</span>
                <span>10°C</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-blue-500" />
              Protocolo Activo
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              {weatherCondition === 'blizzard' ? (
                <>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                    <span className="text-rose-400 font-bold">Prohibición total de tránsito a la intemperie.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <span>Dirigirse al refugio más cercano inmediatamente.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                    <span>Activar baliza de supervivencia si la visibilidad es nula.</span>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <span>Tránsito permitido con precaución.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <span>Mantener comunicación radial cada 30 mins.</span>
                  </li>
                </>
              )}
            </ul>
          </div>
        </Card>

        {/* Map and Refuges List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Simulated Map */}
          <Card className="p-0 border-white/5 overflow-hidden relative h-64 bg-zinc-900 flex items-center justify-center">
            {/* Simulated Map Background */}
            <div className="absolute inset-0 opacity-20" style={{
              backgroundImage: 'radial-gradient(circle at center, #3f3f46 1px, transparent 1px)',
              backgroundSize: '20px 20px'
            }} />

            {/* User Location */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
              <div className="relative">
                <MapPin className="w-6 h-6 text-emerald-500 drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
              </div>
              <span className="mt-1 text-[10px] font-bold text-white bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm">
                Tú
              </span>
            </div>

            {/* Refuges on Map */}
            {refuges.map((refuge, index) => {
              // Calculate a simulated position based on distance
              const angle = (index * 120) * (Math.PI / 180);
              const radius = refuge.distance * 15; // Scale factor
              const left = `calc(50% + ${Math.cos(angle) * radius}px)`;
              const top = `calc(50% + ${Math.sin(angle) * radius}px)`;

              return (
                <div key={refuge.id} className="absolute z-10 flex flex-col items-center" style={{ left, top, transform: 'translate(-50%, -50%)' }}>
                  <Mountain className={`w-5 h-5 ${refuge.status === 'full' ? 'text-rose-500' : 'text-blue-500'}`} />
                  <span className="mt-1 text-[8px] font-bold text-white bg-black/50 px-1 py-0.5 rounded backdrop-blur-sm">
                    {refuge.name}
                  </span>
                </div>
              );
            })}

            {/* Blizzard Overlay */}
            {weatherCondition === 'blizzard' && (
              <motion.div 
                className="absolute inset-0 z-20 pointer-events-none"
                style={{
                  background: 'linear-gradient(45deg, rgba(255,255,255,0.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 75%, transparent 75%, transparent)',
                  backgroundSize: '20px 20px'
                }}
                animate={{ backgroundPosition: ['0px 0px', '20px 20px'] }}
                transition={{ duration: 0.5, repeat: Infinity, ease: "linear" }}
              />
            )}
          </Card>

          {/* Refuges List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {refuges.sort((a, b) => a.distance - b.distance).map(refuge => (
              <Card key={refuge.id} className={`p-4 border-white/5 ${refuge.status === 'full' ? 'opacity-50' : ''}`}>
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Mountain className={`w-4 h-4 ${refuge.status === 'full' ? 'text-rose-500' : 'text-blue-500'}`} />
                    {refuge.name}
                  </h3>
                  <span className="text-xs font-bold text-zinc-400">{refuge.distance} km</span>
                </div>
                
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-zinc-400">
                    <span>Ocupación:</span>
                    <span className={refuge.current >= refuge.capacity ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                      {refuge.current} / {refuge.capacity}
                    </span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Suministros:</span>
                    <span className={refuge.supplies === 'high' ? 'text-emerald-400' : 'text-rose-400'}>
                      {refuge.supplies === 'high' ? 'Óptimos' : 'Críticos'}
                    </span>
                  </div>
                </div>

                <Button 
                  className="w-full mt-4 text-xs py-2" 
                  variant={refuge.status === 'full' ? 'secondary' : 'primary'}
                  disabled={refuge.status === 'full'}
                >
                  {refuge.status === 'full' ? 'Refugio Lleno' : 'Navegar a Refugio'}
                </Button>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
