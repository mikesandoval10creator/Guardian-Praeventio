import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Brain, 
  Activity, 
  Shield, 
  AlertTriangle, 
  Search, 
  Plus, 
  ChevronRight,
  BarChart3,
  Info,
  Loader2,
  Calendar,
  BrainCircuit,
  Users
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { NodeType, Worker } from '../types';
import { AddPsychosocialModal } from '../components/psychosocial/AddPsychosocialModal';
import { AIPsychosocialAnalysisModal } from '../components/psychosocial/AIPsychosocialAnalysisModal';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';

export function Psychosocial() {
  const { selectedProject } = useProject();
  const { nodes, loading } = useRiskEngine();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);

  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : 'workers'
  );

  const psychoNodes = nodes.filter(node => 
    node.type === NodeType.PSYCHOSOCIAL && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  const filteredAssessments = psychoNodes.filter(node => 
    node.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    node.metadata.department?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalWorkers = workers.length || 1; // Prevent division by zero
  const evaluatedWorkers = new Set(psychoNodes.map(n => n.metadata.workerId)).size;

  const stats = {
    evaluated: Math.round((evaluatedWorkers / totalWorkers) * 100),
    highRisk: psychoNodes.filter(n => n.metadata.riskLevel === 'high').length,
    mediumRisk: psychoNodes.filter(n => n.metadata.riskLevel === 'medium').length,
    lowRisk: psychoNodes.filter(n => n.metadata.riskLevel === 'low').length,
  };

  return (
    <PremiumFeatureGuard featureName="Riesgos Psicosociales" description="Evalúa y gestiona el bienestar mental y clima laboral de tu equipo con análisis predictivo IA.">
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Riesgos Psicosociales</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Evaluación ISTAS21, bienestar mental y clima laboral
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button 
            onClick={() => setIsAIModalOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-4 sm:py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            <BrainCircuit className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Análisis Predictivo IA</span>
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-6 py-4 sm:py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-rose-500/20 active:scale-95"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Nueva Evaluación</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Main Assessments List */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <div className="relative">
            <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar por departamento o título..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-900/50 border border-white/10 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
            />
          </div>

          <div className="space-y-3 sm:space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 sm:py-20">
                <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-rose-500 animate-spin" />
              </div>
            ) : filteredAssessments.length > 0 ? (
              filteredAssessments.map((node, index) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-zinc-900/50 border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-rose-500/30 transition-all group cursor-pointer"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${
                        node.metadata.riskLevel === 'high' ? 'bg-rose-500/20 text-rose-500' :
                        node.metadata.riskLevel === 'medium' ? 'bg-amber-500/20 text-amber-500' :
                        'bg-emerald-500/20 text-emerald-500'
                      }`}>
                        <Brain className="w-5 h-5 sm:w-6 sm:h-6" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-rose-400 transition-colors">
                          {node.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 sm:mt-2 text-[10px] sm:text-xs text-zinc-400">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {node.metadata.department || 'General'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(node.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-4 sm:w-auto w-full border-t border-white/5 sm:border-t-0 pt-3 sm:pt-0">
                      <div className="text-left sm:text-right">
                        <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Nivel de Riesgo</div>
                        <div className={`text-xs sm:text-sm font-black uppercase tracking-widest ${
                          node.metadata.riskLevel === 'high' ? 'text-rose-500' :
                          node.metadata.riskLevel === 'medium' ? 'text-amber-500' :
                          'text-emerald-500'
                        }`}>
                          {node.metadata.riskLevel === 'high' ? 'Alto' :
                           node.metadata.riskLevel === 'medium' ? 'Medio' : 'Bajo'}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 group-hover:text-rose-500 transition-colors" />
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12 sm:py-20 bg-zinc-900/30 rounded-2xl border border-white/5">
                <Brain className="w-10 h-10 sm:w-12 sm:h-12 text-zinc-600 mx-auto mb-3 sm:mb-4" />
                <h3 className="text-sm sm:text-base font-bold text-white mb-1 sm:mb-2">Sin Evaluaciones</h3>
                <p className="text-xs sm:text-sm text-zinc-500">No se han registrado evaluaciones ISTAS21.</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats Sidebar */}
        <div className="space-y-4 sm:space-y-6">
          <div className="bg-zinc-900/50 border border-white/10 rounded-2xl p-5 sm:p-6">
            <h3 className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 sm:mb-6 flex items-center gap-2">
              <BarChart3 className="w-3 h-3 sm:w-4 sm:h-4" />
              Resumen ISTAS21
            </h3>
            
            <div className="space-y-4 sm:space-y-6">
              <div>
                <div className="flex justify-between text-xs sm:text-sm mb-2">
                  <span className="text-zinc-400">Cobertura de Evaluación</span>
                  <span className="text-white font-bold">{stats.evaluated}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-rose-500 rounded-full"
                    style={{ width: `${stats.evaluated}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-zinc-800/50 rounded-xl p-3 sm:p-4 border border-white/5">
                  <div className="text-xl sm:text-2xl font-black text-rose-500 mb-1">{stats.highRisk}</div>
                  <div className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Riesgo Alto</div>
                </div>
                <div className="bg-zinc-800/50 rounded-xl p-3 sm:p-4 border border-white/5">
                  <div className="text-xl sm:text-2xl font-black text-amber-500 mb-1">{stats.mediumRisk}</div>
                  <div className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Riesgo Medio</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-rose-500/10 to-transparent border border-rose-500/20 rounded-2xl p-5 sm:p-6">
            <h3 className="text-[10px] sm:text-xs font-bold text-rose-400 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-2">
              <Info className="w-3 h-3 sm:w-4 sm:h-4" />
              Protocolo ISTAS21
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              El cuestionario SUSESO/ISTAS21 es el instrumento oficial en Chile para medir los riesgos psicosociales en el trabajo. Evalúa dimensiones como exigencias psicológicas, trabajo activo, apoyo social, compensaciones y doble presencia.
            </p>
          </div>
        </div>
      </div>

      <AddPsychosocialModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
      
      <AIPsychosocialAnalysisModal
        isOpen={isAIModalOpen}
        onClose={() => setIsAIModalOpen(false)}
      />
    </div>
    </PremiumFeatureGuard>
  );
}
