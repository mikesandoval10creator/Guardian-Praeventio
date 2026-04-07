import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Database, ShieldAlert, Activity, ArrowRightLeft, Server, Zap, HardDrive, Layers } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function CQRSArchitecture() {
  const [isSimulating, setIsSimulating] = useState(false);
  const [metrics, setMetrics] = useState({ reads: 0, writes: 0, latency: 15 });

  useEffect(() => {
    if (!isSimulating) return;

    const interval = setInterval(() => {
      setMetrics(prev => ({
        reads: prev.reads + Math.floor(Math.random() * 500) + 100,
        writes: prev.writes + Math.floor(Math.random() * 50) + 10,
        latency: Math.max(5, Math.min(25, prev.latency + (Math.random() > 0.5 ? 1 : -1)))
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [isSimulating]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Layers className="w-8 h-8 text-fuchsia-500" />
            Arquitectura CQRS
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Command Query Responsibility Segregation + Redis
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-fuchsia-500 bg-fuchsia-500/10 border-fuchsia-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Enterprise
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Architecture Diagram */}
        <Card className="p-6 border-white/5 lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-fuchsia-500" />
              Topología del Sistema
            </h2>
            <Button 
              variant={isSimulating ? "danger" : "primary"} 
              onClick={() => setIsSimulating(!isSimulating)}
              className="text-xs py-2"
            >
              {isSimulating ? 'Detener Simulación' : 'Iniciar Test de Carga'}
            </Button>
          </div>

          <div className="relative h-[400px] bg-zinc-950 rounded-xl border border-white/5 p-8 flex flex-col justify-between">
            {/* Client Layer */}
            <div className="flex justify-center">
              <div className="px-6 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-white font-bold flex items-center gap-2 z-10">
                <Activity className="w-5 h-5 text-zinc-400" />
                Clientes (Web / Móvil)
              </div>
            </div>

            {/* Arrows */}
            <div className="absolute inset-0 pointer-events-none">
              <svg className="w-full h-full" preserveAspectRatio="none">
                {/* Write Path */}
                <path d="M 50% 20% Q 25% 40% 25% 60%" fill="none" stroke={isSimulating ? "#f43f5e" : "#3f3f46"} strokeWidth="2" strokeDasharray={isSimulating ? "5,5" : "none"} className={isSimulating ? "animate-[dash_1s_linear_infinite]" : ""} />
                {/* Read Path */}
                <path d="M 50% 20% Q 75% 40% 75% 60%" fill="none" stroke={isSimulating ? "#10b981" : "#3f3f46"} strokeWidth="2" strokeDasharray={isSimulating ? "5,5" : "none"} className={isSimulating ? "animate-[dash_1s_linear_infinite_reverse]" : ""} />
                {/* Sync Path */}
                <path d="M 25% 80% Q 50% 90% 75% 80%" fill="none" stroke={isSimulating ? "#8b5cf6" : "#3f3f46"} strokeWidth="2" strokeDasharray="5,5" className={isSimulating ? "animate-[dash_2s_linear_infinite]" : ""} />
              </svg>
            </div>

            {/* CQRS Layer */}
            <div className="flex justify-between w-full px-12">
              {/* Command Side (Writes) */}
              <div className="flex flex-col items-center gap-4 z-10">
                <div className="px-6 py-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 font-bold flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5" />
                  Command API (Write)
                </div>
                <div className="p-4 bg-zinc-900 border border-zinc-700 rounded-full">
                  <Database className="w-8 h-8 text-rose-500" />
                </div>
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Event Store (PostgreSQL)</span>
              </div>

              {/* Query Side (Reads) */}
              <div className="flex flex-col items-center gap-4 z-10">
                <div className="px-6 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 font-bold flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5" />
                  Query API (Read)
                </div>
                <div className="p-4 bg-zinc-900 border border-zinc-700 rounded-full">
                  <HardDrive className="w-8 h-8 text-emerald-500" />
                </div>
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Read Models (Redis/Elastic)</span>
              </div>
            </div>

            {/* Event Bus */}
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 bg-violet-500/10 border border-violet-500/30 rounded-full text-violet-400 text-xs font-bold flex items-center gap-2 z-10">
              <Zap className="w-4 h-4" />
              Event Bus (Kafka / PubSub)
            </div>
          </div>
        </Card>

        {/* Metrics Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-fuchsia-500" />
            Métricas de Rendimiento
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Lecturas (Query Side)</p>
              <div className="flex items-end gap-2">
                <p className="text-3xl font-black text-emerald-400">{metrics.reads.toLocaleString()}</p>
                <p className="text-xs text-zinc-500 mb-1">req/s</p>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                <motion.div 
                  className="h-full bg-emerald-500"
                  animate={{ width: isSimulating ? `${Math.min(100, (metrics.reads / 5000) * 100)}%` : '0%' }}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Escrituras (Command Side)</p>
              <div className="flex items-end gap-2">
                <p className="text-3xl font-black text-rose-400">{metrics.writes.toLocaleString()}</p>
                <p className="text-xs text-zinc-500 mb-1">req/s</p>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                <motion.div 
                  className="h-full bg-rose-500"
                  animate={{ width: isSimulating ? `${Math.min(100, (metrics.writes / 500) * 100)}%` : '0%' }}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Latencia Promedio (Read)</p>
              <div className="flex items-end gap-2">
                <p className="text-3xl font-black text-fuchsia-400">{metrics.latency}</p>
                <p className="text-xs text-zinc-500 mb-1">ms</p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/20">
            <p className="text-xs text-fuchsia-300">
              La separación de responsabilidades permite escalar las lecturas (Redis) independientemente de las escrituras (Event Store), ideal para dashboards en tiempo real con miles de usuarios concurrentes.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
