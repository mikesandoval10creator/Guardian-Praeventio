import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Battery, Droplets, ThermometerSun, Mountain, Hammer } from 'lucide-react';
import { Card } from '../shared/Card';

export function VitalityMonitor() {
  const [temperature, setTemperature] = useState(25);
  const [altitude, setAltitude] = useState(1000); // meters
  const [toolWeight, setToolWeight] = useState(5); // kg
  const [vitality, setVitality] = useState(100);
  const [hydrationNeeded, setHydrationNeeded] = useState(false);

  useEffect(() => {
    // Calculate vitality drain based on environmental factors
    // Base drain is 10% per hour.
    // High temp (>30C) adds drain.
    // High altitude (>2500m) adds drain.
    // Heavy tools (>10kg) adds drain.
    
    let drainRate = 10; 
    if (temperature > 30) drainRate += (temperature - 30) * 2;
    if (altitude > 2500) drainRate += (altitude - 2500) / 100;
    if (toolWeight > 10) drainRate += (toolWeight - 10) * 1.5;

    // Simulate vitality dropping over a "shift" (accelerated for demo)
    const interval = setInterval(() => {
      setVitality(prev => {
        const next = Math.max(0, prev - (drainRate / 60)); // drain per minute simulated
        if (next < 40) setHydrationNeeded(true);
        return next;
      });
    }, 1000); // Update every second for demo purposes

    return () => clearInterval(interval);
  }, [temperature, altitude, toolWeight]);

  const handleHydrate = () => {
    setVitality(Math.min(100, vitality + 30));
    setHydrationNeeded(false);
  };

  const getBatteryColor = () => {
    if (vitality > 70) return 'text-emerald-500 bg-emerald-500';
    if (vitality > 40) return 'text-yellow-500 bg-yellow-500';
    return 'text-rose-500 bg-rose-500';
  };

  return (
    <Card className="p-6 border-white/5 space-y-6 relative overflow-hidden">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Battery className={`w-5 h-5 ${getBatteryColor().split(' ')[0]}`} />
            Monitor de Vitalidad
          </h3>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
            Energía y Desgaste Físico
          </p>
        </div>
        <div className="text-right">
          <span className={`text-2xl font-black ${getBatteryColor().split(' ')[0]}`}>
            {Math.round(vitality)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
            <ThermometerSun className="w-3 h-3" /> Temp (°C)
          </label>
          <input 
            type="number" 
            value={temperature} 
            onChange={e => setTemperature(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
            <Mountain className="w-3 h-3" /> Altitud (m)
          </label>
          <input 
            type="number" 
            value={altitude} 
            onChange={e => setAltitude(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-1">
            <Hammer className="w-3 h-3" /> Carga (kg)
          </label>
          <input 
            type="number" 
            value={toolWeight} 
            onChange={e => setToolWeight(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-white"
          />
        </div>
      </div>

      <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
        <motion.div 
          className={`h-full ${getBatteryColor().split(' ')[1]}`}
          animate={{ width: `${vitality}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {hydrationNeeded && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-between"
        >
          <div className="flex items-center gap-2 text-blue-400">
            <Droplets className="w-4 h-4 shrink-0" />
            <p className="text-xs font-bold">¡Receso de hidratación sugerido!</p>
          </div>
          <button 
            onClick={handleHydrate}
            className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors"
          >
            Hidratar
          </button>
        </motion.div>
      )}
    </Card>
  );
}
