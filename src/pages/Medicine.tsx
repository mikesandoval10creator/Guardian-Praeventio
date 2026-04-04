import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Activity, 
  Heart, 
  Stethoscope, 
  Search, 
  Plus, 
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Calendar
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { AddMedicineModal } from '../components/medicine/AddMedicineModal';

export function Medicine() {
  const { selectedProject } = useProject();
  const { nodes, loading } = useRiskEngine();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const medicalNodes = nodes.filter(node => 
    node.type === NodeType.MEDICINE && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  const filteredRecords = medicalNodes.filter(node => 
    node.metadata.patient.toLowerCase().includes(searchTerm.toLowerCase()) ||
    node.metadata.examType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    aptitude: medicalNodes.length > 0 
      ? Math.round((medicalNodes.filter(n => n.metadata.result === 'Apto').length / medicalNodes.length) * 100)
      : 0,
    restrictions: medicalNodes.filter(n => n.metadata.result === 'Apto con restricción').length,
    pending: medicalNodes.filter(n => n.metadata.status === 'scheduled').length
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Medicina Ocupacional</h1>
          <p className="text-zinc-400 mt-1">Gestión de salud, exámenes médicos y vigilancia epidemiológica</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-xl font-medium transition-all shadow-lg shadow-rose-500/20 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <span>Nueva Consulta</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Records List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar por paciente o tipo de examen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
            />
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
              </div>
            ) : filteredRecords.length > 0 ? (
              filteredRecords.map((node, index) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-zinc-900/50 border border-white/10 rounded-2xl p-4 hover:border-rose-500/30 transition-all group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-rose-500 border border-white/5">
                        <Stethoscope className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white group-hover:text-rose-400 transition-colors">{node.metadata.patient}</h3>
                        <p className="text-zinc-500 text-xs font-medium uppercase tracking-wider">{node.metadata.examType}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Resultado</p>
                        <span className={`text-xs font-bold ${
                          node.metadata.result === 'Apto' ? 'text-emerald-500' : 
                          node.metadata.result === 'Apto con restricción' ? 'text-amber-500' : 
                          'text-zinc-500'
                        }`}>
                          {node.metadata.result}
                        </span>
                      </div>
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Fecha</p>
                        <span className="text-xs font-bold text-white">{node.metadata.date}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-rose-500 transition-colors" />
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-3xl p-20 text-center">
                <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Heart className="w-8 h-8 text-zinc-600" />
                </div>
                <p className="text-zinc-500 text-sm">No hay registros médicos para este proyecto.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-500" />
              Estado de Salud
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Aptitud Médica</span>
                <span className="text-xs font-bold text-emerald-500">{stats.aptitude}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Restricciones Activas</span>
                <span className="text-xs font-bold text-amber-500">{stats.restrictions}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-400">Exámenes Pendientes</span>
                <span className="text-xs font-bold text-rose-500">{stats.pending}</span>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              Vigilancia Médica
            </h3>
            <div className="space-y-4">
              {[
                { label: 'Control Cardiovascular', count: 45, color: 'bg-rose-500' },
                { label: 'Control Ergonómico', count: 28, color: 'bg-orange-500' },
                { label: 'Control Psicosocial', count: 15, color: 'bg-indigo-500' },
              ].map((stat, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-zinc-400">{stat.label}</span>
                    <span className="text-white">{stat.count}</span>
                  </div>
                  <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full ${stat.color} rounded-full`} style={{ width: `${(stat.count / 50) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-rose-500/10 border border-rose-500/20 rounded-3xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle className="w-5 h-5 text-rose-500" />
              <h4 className="font-bold text-rose-500">Alerta de Salud</h4>
            </div>
            <p className="text-xs text-rose-200 leading-relaxed">
              Se ha detectado un aumento del 15% en consultas por fatiga visual en el área administrativa. Se recomienda revisión de iluminación y pausas activas.
            </p>
          </div>
        </div>
      </div>

      <AddMedicineModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        projectId={selectedProject?.id}
      />
    </div>
  );
}
