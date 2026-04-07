import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { TreePine, Map, ShieldAlert, AlertTriangle, Info, Droplet, CloudSnow, Sun, CloudLightning, ThermometerSnowflake, Wind } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function NationalParksEmergency() {
  const [incidentType, setIncidentType] = useState<'fire' | 'spill'>('spill');
  const [parkStatus, setParkStatus] = useState<'open' | 'restricted' | 'closed'>('restricted');

  // Simulated 3-day forecast
  const forecast = [
    { day: 'Hoy', temp: -2, condition: 'Nieve', icon: CloudSnow, risk: 'Hielo Negro', riskLevel: 'high' },
    { day: 'Mañana', temp: 5, condition: 'Despejado', icon: Sun, risk: 'Deshielo/Resbalones', riskLevel: 'medium' },
    { day: 'Día 3', temp: -5, condition: 'Tormenta', icon: CloudLightning, risk: 'Cierre Inminente', riskLevel: 'critical' }
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <TreePine className="w-8 h-8 text-emerald-500" />
            Parques Nacionales
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Gestión de Emergencias y Clima Predictivo
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${parkStatus === 'closed' ? 'text-rose-500 bg-rose-500/10 border-rose-500/20' : 'text-amber-500 bg-amber-500/10 border-amber-500/20'}`}>
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {parkStatus === 'closed' ? 'Parque Cerrado' : 'Acceso Restringido'}
          </span>
        </div>
      </div>

      {/* Predictive Weather Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {forecast.map((day, idx) => {
          const Icon = day.icon;
          return (
            <motion.div 
              key={day.day}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-zinc-900 border border-white/10 rounded-2xl p-5 relative overflow-hidden group hover:border-emerald-500/30 transition-colors"
            >
              {/* Background gradient based on temp */}
              <div className={`absolute inset-0 opacity-10 ${day.temp < 0 ? 'bg-gradient-to-br from-blue-500 to-cyan-500' : 'bg-gradient-to-br from-amber-500 to-orange-500'}`} />
              
              <div className="relative z-10 flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">{day.day}</h3>
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mt-1">{day.condition}</p>
                </div>
                <Icon className={`w-8 h-8 ${day.temp < 0 ? 'text-blue-400' : 'text-amber-400'}`} />
              </div>
              
              <div className="relative z-10 flex items-end justify-between">
                <div className="flex items-start">
                  <span className="text-3xl font-black text-white tracking-tighter">{day.temp}</span>
                  <span className="text-sm font-bold text-zinc-500 mt-1">°C</span>
                </div>
                
                <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                  day.riskLevel === 'critical' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                  day.riskLevel === 'high' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                }`}>
                  {day.riskLevel === 'critical' ? <AlertTriangle className="w-3 h-3" /> : <ThermometerSnowflake className="w-3 h-3" />}
                  {day.risk}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-emerald-500" />
            Tipo de Incidente
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Clasificación</label>
              <div className="flex gap-2">
                <button onClick={() => setIncidentType('spill')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${incidentType === 'spill' ? 'bg-violet-500/20 text-violet-400 border-violet-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Derrame Hazmat</button>
                <button onClick={() => setIncidentType('fire')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${incidentType === 'fire' ? 'bg-orange-500/20 text-orange-400 border-orange-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Incendio Forestal</button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Estado del Parque (CONAF)</label>
              <div className="flex gap-2">
                <button onClick={() => setParkStatus('open')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${parkStatus === 'open' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Abierto</button>
                <button onClick={() => setParkStatus('restricted')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${parkStatus === 'restricted' ? 'bg-amber-500/20 text-amber-400 border-amber-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Restringido</button>
                <button onClick={() => setParkStatus('closed')} className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border ${parkStatus === 'closed' ? 'bg-rose-500/20 text-rose-400 border-rose-500/50' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}>Cerrado</button>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-500" />
              Protocolos Ambientales
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              {incidentType === 'spill' ? (
                <>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                    <span>Contención inmediata para evitar filtración a napas subterráneas.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                    <span>Notificar a CONAF y Ministerio de Medio Ambiente.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                    <span>Prohibido el uso de dispersantes químicos sin autorización.</span>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                    <span>Evacuación inmediata de visitantes y guardaparques.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                    <span>Establecer cortafuegos respetando especies endémicas si es posible.</span>
                  </li>
                </>
              )}
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

          {/* Park Geofence */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-3xl border-4 border-emerald-500/30 bg-emerald-500/5 flex items-center justify-center rotate-12">
            <div className="absolute top-4 text-[10px] font-bold text-emerald-500/50 uppercase tracking-widest -rotate-12">Límite Parque Nacional</div>
          </div>

          {/* Incident Marker */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center ml-10 mt-10">
            <div className="relative">
              {incidentType === 'spill' ? (
                <Droplet className="w-8 h-8 text-violet-500 drop-shadow-[0_0_15px_rgba(139,92,246,0.5)]" />
              ) : (
                <AlertTriangle className="w-8 h-8 text-orange-500 drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
              )}
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full animate-ping" />
            </div>
            <span className="mt-2 text-xs font-bold text-white bg-black/50 px-2 py-1 rounded backdrop-blur-sm">
              Zona Cero
            </span>
          </div>

          {/* Impact Zone */}
          <motion.div 
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full z-0 ml-10 mt-10"
            style={{ 
              width: incidentType === 'spill' ? '150px' : '250px',
              height: incidentType === 'spill' ? '150px' : '250px',
              background: incidentType === 'spill' ? 'radial-gradient(circle, rgba(139,92,246,0.4) 0%, rgba(139,92,246,0) 70%)' : 'radial-gradient(circle, rgba(249,115,22,0.4) 0%, rgba(249,115,22,0) 70%)',
            }}
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.5, 0.8, 0.5]
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="absolute top-6 right-6 bg-black/50 backdrop-blur-md border border-white/10 p-3 rounded-xl max-w-xs">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-300">
                Las emergencias dentro de áreas silvestres protegidas tienen implicancias legales severas. Se debe priorizar la contención para evitar daño a la flora y fauna endémica.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
