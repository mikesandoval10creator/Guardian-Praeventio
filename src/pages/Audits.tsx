import React, { useState, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ClipboardCheck, 
  Plus, 
  Search, 
  Filter, 
  Calendar, 
  User, 
  Shield, 
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronRight,
  FileText,
  Target
} from 'lucide-react';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType, RiskNode } from '../types';
import { useProject } from '../contexts/ProjectContext';
import { AddAuditModal } from '../components/audits/AddAuditModal';
import { SafetyInspection } from '../components/safety/SafetyInspection';
import { ISOAudit } from '../components/audits/ISOAudit';
import { DataLoadErrorBanner } from '../components/shared/DataLoadErrorBanner';
const AuditDetailModal = lazy(() => import('../components/audits/AuditDetailModal').then(m => ({ default: m.AuditDetailModal })));

export function Audits() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<RiskNode | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState<'history' | 'inspection' | 'iso'>('history');
  const { nodes, loading, error: nodesError } = useRiskEngine();
  const { selectedProject } = useProject();

  const audits = nodes.filter(n => 
    n.type === NodeType.AUDIT && 
    (!selectedProject || n.projectId === selectedProject.id) &&
    (n.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
     (n.description || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const stats = {
    total: audits.length,
    planned: audits.filter(a => a.metadata.status === 'Planificada').length,
    completed: audits.filter(a => a.metadata.status === 'Completada' || a.metadata.status === 'Completado').length,
    avgScore: audits.length > 0 
      ? (audits.reduce((acc, a) => acc + (a.metadata.score || 0), 0) / audits.length).toFixed(1)
      : 0
  };

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      <DataLoadErrorBanner error={nodesError} resourceLabel="las auditorías" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
            <ClipboardCheck className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-950 dark:text-white">Auditorías e Inspecciones</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Verificación de Cumplimiento y Auditoría Colaborativa</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-xl overflow-x-auto">
          <button
            onClick={() => setView('history')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              view === 'history' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Historial
          </button>
          <button
            onClick={() => setView('inspection')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              view === 'inspection' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Inspección Colaborativa
          </button>
          <button
            onClick={() => setView('iso')}
            className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              view === 'iso' ? 'bg-indigo-500 text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            Dashboard ISO
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'inspection' ? (
          <motion.div
            key="inspection"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <SafetyInspection />
          </motion.div>
        ) : view === 'iso' ? (
          <motion.div
            key="iso"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <ISOAudit />
          </motion.div>
        ) : (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total', value: stats.total, icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                { label: 'Planificadas', value: stats.planned, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                { label: 'Completadas', value: stats.completed, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
                { label: 'Puntaje Prom.', value: `${stats.avgScore}%`, icon: Target, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-3 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm"
                >
                  <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center mb-2`}>
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{stat.label}</p>
                  <p className="text-xl font-black text-zinc-900 dark:text-white tracking-tighter">{stat.value}</p>
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
                  placeholder="Buscar auditorías..."
                  className="w-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-200/50 dark:border-zinc-800/50 rounded-xl pl-11 pr-4 py-2.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
              <button className="p-2.5 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-zinc-200/50 dark:border-zinc-800/50 rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                <Filter className="w-4 h-4" />
              </button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsModalOpen(true)}
                className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-black/20 group"
              >
                <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">Nueva Auditoría</span>
              </motion.button>
            </div>

            {/* Audits List */}
            <div className="space-y-3">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sincronizando Auditorías...</p>
                </div>
              ) : audits.length > 0 ? (
                audits.map((audit, i) => (
                  <motion.div
                    key={audit.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => setSelectedAudit(audit)}
                    className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl p-4 border border-zinc-200/50 dark:border-zinc-800/50 shadow-sm group hover:border-blue-500/30 transition-all cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${
                            audit.metadata.type === 'Externa' ? 'bg-indigo-500 text-white' : 
                            audit.metadata.type === 'Certificación' ? 'bg-amber-500 text-white' :
                            'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                          }`}>
                            {audit.metadata.type || 'Interna'}
                          </span>
                          <span className={`text-[8px] font-black uppercase tracking-widest ${
                            audit.metadata.status === 'Completada' || audit.metadata.status === 'Completado' ? 'text-emerald-500' : 'text-zinc-400'
                          }`}>
                            {audit.metadata.status}
                          </span>
                        </div>
                        <h3 className="text-sm font-black text-zinc-950 dark:text-white uppercase tracking-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {audit.title}
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                          {audit.description}
                        </p>
                        <div className="flex items-center gap-4 pt-1">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3 h-3 text-zinc-400" />
                            <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">{audit.metadata.auditor || 'N/A'}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="w-3 h-3 text-zinc-400" />
                            <span className="text-[9px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">
                              {audit.metadata.date ? new Date(audit.metadata.date).toLocaleDateString('es-CL') : 'Sin fecha'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-3">
                        <div className="text-right">
                          <p className="text-[10px] font-black text-zinc-900 dark:text-white tracking-tighter">{audit.metadata.score || 0}%</p>
                          <p className="text-[7px] font-bold text-zinc-400 uppercase tracking-widest">Cumplimiento</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="text-center py-12 bg-white/50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                  <ClipboardCheck className="w-12 h-12 text-zinc-200 dark:text-zinc-700 mx-auto mb-4" />
                  <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">No hay auditorías programadas</p>
                  <p className="text-[10px] text-zinc-400 mt-1">Planifica tu primera auditoría para comenzar</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AddAuditModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />

      {!!selectedAudit && (
        <Suspense fallback={null}>
          <AuditDetailModal
            audit={selectedAudit}
            isOpen={true}
            onClose={() => setSelectedAudit(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
