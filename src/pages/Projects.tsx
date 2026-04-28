import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  MapPin,
  Calendar,
  Building2,
  ShieldAlert,
  ChevronRight,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  Archive,
  Briefcase,
  Users,
  BarChart3,
  Settings,
  Layout,
  FileText,
  WifiOff,
  RefreshCw,
  ChevronDown
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useIndustryIntegration } from '../hooks/useIndustryIntegration';
import { INDUSTRIES, INDUSTRY_SECTORS, RISK_LEVELS } from '../constants';
import { ProjectDocuments } from '../components/projects/ProjectDocuments';
import { MaquinariaManager } from '../components/projects/MaquinariaManager';
import { GanttProjectView } from '../components/projects/GanttProjectView';
import { PredictedActivityModal } from '../components/projects/PredictedActivityModal';
import { useCalendarPredictions } from '../hooks/useCalendarPredictions';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useNotifications } from '../contexts/NotificationContext';
import { logger } from '../utils/logger';
import { get } from 'idb-keyval';
import type { PredictedActivity } from '../services/calendar/predictions';

export function Projects() {
  const { projects, createProject, loading, selectedProject, setSelectedProject } = useProject();
  const { bootstrapProjectKnowledge } = useIndustryIntegration();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'assets'>('overview');
  const [listViewMode, setListViewMode] = useState<'cards' | 'timeline'>('cards');
  const isOnline = useOnlineStatus();
  const { predictions, climateRisks } = useCalendarPredictions();
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const [selectedActivity, setSelectedActivity] = useState<PredictedActivity | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
    industry: INDUSTRIES[0],
    clientName: '',
    startDate: new Date().toISOString().split('T')[0],
    riskLevel: 'Medio' as any,
    status: 'active' as const,
    shiftStart: '08:00',
    shiftEnd: '18:00',
    trackCommute: true
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Require MFA before saving a project
    const mfaCompleted = await get('mfa_setup_completed');
    if (mfaCompleted !== 'true') {
      window.dispatchEvent(new CustomEvent('require-mfa', {
        detail: {
          isForced: false,
          onSuccess: () => {
            // Re-trigger submit after MFA is completed
            executeSubmit();
          }
        }
      }));
      return;
    }

    executeSubmit();
  };

  const executeSubmit = async () => {
    setIsCreating(true);
    try {
      const newProjectId = await createProject(formData);
      
      // Bootstrap Risk Network knowledge for this industry
      await bootstrapProjectKnowledge(newProjectId, formData.industry);

      setIsModalOpen(false);
      setFormData({
        name: '',
        description: '',
        location: '',
        industry: INDUSTRIES[0],
        clientName: '',
        startDate: new Date().toISOString().split('T')[0],
        riskLevel: 'Medio',
        status: 'active',
        shiftStart: '08:00',
        shiftEnd: '18:00',
        trackCommute: true
      });
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const filteredProjects = projects.filter(p => 
    (p.name || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) ||
    (p.industry || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) ||
    (p.location || '').toLowerCase().includes(String(searchTerm || '').toLowerCase())
  );

  if (selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
        {/* Detail Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <button 
              onClick={() => setSelectedProject(null)}
              className="p-2.5 sm:p-3 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all shadow-sm shrink-0 mt-1 sm:mt-0"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-3xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase break-words leading-tight">{selectedProject.name}</h1>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5 sm:mt-1">
                <span className="text-[8px] sm:text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                  {selectedProject.status}
                </span>
                <span className="text-[8px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest truncate">{selectedProject.industry}</span>
              </div>
            </div>
            <div className="flex sm:hidden items-center gap-2 shrink-0">
              <button className="p-2.5 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all shadow-sm">
                <BarChart3 className="w-4 h-4" />
              </button>
              <button className="p-2.5 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all shadow-sm">
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 sm:gap-3">
            <button className="p-2.5 sm:p-3 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all shadow-sm">
              <BarChart3 className="w-4 h-4 sm:w-6 sm:h-6" />
            </button>
            <button className="p-2.5 sm:p-3 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all shadow-sm">
              <Settings className="w-4 h-4 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 p-1.5 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl w-full overflow-x-auto custom-scrollbar shadow-sm">
          {[
            { id: 'overview', label: 'Resumen', icon: Layout },
            { id: 'documents', label: 'Docs', icon: FileText },
            { id: 'assets', label: 'Activos', icon: Briefcase },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center justify-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap flex-1 sm:flex-none ${
                activeTab === tab.id ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl sm:rounded-[40px] p-4 sm:p-8 min-h-[400px] shadow-sm">
          {activeTab === 'overview' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12">
              <div className="space-y-6 sm:space-y-8">
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3 sm:mb-4">Información General</h3>
                  <div className="grid grid-cols-1 gap-3 sm:gap-4">
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                      <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Ubicación</p>
                        <p className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white truncate">{selectedProject.location}</p>
                      </div>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                      <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Fecha de Inicio</p>
                        <p className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white truncate">{new Date(selectedProject.startDate).toLocaleDateString('es-CL')}</p>
                      </div>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                      <Users className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Cliente</p>
                        <p className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white truncate">{selectedProject.clientName || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3 sm:mb-4">Descripción</h3>
                  <p className="text-zinc-600 dark:text-zinc-400 text-xs sm:text-sm leading-relaxed bg-zinc-50 dark:bg-zinc-800/30 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl p-4 sm:p-6">
                    {selectedProject.description}
                  </p>
                </div>
              </div>
              <div className="space-y-6 sm:space-y-8">
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-3 sm:mb-4">Nivel de Riesgo</h3>
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-2xl sm:rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center text-center gap-3 sm:gap-4">
                    <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center border-4 ${
                      selectedProject.riskLevel === 'Crítico' ? 'border-red-500/20 text-red-500' :
                      selectedProject.riskLevel === 'Alto' ? 'border-amber-500/20 text-amber-500' :
                      selectedProject.riskLevel === 'Medio' ? 'border-blue-500/20 text-blue-500' : 'border-emerald-500/20 text-emerald-500'
                    }`}>
                      <ShieldAlert className="w-8 h-8 sm:w-10 sm:h-10" />
                    </div>
                    <div>
                      <p className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Riesgo {selectedProject.riskLevel}</p>
                      <p className="text-[8px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Evaluación de Seguridad Base</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'documents' ? (
            <ProjectDocuments projectId={selectedProject.id} />
          ) : (
            <MaquinariaManager projectId={selectedProject.id} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-zinc-900 dark:text-white tracking-tighter uppercase break-words leading-tight">Gestión de Proyectos</h1>
          <p className="text-zinc-500 font-medium text-[9px] sm:text-xs md:text-sm mt-1">Administra tus faenas, industrias y niveles de riesgo</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setIsModalOpen(true)}
          disabled={!isOnline}
          title={!isOnline ? 'Requiere conexión a internet' : ''}
          className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] sm:text-xs flex items-center justify-center gap-2 transition-all w-full sm:w-auto shrink-0 ${
            !isOnline 
              ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed' 
              : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
          }`}
        >
          {!isOnline ? <WifiOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Plus className="w-4 h-4 sm:w-5 sm:h-5" />}
          {!isOnline ? 'Requiere Conexión' : 'Nuevo Proyecto'}
        </motion.button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
        <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shrink-0">
            <Briefcase className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">Proyectos Activos</p>
            <p className="text-lg sm:text-xl md:text-2xl font-black text-zinc-900 dark:text-white">{projects.filter(p => p.status === 'active').length}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex items-center gap-4 shadow-sm">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shrink-0">
            <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">Industrias Cubiertas</p>
            <p className="text-lg sm:text-xl md:text-2xl font-black text-zinc-900 dark:text-white">{new Set(projects.map(p => p.industry)).size}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex items-center gap-4 shadow-sm sm:col-span-2 md:col-span-1">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 shrink-0">
            <ShieldAlert className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">Riesgo Crítico</p>
            <p className="text-lg sm:text-xl md:text-2xl font-black text-zinc-900 dark:text-white">{projects.filter(p => p.riskLevel === 'Crítico').length}</p>
          </div>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-2 p-1.5 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl w-full sm:w-auto sm:self-start shadow-sm">
        {[
          { id: 'cards' as const, label: 'Tarjetas', icon: Layout },
          { id: 'timeline' as const, label: 'Línea de tiempo', icon: Calendar },
        ].map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setListViewMode(mode.id)}
            className={`flex items-center justify-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap flex-1 sm:flex-none ${
              listViewMode === mode.id
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'
            }`}
          >
            <mode.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            {mode.label}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
        <input
          type="text"
          placeholder="Buscar por nombre, industria o ubicación..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-xs sm:text-sm text-zinc-900 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-sm"
        />
      </div>

      {/* Projects List */}
      {loading ? (
          <div className="flex flex-col items-center justify-center py-12 sm:py-20 gap-4">
            <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-500 animate-spin" />
            <p className="text-[10px] sm:text-xs font-black text-zinc-500 uppercase tracking-widest">Sincronizando Proyectos...</p>
          </div>
      ) : listViewMode === 'timeline' ? (
        <GanttProjectView
          projects={filteredProjects.map((p) => {
            // Guard against malformed startDate strings: new Date('garbage')
            // returns Invalid Date, which propagates as NaN through the
            // gantt-task-react timeline math. Validate before passing.
            const parsedStart = p.startDate ? new Date(p.startDate) : null;
            const startDate = parsedStart && !Number.isNaN(parsedStart.getTime())
              ? parsedStart
              : new Date();
            const parsedEnd = p.endDate ? new Date(p.endDate) : null;
            const endDate = parsedEnd && !Number.isNaN(parsedEnd.getTime())
              ? parsedEnd
              : new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000);
            return { id: p.id, name: p.name, startDate, endDate, status: p.status };
          })}
          predictedActivities={predictions}
          climateRisks={climateRisks}
          onActivityClick={(activity) => setSelectedActivity(activity)}
          onClimateRiskClick={(risk) => {
            // The RiskNetwork page is the canonical "knowledge graph" view.
            // ClimateRiskNodePayload doesn't expose a stable id (the doc isn't
            // persisted yet from the Gantt), so we pass the title — the Risk
            // Network can use that as a search/highlight hint. Fallback to a
            // synthetic id derived from project + forecast date when needed.
            const payload = risk?.riskNodePayload;
            const nodeKey =
              payload?.title ??
              `${risk.projectId}::${risk.forecast.date.toISOString().slice(0, 10)}`;
            navigate(`/risk-network?node=${encodeURIComponent(nodeKey)}`);
          }}
          onProjectClick={(projectId) => {
            const target = projects.find((p) => p.id === projectId);
            if (target) setSelectedProject(target);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredProjects.map((project) => (
            <motion.div
              key={project.id}
              whileHover={{ y: -5 }}
              onClick={() => setSelectedProject(project)}
              className={`bg-white dark:bg-zinc-900/50 border rounded-2xl sm:rounded-3xl p-5 sm:p-6 cursor-pointer transition-all relative overflow-hidden group shadow-sm flex flex-col ${
                selectedProject?.id === project.id ? 'border-emerald-500 ring-1 ring-emerald-500/50' : 'border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20'
              }`}
            >
              {/* Status Badge */}
              <div className="absolute top-3 sm:top-4 right-3 sm:right-4 flex items-center gap-2">
                {project.isPendingSync && (
                  <span className="px-2 py-0.5 rounded-lg bg-orange-50 dark:bg-orange-500/20 text-orange-600 dark:text-orange-500 text-[8px] font-black uppercase tracking-widest flex items-center gap-1">
                    <RefreshCw className="w-2 h-2 animate-spin" />
                    Pendiente
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                  project.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 
                  project.status === 'completed' ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-500' : 'bg-zinc-100 dark:bg-zinc-500/10 text-zinc-600 dark:text-zinc-500'
                }`}>
                  {project.status === 'active' ? 'Activo' : project.status === 'completed' ? 'Completado' : 'Archivado'}
                </span>
              </div>

              <div className="space-y-3 sm:space-y-4 flex-1">
                <div className="flex items-start gap-3 sm:gap-4 pr-16 sm:pr-20">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl sm:rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-white/5 group-hover:border-emerald-500/30 transition-all">
                    <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-500 group-hover:text-emerald-500 transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base md:text-lg font-black text-zinc-900 dark:text-white truncate uppercase tracking-tight">{project.name}</h3>
                    <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest truncate">{project.industry}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-2">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-zinc-500 dark:text-zinc-400 min-w-0">
                    <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="text-[8px] sm:text-[10px] font-bold uppercase truncate">{project.location}</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 text-zinc-500 dark:text-zinc-400 min-w-0">
                    <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                    <span className="text-[8px] sm:text-[10px] font-bold uppercase truncate">{new Date(project.startDate).toLocaleDateString('es-CL')}</span>
                  </div>
                </div>

                <div className="pt-3 sm:pt-4 border-t border-zinc-200 dark:border-white/5 flex items-center justify-between mt-auto">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <ShieldAlert className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${
                      project.riskLevel === 'Crítico' ? 'text-red-500' :
                      project.riskLevel === 'Alto' ? 'text-amber-500' :
                      project.riskLevel === 'Medio' ? 'text-blue-500' : 'text-emerald-500'
                    }`} />
                    <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Riesgo {project.riskLevel}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-400 dark:text-zinc-600 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl sm:rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-4 sm:p-8 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-emerald-50 dark:from-emerald-500/5 to-transparent shrink-0">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-10 h-10 sm:w-12 h-12 rounded-xl sm:rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 dark:text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Nuevo Proyecto</h3>
                    <p className="text-[10px] sm:text-xs text-zinc-500 font-medium">Configura una nueva faena o centro de trabajo</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-full transition-colors shrink-0">
                  <X className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-500" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-4 sm:p-8 space-y-4 sm:space-y-6 overflow-y-auto custom-scrollbar flex-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Nombre del Proyecto</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ej: Mina Los Bronces - Fase 4"
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    />
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Industria / Rubro</label>
                    <div className="relative">
                      <select
                        value={formData.industry}
                        onChange={e => setFormData({ ...formData, industry: e.target.value })}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 pr-10 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none"
                      >
                        {INDUSTRY_SECTORS.map(sector => (
                          <optgroup key={sector.sector} label={sector.sector}>
                            {sector.subsectors.map(subsector => (
                              <option key={subsector} value={subsector}>{subsector}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 sm:space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Descripción del Proyecto</label>
                  <textarea
                    required
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Detalles sobre el alcance y objetivos..."
                    rows={3}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Ubicación</label>
                    <div className="relative">
                      <MapPin className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
                      <input
                        required
                        type="text"
                        value={formData.location}
                        onChange={e => setFormData({ ...formData, location: e.target.value })}
                        placeholder="Ciudad, Región"
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl pl-10 sm:pl-14 pr-4 sm:pr-5 py-3 sm:py-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Cliente</label>
                    <input
                      type="text"
                      value={formData.clientName}
                      onChange={e => setFormData({ ...formData, clientName: e.target.value })}
                      placeholder="Nombre de la empresa mandante"
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Nivel de Riesgo Base</label>
                    <div className="relative">
                      <select
                        value={formData.riskLevel}
                        onChange={e => setFormData({ ...formData, riskLevel: e.target.value as any })}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 pr-10 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none"
                      >
                        {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Fecha de Inicio</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
                      <input
                        required
                        type="date"
                        value={formData.startDate}
                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl pl-10 sm:pl-14 pr-4 sm:pr-5 py-3 sm:py-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-200 dark:border-white/5">
                  <h4 className="text-xs font-black uppercase tracking-widest text-zinc-900 dark:text-white mb-4">Configuración de Jornada y GPS</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Inicio de Jornada</label>
                      <input
                        type="time"
                        value={formData.shiftStart}
                        onChange={e => setFormData({ ...formData, shiftStart: e.target.value })}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                      />
                    </div>
                    <div className="space-y-1.5 sm:space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Fin de Jornada</label>
                      <input
                        type="time"
                        value={formData.shiftEnd}
                        onChange={e => setFormData({ ...formData, shiftEnd: e.target.value })}
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                      />
                    </div>
                  </div>
                  
                  <div className="mt-4 space-y-3">
                    <label className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-xl cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                      <input
                        type="checkbox"
                        checked={formData.trackCommute}
                        onChange={e => setFormData({ ...formData, trackCommute: e.target.checked })}
                        className="w-4 h-4 text-emerald-500 rounded border-zinc-300 focus:ring-emerald-500"
                      />
                      <div>
                        <p className="text-xs font-bold text-zinc-900 dark:text-white">Rastrear Accidentes de Trayecto</p>
                        <p className="text-[10px] text-zinc-500">Mantiene el GPS activo 1 hora antes y después de la jornada.</p>
                      </div>
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-black py-4 sm:py-5 rounded-2xl sm:rounded-3xl transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 sm:gap-3 uppercase tracking-widest text-[10px] sm:text-sm mt-4 shrink-0"
                >
                  {isCreating ? (
                    <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />
                      Crear Proyecto
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Predicted activity detail modal — opened from the Gantt timeline. */}
      <PredictedActivityModal
        activity={selectedActivity}
        onClose={() => setSelectedActivity(null)}
        onSchedule={async (activity) => {
          // TODO(calendar-schedule-from-modal): the existing /api/calendar/sync
          // endpoint only accepts a `challenges` string array (see server.ts
          // line 809), so it can't carry the recommendedDate / duration of a
          // PredictedActivity yet. For now we surface a notification so the
          // user knows the action was acknowledged, and close the modal.
          // Follow-up: extend the endpoint (or add /api/calendar/events) to
          // accept structured event payloads, then replace this stub.
          try {
            addNotification({
              title: 'Actividad agendada',
              message: `${activity.type} programada para ${activity.recommendedDate.toLocaleDateString('es-CL')}. Sincronizaremos con Google Calendar cuando el endpoint estructurado esté disponible.`,
              type: 'info',
            });
            logger.info('predicted_activity_schedule_requested', {
              type: activity.type,
              projectId: activity.projectId,
              recommendedDate: activity.recommendedDate.toISOString(),
            });
          } finally {
            setSelectedActivity(null);
          }
        }}
        onDismiss={(activity) => {
          // Soft-dismiss: persist a 7-day snooze in localStorage so the same
          // (projectId, type) tuple isn't re-surfaced immediately. The
          // prediction hook can read this key on next refresh to suppress.
          try {
            const key = `praeventio_dismissed_activity_${activity.projectId}_${activity.type}`;
            localStorage.setItem(key, String(Date.now()));
          } catch (err) {
            logger.warn('predicted_activity_dismiss_persist_failed', { error: String(err) });
          }
          setSelectedActivity(null);
        }}
      />
    </div>
  );
}
