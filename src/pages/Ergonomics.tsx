import React, { useState, lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
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
  Calendar,
  BrainCircuit
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { NodeType, Worker } from '../types';
import { AddErgonomicsModal } from '../components/ergonomics/AddErgonomicsModal';
const AIPostureAnalysisModal = lazy(() => import('../components/ergonomics/AIPostureAnalysisModal').then(m => ({ default: m.AIPostureAnalysisModal })));

export function Ergonomics() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { nodes, loading } = useRiskEngine();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);

  // Round 17 (R4): worker selector lives INSIDE the modal as Step 0
  // (search + 5 most recent + full list). The R16 BLOCKER page-level
  // <select> + disabled "Nueva Evaluación" button has been reverted —
  // we just pass the workers list down as a prop.
  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : 'workers'
  );

  const ergoNodes = nodes.filter(node => 
    node.type === NodeType.ERGONOMICS && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  const filteredAssessments = ergoNodes.filter(node => 
    (node.metadata?.workstation || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) ||
    (node.metadata?.assessmentType || '').toLowerCase().includes(String(searchTerm || '').toLowerCase())
  );

  const totalWorkers = workers.length || 1; // Prevent division by zero
  const evaluatedWorkers = new Set(ergoNodes.map(n => n.metadata.workerId)).size;

  const stats = {
    evaluated: Math.round((evaluatedWorkers / totalWorkers) * 100),
    critical: ergoNodes.filter(n => n.metadata.risk === 'high').length,
    improvements: ergoNodes.filter(n => n.metadata.status === 'completed').length
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight">{t('ergonomics.title')}</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('ergonomics.subtitle')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => setIsAIModalOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-4 sm:py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            <BrainCircuit className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>{t('ergonomics.bio_ai')}</span>
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-4 sm:py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-orange-500/20 active:scale-95"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>{t('ergonomics.new_evaluation')}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Main Assessments List */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <div className="relative">
            <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-muted-token" />
            <input
              type="text"
              placeholder={t('ergonomics.search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-surface border border-default-token rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-xs sm:text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
            />
          </div>

          <div className="space-y-3 sm:space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-12 sm:py-20">
                <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-orange-500 animate-spin" />
              </div>
            ) : filteredAssessments.length > 0 ? (
              filteredAssessments.map((node, index) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-surface border border-default-token rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-orange-500/30 transition-all group cursor-pointer"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl bg-elevated flex items-center justify-center text-orange-500 border border-default-token shrink-0">
                        {node.metadata.assessmentType?.includes('IA') ? (
                          <BrainCircuit className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500" />
                        ) : (
                          <Layout className="w-5 h-5 sm:w-6 sm:h-6" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-bold text-primary-token group-hover:text-orange-400 transition-colors line-clamp-1">{node.metadata.workstation}</h3>
                        <p className="text-muted-token text-[10px] sm:text-xs font-black uppercase tracking-widest mt-0.5">{node.metadata.assessmentType}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 border-t sm:border-t-0 border-default-token pt-3 sm:pt-0 mt-2 sm:mt-0">
                      <div className="text-left sm:text-right">
                        <p className="text-[9px] sm:text-[10px] font-black text-muted-token uppercase tracking-widest mb-1">{t('ergonomics.risk')}</p>
                        <span className={`text-[10px] sm:text-xs font-bold px-2 py-1 rounded-md ${
                          node.metadata.risk === 'high' ? 'bg-rose-500/10 text-rose-500' : 
                          node.metadata.risk === 'medium' ? 'bg-amber-500/10 text-amber-500' : 
                          'bg-emerald-500/10 text-emerald-500'
                        }`}>
                          {node.metadata.risk === 'high' ? t('ergonomics.risk_high') : node.metadata.risk === 'medium' ? t('ergonomics.risk_medium') : t('ergonomics.risk_low')}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] sm:text-[10px] font-black text-muted-token uppercase tracking-widest mb-1">{t('ergonomics.date')}</p>
                        <span className="text-[10px] sm:text-xs font-bold text-primary-token">{node.metadata.date}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-muted-token group-hover:text-orange-500 transition-colors hidden sm:block" />
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="bg-surface border border-dashed border-default-token rounded-2xl sm:rounded-3xl p-8 sm:p-20 text-center">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-elevated rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Activity className="w-6 h-6 sm:w-8 sm:h-8 text-muted-token" />
                </div>
                <p className="text-muted-token text-xs sm:text-sm font-medium">{t('ergonomics.empty')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Stats */}
        <div className="space-y-4 sm:space-y-6">
          <div className="bg-surface border border-default-token rounded-2xl sm:rounded-3xl p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-bold text-primary-token mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
              {t('ergonomics.stats_title')}
            </h3>
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm text-secondary-token">{t('ergonomics.workstations_evaluated')}</span>
                <span className="text-xs font-bold text-emerald-500">{stats.evaluated}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm text-secondary-token">{t('ergonomics.critical_risks')}</span>
                <span className="text-xs font-bold text-rose-500">{stats.critical}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm text-secondary-token">{t('ergonomics.improvements')}</span>
                <span className="text-xs font-bold text-blue-500">{stats.improvements}</span>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-default-token rounded-2xl sm:rounded-3xl p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-bold text-primary-token mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
              {t('ergonomics.compliance_title')}
            </h3>
            <div className="space-y-3 sm:space-y-4">
              {[
                { label: t('ergonomics.active_breaks'), count: 95, color: 'bg-emerald-500' },
                { label: t('ergonomics.workstation_design'), count: 72, color: 'bg-blue-500' },
                { label: t('ergonomics.physical_load'), count: 64, color: 'bg-orange-500' },
              ].map((stat, i) => (
                <div key={i} className="space-y-1.5 sm:space-y-2">
                  <div className="flex justify-between text-[10px] sm:text-xs font-medium">
                    <span className="text-secondary-token">{stat.label}</span>
                    <span className="text-primary-token">{stat.count}%</span>
                  </div>
                  <div className="h-1 w-full bg-elevated rounded-full overflow-hidden">
                    <div className={`h-full ${stat.color} rounded-full`} style={{ width: `${stat.count}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl sm:rounded-3xl p-4 sm:p-6">
            <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
              <Info className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
              <h4 className="text-sm sm:text-base font-bold text-orange-500">{t('ergonomics.recommendation')}</h4>
            </div>
            <p className="text-[10px] sm:text-xs text-orange-200 leading-relaxed">
              {t('ergonomics.recommendation_text')}
            </p>
          </div>
        </div>
      </div>

      <AddErgonomicsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectId={selectedProject?.id}
        workers={workers}
      />
      {isAIModalOpen && (
        <Suspense fallback={null}>
          <AIPostureAnalysisModal
            isOpen={true}
            onClose={() => setIsAIModalOpen(false)}
            projectId={selectedProject?.id}
          />
        </Suspense>
      )}
    </div>
  );
}
