import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Battery, Droplets, ThermometerSun, Mountain, Hammer, AlertTriangle } from 'lucide-react';
import { Card } from '../shared/Card';
import { diagnoses } from '../../data/medical';

// Sprint 21 — Bucket R · Mapeo offline-first condición ambiental → CIE-10 relevantes.
// Pre-filtramos el catálogo por agente de riesgo conocido (sin llamadas a IA).
// TODO Ola 5b — wire con health facade Bucket P para vitales reales.
const RISK_AGENT_KEYWORDS: Record<string, RegExp> = {
  heat: /calor|sol|temperatura/i,
  altitude: /altit|altura|hipoxia/i,
  load: /levantamiento|manual|carga|vibrac/i,
};
const findRelatedDiagnoses = (agent: keyof typeof RISK_AGENT_KEYWORDS) => {
  const re = RISK_AGENT_KEYWORDS[agent];
  return diagnoses
    .filter((d) => d.riskAgents.some((r) => re.test(r)) || re.test(d.description))
    .slice(0, 3);
};

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

  // Diagnósticos potenciales según condición ambiental (catálogo CIE-10 SST).
  const environmentalAlerts = useMemo(() => {
    const alerts: Array<{ trigger: string; diagnoses: typeof diagnoses }> = [];
    if (temperature > 30) alerts.push({ trigger: `Calor ${temperature}°C`, diagnoses: findRelatedDiagnoses('heat') });
    if (altitude > 2500) alerts.push({ trigger: `Altitud ${altitude}m`, diagnoses: findRelatedDiagnoses('altitude') });
    if (toolWeight > 10) alerts.push({ trigger: `Carga ${toolWeight}kg`, diagnoses: findRelatedDiagnoses('load') });
    return alerts;
  }, [temperature, altitude, toolWeight]);

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

      {/* Sprint 21 — Bucket R · Diagnósticos potenciales por exposición ambiental. */}
      {environmentalAlerts.length > 0 && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            Riesgos clínicos asociados (CIE-10)
          </p>
          {environmentalAlerts.map((a) => (
            <div key={a.trigger} className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-300">{a.trigger}</p>
              <ul className="space-y-0.5 pl-2">
                {a.diagnoses.length === 0 ? (
                  <li className="text-[10px] text-zinc-500 italic">Sin diagnósticos catalogados.</li>
                ) : (
                  a.diagnoses.map((d) => (
                    <li key={d.code} className="text-[10px] text-zinc-400">
                      <span className="font-mono text-violet-400">{d.code}</span> — {d.name}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
          <p className="text-[9px] text-zinc-500 italic pt-1">
            Mapeo orientativo offline. NO sustituye juicio clínico.
          </p>
        </div>
      )}

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
