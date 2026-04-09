import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sun, CloudLightning, AlertTriangle, ThermometerSun, ShieldAlert, Info, Clock, Users, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';

export function SunTracker() {
  const [uvIndex, setUvIndex] = useState(8);
  const [temperature, setTemperature] = useState(28);
  const [timeOfDay, setTimeOfDay] = useState(12); // 0-24
  const [cloudCover, setCloudCover] = useState(20); // 0-100%
  
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { addNode } = useRiskEngine();
  const [isAlerting, setIsAlerting] = useState(false);
  const [alertSuccess, setAlertSuccess] = useState(false);

  // Simulate UV index based on time and clouds
  useEffect(() => {
    // Base UV curve (bell shape peaking at noon)
    let baseUv = 0;
    if (timeOfDay > 6 && timeOfDay < 18) {
      baseUv = Math.sin(((timeOfDay - 6) / 12) * Math.PI) * 11;
    }
    
    // Cloud cover reduces UV (but not completely)
    const cloudFactor = 1 - (cloudCover / 100) * 0.5;
    
    setUvIndex(Math.max(0, Math.round(baseUv * cloudFactor)));
  }, [timeOfDay, cloudCover]);

  const getUvRiskLevel = (uv: number) => {
    if (uv <= 2) return { level: 'Bajo', color: 'text-emerald-500', bg: 'bg-emerald-500/20', border: 'border-emerald-500/50' };
    if (uv <= 5) return { level: 'Moderado', color: 'text-yellow-500', bg: 'bg-yellow-500/20', border: 'border-yellow-500/50' };
    if (uv <= 7) return { level: 'Alto', color: 'text-orange-500', bg: 'bg-orange-500/20', border: 'border-orange-500/50' };
    if (uv <= 10) return { level: 'Muy Alto', color: 'text-rose-500', bg: 'bg-rose-500/20', border: 'border-rose-500/50' };
    return { level: 'Extremo', color: 'text-purple-500', bg: 'bg-purple-500/20', border: 'border-purple-500/50' };
  };

  const risk = getUvRiskLevel(uvIndex);

  const handleEmitAlert = async () => {
    if (!selectedProject) return;
    
    setIsAlerting(true);
    try {
      await addNode({
        title: `Alerta UV: Nivel ${risk.level} (${uvIndex})`,
        description: `Se ha emitido una alerta por radiación UV nivel ${risk.level}. Temperatura: ${temperature}°C. Se recomienda rotación de turnos y pausas de hidratación obligatorias.`,
        type: NodeType.FINDING,
        projectId: selectedProject.id,
        tags: ['Radiación UV', 'Clima', 'Turnos', 'Salud Ocupacional'],
        connections: [],
        metadata: {
          status: 'approved',
          criticidad: uvIndex >= 8 ? 'Alta' : 'Media',
          uvIndex,
          temperature,
          emittedAt: new Date().toISOString(),
          emittedBy: user?.displayName || user?.email || 'Sistema Guardián'
        }
      });
      setAlertSuccess(true);
      setTimeout(() => setAlertSuccess(false), 3000);
    } catch (error) {
      console.error('Error emitting UV alert:', error);
    } finally {
      setIsAlerting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Sun className="w-8 h-8 text-yellow-500" />
            Radiación UV
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Monitoreo Ley de Ozono (Ley 20.096)
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${risk.color} ${risk.bg} ${risk.border}`}>
          <AlertTriangle className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Riesgo {risk.level} (Índice {uvIndex})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ThermometerSun className="w-5 h-5 text-yellow-500" />
            Condiciones Ambientales
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Hora del Día</label>
              <input
                type="range"
                min="0"
                max="24"
                step="0.5"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(Number(e.target.value))}
                className="w-full accent-yellow-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>00:00</span>
                <span className="font-bold text-yellow-400">
                  {Math.floor(timeOfDay).toString().padStart(2, '0')}:{(timeOfDay % 1 === 0.5 ? '30' : '00')}
                </span>
                <span>24:00</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Cobertura Nubosa (%)</label>
              <input
                type="range"
                min="0"
                max="100"
                value={cloudCover}
                onChange={(e) => setCloudCover(Number(e.target.value))}
                className="w-full accent-zinc-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>Despejado</span>
                <span className="font-bold text-zinc-400">{cloudCover}%</span>
                <span>Nublado</span>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Temperatura (°C)</label>
              <input
                type="range"
                min="-10"
                max="45"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>-10°C</span>
                <span className="font-bold text-orange-400">{temperature}°C</span>
                <span>45°C</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-yellow-500" />
              Medidas Obligatorias
            </h3>
            <ul className="space-y-2 text-sm text-zinc-400">
              {uvIndex >= 3 && (
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1.5 shrink-0" />
                  <span>Uso obligatorio de filtro solar FPS 30+ (reaplicar cada 2 hrs).</span>
                </li>
              )}
              {uvIndex >= 6 && (
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" />
                  <span>Uso de legionario, lentes con filtro UV y ropa manga larga.</span>
                </li>
              )}
              {uvIndex >= 8 && (
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                  <span>Programar tareas pesadas bajo sombra o reprogramar horarios.</span>
                </li>
              )}
              {uvIndex < 3 && (
                <li className="flex items-start gap-2 text-emerald-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <span>Condiciones seguras. Mantener hidratación.</span>
                </li>
              )}
            </ul>
          </div>

          <div className="pt-4 border-t border-white/5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              Gestión de Turnos
            </h3>
            <div className="space-y-3">
              {uvIndex >= 8 ? (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl">
                  <p className="text-xs text-rose-200 leading-relaxed">
                    <strong>Alerta Crítica:</strong> Se recomienda suspender trabajos a la intemperie o establecer rotación de turnos cada 30 minutos.
                  </p>
                </div>
              ) : uvIndex >= 6 ? (
                <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl">
                  <p className="text-xs text-orange-200 leading-relaxed">
                    <strong>Precaución:</strong> Aumentar frecuencia de pausas de hidratación. Rotación recomendada cada 60 minutos.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <p className="text-xs text-emerald-200 leading-relaxed">
                    <strong>Turnos Normales:</strong> Las condiciones actuales permiten operar bajo el régimen de turnos estándar.
                  </p>
                </div>
              )}

              {uvIndex >= 6 && (
                <button
                  onClick={handleEmitAlert}
                  disabled={isAlerting || alertSuccess}
                  className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    alertSuccess 
                      ? 'bg-emerald-500 text-white' 
                      : 'bg-rose-500 hover:bg-rose-600 text-white'
                  } disabled:opacity-50`}
                >
                  {isAlerting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : alertSuccess ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  {alertSuccess ? 'Alerta Emitida' : 'Emitir Alerta de Turno'}
                </button>
              )}
            </div>
          </div>
        </Card>

        {/* Visualization */}
        <Card className="p-6 border-white/5 lg:col-span-2 flex flex-col items-center justify-center relative overflow-hidden min-h-[400px]">
          {/* Sky Background */}
          <div 
            className="absolute inset-0 transition-colors duration-1000"
            style={{
              background: timeOfDay < 6 || timeOfDay > 19 
                ? 'linear-gradient(to bottom, #0f172a, #1e293b)' // Night
                : timeOfDay < 8 || timeOfDay > 17
                ? 'linear-gradient(to bottom, #f59e0b, #3b82f6)' // Sunrise/Sunset
                : 'linear-gradient(to bottom, #3b82f6, #60a5fa)' // Day
            }}
          />

          {/* Sun */}
          <motion.div 
            className="absolute rounded-full bg-yellow-400 flex items-center justify-center shadow-[0_0_50px_rgba(250,204,21,0.8)]"
            style={{
              width: 100,
              height: 100,
              // Calculate position based on time (arc from left to right)
              left: `${((timeOfDay - 6) / 12) * 100}%`,
              top: `${Math.max(10, 100 - Math.sin(((timeOfDay - 6) / 12) * Math.PI) * 80)}%`,
              transform: 'translate(-50%, -50%)',
              opacity: timeOfDay > 5 && timeOfDay < 19 ? 1 : 0
            }}
          >
            <Sun className="w-12 h-12 text-yellow-100" />
          </motion.div>

          {/* Clouds */}
          {cloudCover > 0 && (
            <div className="absolute inset-0 pointer-events-none flex items-start justify-around pt-10 opacity-80">
              <CloudLightning className="w-24 h-24 text-white/80" style={{ opacity: cloudCover / 100 }} />
              <CloudLightning className="w-32 h-32 text-white/80 mt-10" style={{ opacity: cloudCover / 100 }} />
              <CloudLightning className="w-20 h-20 text-white/80" style={{ opacity: cloudCover / 100 }} />
            </div>
          )}

          {/* UV Index Display */}
          <div className="relative z-10 bg-black/50 backdrop-blur-md p-6 rounded-2xl border border-white/10 text-center mt-auto mb-10">
            <p className="text-sm font-bold text-zinc-300 uppercase tracking-widest mb-2">Índice UV Actual</p>
            <div className={`text-6xl font-black ${risk.color}`}>
              {uvIndex}
            </div>
            <p className={`text-sm font-bold uppercase mt-2 ${risk.color}`}>
              {risk.level}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
