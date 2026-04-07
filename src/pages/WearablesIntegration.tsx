import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Watch, HeartPulse, Activity, ShieldAlert, AlertTriangle, CheckCircle2, RefreshCw, Smartphone } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function WearablesIntegration() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [vitals, setVitals] = useState<{ heartRate: number, spo2: number, stress: number } | null>(null);

  const handleConnect = () => {
    setIsSyncing(true);
    // Simulate OAuth / BLE connection
    setTimeout(() => {
      setIsConnected(true);
      setIsSyncing(false);
      setVitals({ heartRate: 72, spo2: 98, stress: 35 });
    }, 2500);
  };

  useEffect(() => {
    if (!isConnected) return;
    
    // Simulate real-time vitals updates
    const interval = setInterval(() => {
      setVitals(prev => {
        if (!prev) return null;
        return {
          heartRate: prev.heartRate + (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 3),
          spo2: Math.min(100, Math.max(90, prev.spo2 + (Math.random() > 0.8 ? -1 : 0))),
          stress: Math.max(0, Math.min(100, prev.stress + (Math.random() > 0.5 ? 2 : -2)))
        };
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isConnected]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Watch className="w-8 h-8 text-rose-500" />
            Integración Wearables
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Telemetría Biométrica en Tiempo Real
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-rose-500 bg-rose-500/10 border-rose-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Enterprise
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connection Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-rose-500" />
            Dispositivos Soportados
          </h2>

          <div className="space-y-3">
            <div className={`p-4 rounded-xl border-2 transition-colors flex items-center justify-between ${isConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/50'}`}>
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${isConnected ? 'bg-emerald-500/20 text-emerald-500' : 'bg-zinc-800 text-zinc-500'}`}>
                  <Watch className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Apple Watch / Garmin</h3>
                  <p className="text-xs text-zinc-400">
                    {isConnected ? 'Conectado (Sync Activa)' : 'No conectado'}
                  </p>
                </div>
              </div>
              {isConnected && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
            </div>

            <div className="p-4 rounded-xl border-2 border-zinc-800 bg-zinc-900/50 flex items-center justify-between opacity-50">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-zinc-800 text-zinc-500">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Google Fit / Health Connect</h3>
                  <p className="text-xs text-zinc-400">Requiere configuración OAuth</p>
                </div>
              </div>
            </div>
          </div>

          {!isConnected ? (
            <Button 
              className="w-full py-4 text-lg" 
              onClick={handleConnect} 
              disabled={isSyncing}
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <Watch className="w-5 h-5 mr-2" />
                  Vincular Dispositivo (BLE/OAuth)
                </>
              )}
            </Button>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => setIsConnected(false)}>
              Desvincular Dispositivo
            </Button>
          )}
        </Card>

        {/* Telemetry Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <HeartPulse className="w-5 h-5 text-rose-500" />
            Telemetría en Vivo
          </h2>

          {!isConnected ? (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <Activity className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Conecta un dispositivo para visualizar los signos vitales del operador.</p>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-2">
                    <HeartPulse className="w-4 h-4 text-rose-500 animate-pulse" />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Frecuencia Cardíaca</p>
                  <div className="flex items-end gap-1">
                    <p className="text-3xl font-black text-white">{vitals?.heartRate}</p>
                    <p className="text-xs text-zinc-500 mb-1">bpm</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Saturación O2</p>
                  <div className="flex items-end gap-1">
                    <p className="text-3xl font-black text-cyan-400">{vitals?.spo2}</p>
                    <p className="text-xs text-zinc-500 mb-1">%</p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <div className="flex justify-between items-end mb-2">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Índice de Fatiga / Estrés</p>
                  <p className="text-lg font-bold text-amber-500">{vitals?.stress}%</p>
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500"
                    animate={{ width: `${vitals?.stress}%` }}
                    transition={{ type: 'spring', bounce: 0 }}
                  />
                </div>
              </div>

              {vitals && vitals.stress > 60 && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <h3 className="text-sm font-bold text-amber-400">Alerta de Fatiga</h3>
                    <p className="text-xs text-amber-500/70">Se recomienda una pausa activa de 15 minutos.</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </Card>
      </div>
    </div>
  );
}
