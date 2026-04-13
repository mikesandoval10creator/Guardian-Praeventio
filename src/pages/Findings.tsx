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
  ChevronRight,
  Zap,
  RefreshCw
} from 'lucide-react';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { useProject } from '../contexts/ProjectContext';
import { AddFindingModal } from '../components/findings/AddFindingModal';
import { generateActionPlan } from '../services/geminiService';
import { logAuditAction } from '../services/auditService';

export function Findings() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { nodes, loading, addNode, addConnection } = useRiskEngine();
  const { selectedProject } = useProject();

  const handleGeneratePlan = async (finding: any) => {
    setProcessingId(finding.id);
    try {
      const plan = await generateActionPlan(finding.title, finding.description, finding.metadata.severity);
      
      for (const tarea of plan.tareas) {
        const taskNode = await addNode({
          type: NodeType.TASK,
          title: tarea.titulo,
          description: tarea.descripcion,
          tags: ['Acción Correctiva', tarea.prioridad, 'IA'],
          projectId: finding.projectId,
          connections: [finding.id],
          metadata: {
            priority: tarea.prioridad,
            deadline: `${tarea.plazoDias} días`,
            status: 'pending',
            source: 'AI_Finding_Plan'
          }
        });
        
        if (taskNode) {
          await addConnection(finding.id, taskNode.id);
        }
      }
      
      await logAuditAction(
        'GENERATE_ACTION_PLAN',
        'Findings',
        {
          findingId: finding.id,
          findingTitle: finding.title,
          tasksGenerated: plan.tareas.length
        },
        finding.projectId
      );

      alert(`Se han generado ${plan.tareas.length} tareas de acción correctiva vinculadas a este hallazgo.`);
    } catch (error) {
      console.error('Error generating action plan:', error);
      alert('Error al generar el plan de acción con IA.');
    } finally {
      setProcessingId(null);
    }
  };

  const findings = nodes.filter(n => 
    n.type === NodeType.FINDING && 
    (!selectedProject || n.projectId === selectedProject.id) &&
    (n.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
     (n.description || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const stats = {
    total: findings.length,
    open: findings.filter(f => {
      const status = (f.metadata?.status || f.metadata?.estado || '').toLowerCase();
      return status === 'abierto' || status === 'abierta' || status === 'open';
    }).length,
    critical: findings.filter(f => f.metadata?.severity === 'Crítica').length,
    resolved: findings.filter(f => {
      const status = (f.metadata?.status || f.metadata?.estado || '').toLowerCase();
      return status === 'cerrado' || status === 'cerrada' || status === 'completed' || status === 'completado' || status === 'completada';
    }).length
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-hidden box-border space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white leading-tight">Hallazgos</h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Observaciones y No Conformidades</p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsModalOpen(true)}
          className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 sm:py-2 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-black/20 dark:shadow-white/10 group w-full sm:w-auto"
        >
          <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
          <span className="text-xs sm:text-sm font-black uppercase tracking-widest">Nuevo Hallazgo</span>
        </motion.button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Total', value: stats.total, icon: Activity, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Abiertos', value: stats.open, icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Críticos', value: stats.critical, icon: AlertTriangle, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'Resueltos', value: stats.resolved, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-4 border border-zinc-200 dark:border-white/10 shadow-sm"
          >
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-xl ${stat.bg} flex items-center justify-center mb-3`}>
              <stat.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${stat.color}`} />
            </div>
            <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">{stat.label}</p>
            <p className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white tracking-tighter leading-none">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar hallazgos..."
            className="w-full bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl pl-10 sm:pl-12 pr-4 py-2.5 sm:py-3 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all placeholder:text-zinc-500"
          />
        </div>
        <button className="flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors w-full sm:w-auto">
          <Filter className="w-4 h-4 sm:w-5 sm:h-5" />
          <span className="text-xs sm:text-sm font-medium sm:hidden">Filtros</span>
        </button>
      </div>

      {/* Findings List */}
      <div className="space-y-3 sm:space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 sm:py-20 gap-3 sm:gap-4">
            <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500 animate-spin" />
            <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-zinc-400">Sincronizando Hallazgos...</p>
          </div>
        ) : findings.length > 0 ? (
          findings.map((finding, i) => (
            <motion.div
              key={finding.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl p-4 sm:p-5 border border-zinc-200 dark:border-white/10 shadow-sm group hover:border-amber-500/30 transition-all cursor-pointer"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex-1 space-y-2 w-full min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black uppercase tracking-widest ${
                      finding.metadata.severity === 'Crítica' ? 'bg-rose-500 text-white' :
                      finding.metadata.severity === 'Alta' ? 'bg-amber-500 text-white' :
                      'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}>
                      {finding.metadata.severity}
                    </span>
                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400 truncate">
                      {finding.metadata.category}
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors truncate">
                    {finding.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                    {finding.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 pt-2">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-400" />
                      <span className="text-[9px] sm:text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase truncate max-w-[120px] sm:max-w-[200px]">{finding.metadata.location}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-zinc-400" />
                      <span className="text-[9px] sm:text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase">
                        {new Date(finding.createdAt).toLocaleDateString('es-CL')}
                      </span>
                    </div>
                    {finding.isPendingSync && (
                      <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-600 dark:text-orange-400 text-[9px] sm:text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Pendiente
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex sm:flex-col items-center sm:items-end gap-3 w-full sm:w-auto justify-between sm:justify-start mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-zinc-200 dark:border-zinc-800 shrink-0">
                  <div className={`px-2.5 py-1 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest border ${
                    finding.metadata.status === 'Abierto' ? 'border-amber-500/20 text-amber-600 dark:text-amber-400 bg-amber-500/10' : 'border-emerald-500/20 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                  }`}>
                    {finding.metadata.status}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGeneratePlan(finding);
                      }}
                      disabled={processingId === finding.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100"
                    >
                      {processingId === finding.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400 dark:text-amber-500" />}
                      Plan IA
                    </button>
                    <ChevronRight className="w-5 h-5 text-zinc-400 group-hover:text-amber-500 group-hover:translate-x-1 transition-all hidden sm:block" />
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="text-center py-12 sm:py-20 bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-white/10">
            <AlertTriangle className="w-12 h-12 sm:w-16 sm:h-16 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
            <p className="text-sm sm:text-base font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">No se encontraron hallazgos</p>
            <p className="text-[10px] sm:text-xs text-zinc-400 dark:text-zinc-500 mt-1">Registra una nueva observación para comenzar</p>
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
