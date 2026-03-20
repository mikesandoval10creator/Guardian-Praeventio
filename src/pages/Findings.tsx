import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle, 
  Plus, 
  Search, 
  Filter, 
  MapPin, 
  Clock, 
  Shield, 
  Activity,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight
} from 'lucide-react';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { NodeType } from '../types';
import { useProject } from '../contexts/ProjectContext';
import { AddFindingModal } from '../components/findings/AddFindingModal';

export function Findings() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { nodes, loading } = useZettelkasten();
  const { selectedProject } = useProject();

  const findings = nodes.filter(n => 
    n.type === NodeType.FINDING && 
    (!selectedProject || n.projectId === selectedProject.id) &&
    (n.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
     n.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const stats = {
    total: findings.length,
    open: findings.filter(f => f.metadata.status === 'Abierto').length,
    critical: findings.filter(f => f.metadata.severity === 'Crítica').length,
    resolved: findings.filter(f => f.metadata.status === 'Cerrado').length
  };

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-950">Hallazgos</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Observaciones y No Conformidades</p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsModalOpen(true)}
          className="bg-zinc-900 text-white px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-black/20 group"
        >
          <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
          <span className="text-[10px] font-black uppercase tracking-widest">Nuevo Hallazgo</span>
        </motion.button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Abiertos', value: stats.open, icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Críticos', value: stats.critical, icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Resueltos', value: stats.resolved, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white/80 backdrop-blur-sm rounded-2xl p-3 border border-white/50 shadow-sm"
          >
            <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center mb-2`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{stat.label}</p>
            <p className="text-xl font-black text-zinc-900 tracking-tighter">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar hallazgos..."
            className="w-full bg-white/80 backdrop-blur-sm border border-white/50 rounded-xl pl-11 pr-4 py-2.5 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all"
          />
        </div>
        <button className="p-2.5 bg-white/80 backdrop-blur-sm border border-white/50 rounded-xl text-zinc-500 hover:text-zinc-900 transition-colors">
          <Filter className="w-4 h-4" />
        </button>
      </div>

      {/* Findings List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sincronizando Hallazgos...</p>
          </div>
        ) : findings.length > 0 ? (
          findings.map((finding, i) => (
            <motion.div
              key={finding.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-white/50 shadow-sm group hover:border-amber-500/30 transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${
                      finding.metadata.severity === 'Crítica' ? 'bg-red-500 text-white' :
                      finding.metadata.severity === 'Alta' ? 'bg-amber-500 text-white' :
                      'bg-zinc-100 text-zinc-600'
                    }`}>
                      {finding.metadata.severity}
                    </span>
                    <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">
                      {finding.metadata.category}
                    </span>
                  </div>
                  <h3 className="text-sm font-black text-zinc-950 uppercase tracking-tight group-hover:text-amber-600 transition-colors">
                    {finding.title}
                  </h3>
                  <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                    {finding.description}
                  </p>
                  <div className="flex items-center gap-4 pt-1">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 text-zinc-400" />
                      <span className="text-[9px] font-bold text-zinc-600 uppercase">{finding.metadata.location}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-zinc-400" />
                      <span className="text-[9px] font-bold text-zinc-600 uppercase">
                        {new Date(finding.createdAt).toLocaleDateString('es-CL')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <div className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border ${
                    finding.metadata.status === 'Abierto' ? 'border-amber-500/20 text-amber-600 bg-amber-500/5' : 'border-emerald-500/20 text-emerald-600 bg-emerald-500/5'
                  }`}>
                    {finding.metadata.status}
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="text-center py-12 bg-white/50 rounded-3xl border border-dashed border-zinc-200">
            <AlertTriangle className="w-12 h-12 text-zinc-200 mx-auto mb-4" />
            <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">No se encontraron hallazgos</p>
            <p className="text-[10px] text-zinc-400 mt-1">Registra una nueva observación para comenzar</p>
          </div>
        )}
      </div>

      <AddFindingModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
}
