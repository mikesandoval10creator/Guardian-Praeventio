import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Wind, AlertTriangle, MapPin, Navigation, Info, Droplet } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function HazmatMap() {
  const [incidentLocation, setIncidentLocation] = useState({ lat: -33.4, lng: -70.6, name: 'Planta Química' });
  const [windDirection, setWindDirection] = useState(120); // Degrees
  const [windSpeed, setWindSpeed] = useState(15); // km/h
  const [chemicalType, setChemicalType] = useState<'gas' | 'liquid'>('gas');
  const [spillSize, setSpillSize] = useState<'small' | 'large'>('large');

  const isolationDistance = spillSize === 'small' ? 30 : 60; // meters
  const protectionDistance = spillSize === 'small' ? 100 : 300; // meters

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Droplet className="w-8 h-8 text-violet-500" />
            Mapeo Hazmat
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Radio de Exposición y Evacuación GRE
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border text-violet-500 bg-violet-500/10 border-violet-500/20 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Protocolo Activo
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-500" />
            Parámetros del Incidente
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Tipo de Sustancia</label>
              <div className="flex gap-2">
                <button onClick={() => setChemicalType('gas')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${chemicalType === 'gas' ? 'bg-violet-500/20 text-violet-400 border-violet-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Gas Tóxico</button>
                <button onClick={() => setChemicalType('liquid')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${chemicalType === 'liquid' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Líquido Inflamable</button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Tamaño del Derrame</label>
              <div className="flex gap-2">
                <button onClick={() => setSpillSize('small')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${spillSize === 'small' ? 'bg-amber-500/20 text-amber-400 border-amber-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Pequeño</button>
                <button onClick={() => setSpillSize('large')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${spillSize === 'large' ? 'bg-rose-500/20 text-rose-400 border-rose-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Grande</button>
              </div>
            </div>

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
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-violet-500" />
              Distancias GRE (Aprox)
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-center justify-between">
                <span>Aislamiento Inicial:</span>
                <span className="font-bold text-rose-400">{isolationDistance} m</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Acción Protectora (Día):</span>
                <span className="font-bold text-orange-400">{protectionDistance} m</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Acción Protectora (Noche):</span>
                <span className="font-bold text-orange-400">{protectionDistance * 2.5} m</span>
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

          {/* Incident Marker */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center">
            <div className="relative">
              <Droplet className="w-8 h-8 text-violet-500 drop-shadow-[0_0_15px_rgba(139,92,246,0.5)]" />
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full animate-ping" />
            </div>
            <span className="mt-2 text-xs font-bold text-white bg-black/50 px-2 py-1 rounded backdrop-blur-sm">
              {incidentLocation.name}
            </span>
          </div>

          {/* Toxic Plume Simulation */}
          <motion.div 
            className="absolute top-1/2 left-1/2 origin-left z-0"
            style={{ 
              rotate: windDirection - 90, // Adjust for visual orientation
              width: `${protectionDistance}px`,
              height: `${protectionDistance * 0.4}px`,
              background: chemicalType === 'gas' ? 'linear-gradient(90deg, rgba(139,92,246,0.4) 0%, rgba(139,92,246,0) 100%)' : 'linear-gradient(90deg, rgba(16,185,129,0.4) 0%, rgba(16,185,129,0) 100%)',
              filter: 'blur(10px)',
              borderRadius: '100px',
              transformOrigin: '0% 50%'
            }}
            animate={{
              opacity: [0.4, 0.6, 0.4],
              scaleY: [1, 1.1, 1]
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Isolation Zone */}
          <div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rose-500/50 bg-rose-500/10 flex items-center justify-center transition-all duration-500"
            style={{ width: isolationDistance * 2, height: isolationDistance * 2 }}
          >
            <div className="absolute top-2 text-[8px] font-bold text-rose-500/70 uppercase tracking-widest">Aislamiento</div>
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
                Basado en la Guía de Respuesta a Emergencias (GRE). El cono muestra la zona de acción protectora a favor del viento.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
