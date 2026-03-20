import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Layout, 
  Activity, 
  Shield, 
  AlertTriangle, 
  Search, 
  Plus, 
  ChevronRight,
  BarChart3,
  Info,
  Loader2,
  Calendar
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { NodeType } from '../types';
import { AddErgonomicsModal } from '../components/ergonomics/AddErgonomicsModal';

export function Ergonomics() {
  const { selectedProject } = useProject();
  const { nodes, loading } = useZettelkasten();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const ergoNodes = nodes.filter(node => 
    node.type === NodeType.ERGONOMICS && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  const filteredAssessments = ergoNodes.filter(node => 
    node.metadata.workstation.toLowerCase().includes(searchTerm.toLowerCase()) ||
    node.metadata.assessmentType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    evaluated: ergoNodes.length > 0 ? Math.round((ergoNodes.length / 10) * 100) : 0, // Mock total of 10 for percentage
    critical: ergoNodes.filter(n => n.metadata.risk === 'high').length,
    improvements: ergoNodes.filter(n => n.metadata.status === 'completed').length
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Ergonomía</h1>
          <p className="text-zinc-400 mt-1">Evaluación de puestos de trabajo, carga física y diseño ergonómico</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl font-medium transition-all shadow-lg shadow-orange-500/20 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <span>Nueva Evaluación</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Assessments List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar por puesto de trabajo o tipo de evaluación..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
            />
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
              </div>
            ) : filteredAssessments.length > 0 ? (
              filteredAssessments.map((node, index) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-zinc-900/50 border border-white/10 rounded-2xl p-4 hover:border-orange-500/30 transition-all group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-orange-500 border border-white/5">
                        <Layout className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white group-hover:text-orange-400 transition-colors">{node.metadata.workstation}</h3>
                        <p className="text-zinc-500 text-xs font-medium uppercase tracking-wider">{node.metadata.assessmentType}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Riesgo</p>
                        <span className={`text-xs font-bold ${
                          node.metadata.risk === 'high' ? 'text-rose-500' : 
                          node.metadata.risk === 'medium' ? 'text-amber-500' : 
                          'text-emerald-500'
                        }`}>
                          {node.metadata.risk === 'high' ? 'Alto' : node.metadata.risk === 'medium' ? 'Medio' : 'Bajo'}
                        </span>
                      </div>
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Fecha</p>
                        <span className="text-xs font-bold text-white">{node.metadata.date}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-orange-500 transition-colors" />
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-3xl p-20 text-center">
                <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Activity className="w-8 h-8 text-zinc-600" />
                </div>
                <p className="text-zinc-500 text-sm">No hay evaluaciones ergonómicas para este proyecto.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-orange-500" />
              Estadísticas Ergonómicas
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Puestos Evaluados</span>
                <span className="text-xs font-bold text-emerald-500">{stats.evaluated}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Riesgos Críticos</span>
                <span className="text-xs font-bold text-rose-500">{stats.critical}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Mejoras Implementadas</span>
                <span className="text-xs font-bold text-blue-500">{stats.improvements}</span>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-500" />
              Cumplimiento Ergonómico
            </h3>
            <div className="space-y-4">
              {[
                { label: 'Pausas Activas', count: 95, color: 'bg-emerald-500' },
                { label: 'Diseño de Puestos', count: 72, color: 'bg-blue-500' },
                { label: 'Carga Física', count: 64, color: 'bg-orange-500' },
              ].map((stat, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-zinc-400">{stat.label}</span>
                    <span className="text-white">{stat.count}%</span>
                  </div>
                  <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full ${stat.color} rounded-full`} style={{ width: `${stat.count}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-3xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <Info className="w-5 h-5 text-orange-500" />
              <h4 className="font-bold text-orange-500">Recomendación</h4>
            </div>
            <p className="text-xs text-orange-200 leading-relaxed">
              Se recomienda la adquisición de sillas ergonómicas con soporte lumbar ajustable para el área de monitoreo para reducir reportes de dolor de espalda baja.
            </p>
          </div>
        </div>
      </div>

      <AddErgonomicsModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        projectId={selectedProject?.id}
      />
    </div>
  );
}
