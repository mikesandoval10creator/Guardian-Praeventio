import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Cpu, Activity, ShieldAlert, AlertTriangle, Wifi, WifiOff, Database, Server, Info } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';

export function IoTEdgeFiltering() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [telemetry, setTelemetry] = useState<any[]>([]);

  const handleConnect = () => {
    setIsConnecting(true);
    // Simulate MQTT Broker connection
    setTimeout(() => {
      setIsConnected(true);
      setIsConnecting(false);
    }, 2000);
  };

  useEffect(() => {
    if (!isConnected) return;
    
    // Simulate high-frequency IoT telemetry
    const interval = setInterval(() => {
      setTelemetry(prev => {
        const newReading = {
          id: Date.now(),
          sensor: `Sensor-${Math.floor(Math.random() * 5) + 1}`,
          value: Math.random() * 100,
          timestamp: new Date().toISOString(),
          status: Math.random() > 0.9 ? 'warning' : 'ok'
        };
        return [newReading, ...prev].slice(0, 15); // Keep last 15 readings
      });
    }, 500); // 2Hz frequency

    return () => clearInterval(interval);
  }, [isConnected]);

  // Gate: MQTT broker integration + edge-filtered telemetry pipeline is API
  // surface for industrial sensors — falls under the "API privada / Vertex
  // workspace" bundle starting at Empresarial. Previously ungated, which
  // would have let any browser session spin up a broker connection.
  return (
    <PremiumFeatureGuard
      feature="canUseAPIAccess"
      featureName="IoT Edge Filtering"
      description="La integración MQTT con sensores industriales y filtrado en el borde está disponible desde el plan Empresarial (API privada)."
    >
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Cpu className="w-8 h-8 text-indigo-500" />
            IoT Edge Filtering
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Telemetría de Alta Frecuencia (MQTT)
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-indigo-500 bg-indigo-500/10 border-indigo-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Enterprise
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connection Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-500" />
            Broker MQTT
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Endpoint</p>
              <p className="text-sm font-mono text-white">mqtts://iot.praeventio.net:8883</p>
            </div>
            
            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Tópico</p>
              <p className="text-sm font-mono text-indigo-400">telemetry/sensors/#</p>
            </div>
          </div>

          {!isConnected ? (
            <Button 
              className="w-full py-4 text-lg" 
              onClick={handleConnect} 
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin mr-2" />
                  Conectando...
                </>
              ) : (
                <>
                  <Wifi className="w-5 h-5 mr-2" />
                  Conectar a Broker
                </>
              )}
            </Button>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => setIsConnected(false)}>
              <WifiOff className="w-5 h-5 mr-2" />
              Desconectar
            </Button>
          )}

          <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 mt-4">
            <div className="flex gap-2">
              <Info className="w-4 h-4 text-indigo-400 shrink-0" />
              <p className="text-xs text-indigo-300">
                El Edge Filtering procesa miles de eventos por segundo localmente y solo envía anomalías a Firestore para evitar saturación.
              </p>
            </div>
          </div>
        </Card>

        {/* Telemetry Stream */}
        <Card className="p-6 border-white/5 lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-500" />
              Stream de Datos (Tiempo Real)
            </h2>
            {isConnected && (
              <span className="flex items-center gap-2 text-xs font-bold text-emerald-500 bg-emerald-500/10 px-3 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                LIVE (2Hz)
              </span>
            )}
          </div>

          <div className="bg-zinc-950 rounded-xl border border-white/5 h-[400px] overflow-hidden relative">
            {!isConnected ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                <Database className="w-12 h-12 text-zinc-800 mb-4" />
                <p className="text-sm text-zinc-500">Esperando conexión al broker MQTT...</p>
              </div>
            ) : (
              <div className="p-4 font-mono text-xs space-y-2 overflow-y-auto h-full">
                {telemetry.map((reading, index) => (
                  <motion.div 
                    key={reading.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1 - (index * 0.05), x: 0 }}
                    className={`flex justify-between items-center p-2 rounded ${reading.status === 'warning' ? 'bg-amber-500/10 text-amber-400' : 'text-zinc-400'}`}
                  >
                    <span className="text-zinc-600">[{reading.timestamp.split('T')[1].replace('Z', '')}]</span>
                    <span className="font-bold text-indigo-400">{reading.sensor}</span>
                    <span>VAL: {reading.value.toFixed(2)}</span>
                    {reading.status === 'warning' && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
    </PremiumFeatureGuard>
  );
}
