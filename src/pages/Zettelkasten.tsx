import React from 'react';
import { KnowledgeGraph } from '../components/shared/KnowledgeGraph';
import { Brain, Network, Zap, Info, Clock, Activity, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export function Zettelkasten() {
  const { nodes, loading } = useZettelkasten();

  const recentNodes = [...nodes]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const stats = {
    totalNodes: nodes.length,
    totalConnections: nodes.reduce((acc, node) => acc + node.connections.length, 0) / 2,
    avgConnections: nodes.length > 0 
      ? (nodes.reduce((acc, node) => acc + node.connections.length, 0) / nodes.length).toFixed(1)
      : 0
  };
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="bg-emerald-500/10 p-4 rounded-3xl border border-emerald-500/20">
            <Brain className="w-8 h-8 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-white">El Cerebro</h1>
            <p className="text-zinc-500 text-sm font-medium">Red Neuronal de Prevención y Conocimiento</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-zinc-900/50 border border-white/10 px-4 py-2 rounded-2xl flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Conciencia Activa</span>
          </div>
          <div className="bg-zinc-900/50 border border-white/10 px-4 py-2 rounded-2xl flex items-center gap-2">
            <Network className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sinapsis en Tiempo Real</span>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900 border border-white/10 rounded-3xl p-6 flex items-start gap-4"
      >
        <div className="bg-blue-500/10 p-2 rounded-xl">
          <Info className="w-5 h-5 text-blue-500" />
        </div>
        <div className="space-y-1">
          <h3 className="text-xs font-black uppercase tracking-widest text-white">¿Cómo funciona el Zettelkasten?</h3>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-2xl">
            Cada análisis de riesgo, trabajador o normativa se convierte en un "nodo" de conocimiento. 
            El sistema conecta automáticamente estos nodos para revelar patrones invisibles, 
            permitiendo una gestión proactiva basada en la interconexión de datos.
          </p>
        </div>
      </motion.div>

      {/* Graph Container */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Visualización del Grafo</h2>
          <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Interactúa con los nodos para ver detalles</span>
        </div>
        <KnowledgeGraph />
      </div>

      {/* Insights Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-white">Nodos Recientes</h3>
            <Clock className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="space-y-3">
            {loading ? (
              <p className="text-[10px] text-zinc-500 animate-pulse">Sincronizando con la red neuronal...</p>
            ) : recentNodes.length > 0 ? (
              recentNodes.map((node) => (
                <div key={node.id} className="group flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/5 hover:border-emerald-500/30 transition-all cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <div>
                      <p className="text-[11px] font-bold text-white group-hover:text-emerald-400 transition-colors">{node.title}</p>
                      <p className="text-[9px] text-zinc-500 uppercase tracking-wider">{node.type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] text-zinc-600 font-medium">
                      {format(new Date(node.updatedAt), 'HH:mm', { locale: es })}
                    </p>
                    <ArrowRight className="w-3 h-3 text-zinc-700 group-hover:text-emerald-500 transition-colors ml-auto mt-1" />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[10px] text-zinc-500 italic">No hay nodos recientes. Comienza a crear análisis o inspecciones.</p>
            )}
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-white">Análisis de Conexiones</h3>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Densidad de Sinapsis</p>
              <p className="text-2xl font-black text-white tracking-tighter">{stats.totalConnections}</p>
              <p className="text-[9px] text-emerald-500 font-bold mt-1 uppercase tracking-wider">Conexiones Totales</p>
            </div>
            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Factor de Red</p>
              <p className="text-2xl font-black text-white tracking-tighter">{stats.avgConnections}</p>
              <p className="text-[9px] text-blue-500 font-bold mt-1 uppercase tracking-wider">Promedio / Nodo</p>
            </div>
          </div>
          <div className="pt-2">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
              <p className="text-[10px] text-emerald-400 leading-relaxed font-medium">
                La red neuronal está operando al <span className="font-black">{(Math.min(100, (stats.totalNodes * 5))).toFixed(0)}%</span> de su capacidad proyectada. 
                Cada nueva conexión reduce la incertidumbre operativa en un <span className="font-black">2.4%</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
