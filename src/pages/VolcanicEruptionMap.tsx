import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mountain, Wind, AlertTriangle, MapPin, ShieldAlert, Navigation, Info } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function VolcanicEruptionMap() {
  const [volcanoLocation, setVolcanoLocation] = useState({ lat: -33.4, lng: -70.6, name: 'Volcán Activo' });
  const [windDirection, setWindDirection] = useState(45); // Degrees
  const [windSpeed, setWindSpeed] = useState(20); // km/h
  const [alertLevel, setAlertLevel] = useState<'yellow' | 'orange' | 'red'>('orange');

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'yellow': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'orange': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
      case 'red': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      default: return 'text-zinc-400 bg-zinc-800 border-white/10';
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Mountain className="w-8 h-8 text-orange-500" />
            Protocolo Volcánico
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Mapeo de Dispersión de Cenizas y Evacuación
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${getAlertColor(alertLevel)}`}>
          <AlertTriangle className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Alerta {alertLevel === 'yellow' ? 'Amarilla' : alertLevel === 'orange' ? 'Naranja' : 'Roja'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            Parámetros de Simulación
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Dirección del Viento (Grados)</label>
              <input
                type="range"
                min="0"
                max="360"
                value={windDirection}
                onChange={(e) => setWindDirection(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>N (0°)</span>
                <span className="font-bold text-blue-400">{windDirection}°</span>
                <span>N (360°)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Velocidad del Viento (km/h)</label>
              <input
                type="range"
                min="0"
                max="100"
                value={windSpeed}
                onChange={(e) => setWindSpeed(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>0 km/h</span>
                <span className="font-bold text-blue-400">{windSpeed} km/h</span>
                <span>100 km/h</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Nivel de Alerta SERNAGEOMIN</label>
              <div className="flex gap-2">
                <button onClick={() => setAlertLevel('yellow')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${alertLevel === 'yellow' ? 'bg-amber-400/20 text-amber-400 border-amber-400/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Amarilla</button>
                <button onClick={() => setAlertLevel('orange')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${alertLevel === 'orange' ? 'bg-orange-500/20 text-orange-500 border-orange-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Naranja</button>
                <button onClick={() => setAlertLevel('red')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${alertLevel === 'red' ? 'bg-rose-500/20 text-rose-500 border-rose-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Roja</button>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-orange-500" />
              Acciones Requeridas
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                <span>Uso obligatorio de mascarilla N95/FFP2 o superior.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                <span>Sellar tomas de aire de maquinaria pesada.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                <span>Evacuar zonas de riesgo de lahares (cauces de ríos).</span>
              </li>
            </ul>
          </div>
        </Card>

        {/* Map Visualization (Simulated) */}
        <Card className="p-0 border-white/5 lg:col-span-2 overflow-hidden relative min-h-[500px] bg-zinc-900 flex items-center justify-center">
          {/* Simulated Map Background */}
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: 'radial-gradient(circle at center, #3f3f46 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }} />

          {/* Volcano Marker */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative">
              <Mountain className="w-12 h-12 text-orange-500 drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
              <div className="absolute -top-2 -right-2 w-4 h-4 bg-rose-500 rounded-full animate-ping" />
            </div>
            <span className="mt-2 text-xs font-bold text-white bg-black/50 px-2 py-1 rounded backdrop-blur-sm">
              {volcanoLocation.name}
            </span>
          </div>

          {/* Ash Plume Simulation */}
          <motion.div 
            className="absolute top-1/2 left-1/2 origin-left z-0"
            style={{ 
              rotate: windDirection - 90, // Adjust for visual orientation
              width: `${windSpeed * 5}px`,
              height: `${windSpeed * 2}px`,
              background: 'linear-gradient(90deg, rgba(161,161,170,0.8) 0%, rgba(161,161,170,0) 100%)',
              filter: 'blur(20px)',
              borderRadius: '100px',
              transformOrigin: '0% 50%'
            }}
            animate={{
              opacity: [0.5, 0.8, 0.5],
              scaleY: [1, 1.2, 1]
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Exclusion Zones */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full border-2 border-rose-500/30 bg-rose-500/5 flex items-center justify-center">
            <div className="absolute top-4 text-[10px] font-bold text-rose-500/50 uppercase tracking-widest">Zona Exclusión (10km)</div>
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full border-2 border-orange-500/30 bg-orange-500/5 flex items-center justify-center">
             <div className="absolute top-4 text-[10px] font-bold text-orange-500/50 uppercase tracking-widest">Zona Precaución (20km)</div>
          </div>

          {/* Wind Indicator */}
          <div className="absolute bottom-6 left-6 bg-black/50 backdrop-blur-md border border-white/10 p-3 rounded-xl flex items-center gap-3">
            <div 
              className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center"
              style={{ transform: `rotate(${windDirection}deg)` }}
            >
              <Wind className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Viento</p>
              <p className="text-[10px] text-blue-400">{windSpeed} km/h a {windDirection}°</p>
            </div>
          </div>

          <div className="absolute top-6 right-6 bg-black/50 backdrop-blur-md border border-white/10 p-3 rounded-xl max-w-xs">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-300">
                El cono de dispersión de cenizas se calcula en tiempo real basándose en la dirección y velocidad del viento. Las zonas bajo la pluma deben suspender operaciones a la intemperie.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
