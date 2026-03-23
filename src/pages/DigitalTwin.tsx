import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Map, Activity, Zap, AlertTriangle, Thermometer, Wind, Droplets, Battery, Wifi } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';

export function DigitalTwin() {
  const { selectedProject } = useProject();
  const [sensors, setSensors] = useState([
    { id: 's1', name: 'Zona Norte - Excavación', type: 'temperature', value: 24, unit: '°C', status: 'normal' },
    { id: 's2', name: 'Zona Sur - Andamios', type: 'wind', value: 15, unit: 'km/h', status: 'normal' },
    { id: 's3', name: 'Túnel Principal', type: 'gas', value: 0.5, unit: 'ppm', status: 'normal' },
    { id: 's4', name: 'Grúa Torre A', type: 'vibration', value: 2.1, unit: 'mm/s', status: 'normal' },
    { id: 'w1', name: 'Smart Helmet - Juan P.', type: 'heartrate', value: 85, unit: 'bpm', status: 'normal' },
    { id: 'w2', name: 'Smart Vest - Ana M.', type: 'temperature', value: 36.5, unit: '°C', status: 'normal' },
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSensors(prev => prev.map(sensor => {
        // Simulate random fluctuations
        let newValue = sensor.value;
        let newStatus = sensor.status;

        switch (sensor.type) {
          case 'temperature':
            newValue += (Math.random() * 2 - 1);
            newStatus = newValue > 35 ? 'warning' : 'normal';
            break;
          case 'wind':
            newValue += (Math.random() * 5 - 2.5);
            newStatus = newValue > 40 ? 'danger' : newValue > 25 ? 'warning' : 'normal';
            break;
          case 'gas':
            newValue += (Math.random() * 0.2 - 0.1);
            newValue = Math.max(0, newValue);
            newStatus = newValue > 2 ? 'danger' : newValue > 1 ? 'warning' : 'normal';
            break;
          case 'vibration':
            newValue += (Math.random() * 0.5 - 0.25);
            newValue = Math.max(0, newValue);
            newStatus = newValue > 5 ? 'danger' : newValue > 3 ? 'warning' : 'normal';
            break;
          case 'heartrate':
            newValue += (Math.random() * 10 - 5);
            newValue = Math.max(60, Math.min(180, newValue));
            newStatus = newValue > 120 ? 'warning' : 'normal';
            break;
        }

        return { ...sensor, value: Number(newValue.toFixed(1)), status: newStatus };
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'danger': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case 'warning': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      default: return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'temperature': return <Thermometer className="w-5 h-5" />;
      case 'wind': return <Wind className="w-5 h-5" />;
      case 'gas': return <AlertTriangle className="w-5 h-5" />;
      case 'vibration': return <Activity className="w-5 h-5" />;
      case 'heartrate': return <Activity className="w-5 h-5" />;
      default: return <Zap className="w-5 h-5" />;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">Gemelo Digital</h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] mt-2">
            Telemetría IoT y Wearables en Tiempo Real
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl px-4 py-2 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Sistema En Línea</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 3D Map Simulation */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden relative aspect-video flex items-center justify-center">
            {/* Simulated 3D Environment Grid */}
            <div className="absolute inset-0" style={{
              backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
              transform: 'perspective(500px) rotateX(60deg) scale(2)',
              transformOrigin: 'top center'
            }} />
            
            {/* Simulated Entities */}
            <motion.div 
              animate={{ x: [0, 50, 0], y: [0, -20, 0] }}
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              className="absolute top-1/2 left-1/3 w-4 h-4 bg-blue-500 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.8)]"
            />
            <motion.div 
              animate={{ x: [0, -30, 0], y: [0, 40, 0] }}
              transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
              className="absolute top-1/3 right-1/3 w-4 h-4 bg-emerald-500 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.8)]"
            />
            <div className="absolute bottom-1/4 right-1/4 w-6 h-6 bg-amber-500 rounded-sm shadow-[0_0_15px_rgba(245,158,11,0.8)] animate-pulse" />

            {/* Overlay UI */}
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-2 text-white text-xs font-bold uppercase tracking-widest">
                <Map className="w-4 h-4 text-indigo-400" />
                Plano 3D - Nivel 1
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sensors.filter(s => s.status !== 'normal').map(sensor => (
              <motion.div 
                key={sensor.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`border rounded-2xl p-4 flex items-start gap-4 ${getStatusColor(sensor.status)}`}
              >
                <div className="mt-1">{getIcon(sensor.type)}</div>
                <div>
                  <h4 className="text-sm font-black uppercase tracking-tight">{sensor.name}</h4>
                  <p className="text-xs font-medium mt-1">Valor Anómalo: {sensor.value} {sensor.unit}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Sensor List */}
        <div className="space-y-4">
          <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-zinc-400" />
            Sensores Conectados
          </h3>
          
          {sensors.map(sensor => (
            <motion.div 
              key={sensor.id}
              layout
              className={`bg-zinc-900/50 border rounded-2xl p-4 flex items-center justify-between transition-colors ${
                sensor.status === 'danger' ? 'border-rose-500/50' : 
                sensor.status === 'warning' ? 'border-amber-500/50' : 
                'border-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${getStatusColor(sensor.status)}`}>
                  {getIcon(sensor.type)}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">{sensor.name}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <Battery className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] text-zinc-500 font-medium">98%</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-lg font-black ${
                  sensor.status === 'danger' ? 'text-rose-500' : 
                  sensor.status === 'warning' ? 'text-amber-500' : 
                  'text-white'
                }`}>
                  {sensor.value}
                </div>
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{sensor.unit}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
