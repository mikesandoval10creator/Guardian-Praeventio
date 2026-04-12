import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Watch, HeartPulse, Activity, ShieldAlert, AlertTriangle, CheckCircle2, RefreshCw, Smartphone, Brain, Sun, Download, X } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

export function WearablesIntegration() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [vitals, setVitals] = useState<{ heartRate: number, spo2: number, stress: number, hrv: number } | null>(null);
  const [showReport, setShowReport] = useState(false);

  // Mock data for Circadian Rhythm
  const circadianData = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}:00`,
    alertness: Math.sin((i - 6) * Math.PI / 12) * 50 + 50 + (Math.random() * 10 - 5),
    baseline: Math.sin((i - 6) * Math.PI / 12) * 50 + 50
  }));

  // Mock data for HRV trend
  const hrvData = Array.from({ length: 7 }, (_, i) => ({
    day: `Día ${i + 1}`,
    hrv: 45 + Math.random() * 30
  }));

  const handleConnect = () => {
    setIsSyncing(true);
    // Simulate OAuth / BLE connection
    setTimeout(() => {
      setIsConnected(true);
      setIsSyncing(false);
      setVitals({ heartRate: 72, spo2: 98, stress: 35, hrv: 65 });
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
          stress: Math.max(0, Math.min(100, prev.stress + (Math.random() > 0.5 ? 2 : -2))),
          hrv: Math.max(20, Math.min(120, prev.hrv + (Math.random() > 0.5 ? 1 : -1)))
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
            Optimización Biológica
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Telemetría Wearable & Estado de Alerta
          </p>
        </div>
        <div className="flex gap-3">
          {isConnected && (
            <Button onClick={() => setShowReport(true)} className="bg-indigo-600 hover:bg-indigo-700 border-none text-white flex items-center gap-2">
              <Download className="w-4 h-4" />
              Reporte de Estrés
            </Button>
          )}
          <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-rose-500 bg-rose-500/10 border-rose-500/20">
            <ShieldAlert className="w-5 h-5" />
            <span className="font-bold uppercase tracking-wider text-sm">
              Nivel: Enterprise
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connection Panel */}
        <Card className="p-6 border-white/5 space-y-6 lg:col-span-1">
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

        {/* Vitals Dashboard */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4 border-white/5 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-rose-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-center gap-3 mb-3">
                <HeartPulse className="w-5 h-5 text-rose-500" />
                <span className="text-xs font-bold text-zinc-400 uppercase">BPM</span>
              </div>
              <div className="text-3xl font-black text-white">
                {vitals ? vitals.heartRate : '--'}
              </div>
            </Card>

            <Card className="p-4 border-white/5 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-center gap-3 mb-3">
                <Activity className="w-5 h-5 text-blue-500" />
                <span className="text-xs font-bold text-zinc-400 uppercase">SpO2</span>
              </div>
              <div className="text-3xl font-black text-white">
                {vitals ? `${vitals.spo2}%` : '--'}
              </div>
            </Card>

            <Card className="p-4 border-white/5 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-center gap-3 mb-3">
                <Brain className="w-5 h-5 text-emerald-500" />
                <span className="text-xs font-bold text-zinc-400 uppercase">HRV (ms)</span>
              </div>
              <div className="text-3xl font-black text-white">
                {vitals ? Math.round(vitals.hrv) : '--'}
              </div>
            </Card>

            <Card className="p-4 border-white/5 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-center gap-3 mb-3">
                <Activity className="w-5 h-5 text-amber-500" />
                <span className="text-xs font-bold text-zinc-400 uppercase">Estrés</span>
              </div>
              <div className="text-3xl font-black text-white">
                {vitals ? `${vitals.stress}%` : '--'}
              </div>
            </Card>
          </div>

          {isConnected && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Ritmo Circadiano */}
              <Card className="p-6 border-white/5">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sun className="w-5 h-5 text-amber-500" />
                    Ritmo Circadiano & Alerta
                  </h3>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={circadianData}>
                      <defs>
                        <linearGradient id="colorAlertness" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="time" stroke="#666" fontSize={10} tickMargin={10} />
                      <YAxis stroke="#666" fontSize={10} domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Area type="monotone" dataKey="alertness" stroke="#f59e0b" fillOpacity={1} fill="url(#colorAlertness)" />
                      <Line type="monotone" dataKey="baseline" stroke="#52525b" strokeDasharray="5 5" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-zinc-400 mt-4 text-center">
                  Nivel de alerta proyectado basado en patrones de sueño y HRV.
                </p>
              </Card>

              {/* Tendencia HRV */}
              <Card className="p-6 border-white/5">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <HeartPulse className="w-5 h-5 text-emerald-500" />
                    Variabilidad Cardíaca (HRV)
                  </h3>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hrvData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="day" stroke="#666" fontSize={10} tickMargin={10} />
                      <YAxis stroke="#666" fontSize={10} domain={['auto', 'auto']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Line type="monotone" dataKey="hrv" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-zinc-400 mt-4 text-center">
                  Un HRV más alto indica mejor recuperación y menor estrés acumulado.
                </p>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Stress Report Modal */}
      <AnimatePresence>
        {showReport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-2xl w-full shadow-2xl"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-white">Reporte de Estrés Biológico</h2>
                  <p className="text-zinc-400 text-sm mt-1">Análisis predictivo de fatiga y recuperación</p>
                </div>
                <button onClick={() => setShowReport(false)} className="text-zinc-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                  <h3 className="text-rose-500 font-bold mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    Hallazgo Crítico
                  </h3>
                  <p className="text-rose-200 text-sm">
                    El promedio de HRV del equipo de perforación ha disminuido un 15% en la última semana, indicando estrés acumulado. Se recomienda rotación de turnos o pausas activas extendidas para prevenir incidentes por fatiga.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-zinc-800/50 rounded-xl">
                    <div className="text-sm text-zinc-400 mb-1">HRV Promedio (7 días)</div>
                    <div className="text-2xl font-bold text-white">48 ms</div>
                    <div className="text-xs text-rose-500 mt-1">↓ 15% vs semana anterior</div>
                  </div>
                  <div className="p-4 bg-zinc-800/50 rounded-xl">
                    <div className="text-sm text-zinc-400 mb-1">Picos de Estrés</div>
                    <div className="text-2xl font-bold text-white">14:00 - 16:00</div>
                    <div className="text-xs text-amber-500 mt-1">Coincide con baja circadiana</div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 mt-8">
                  <Button onClick={() => setShowReport(false)} className="bg-zinc-800 hover:bg-zinc-700 text-white border-none">
                    Cerrar
                  </Button>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 text-white border-none flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Exportar PDF
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
