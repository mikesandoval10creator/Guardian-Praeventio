import React, { useState } from 'react';
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
  FileText
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { INDUSTRIES, RISK_LEVELS } from '../constants';
import { ProjectDocuments } from '../components/projects/ProjectDocuments';
import { MaquinariaManager } from '../components/projects/MaquinariaManager';

export function Projects() {
  const { projects, createProject, loading, selectedProject, setSelectedProject } = useProject();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'assets'>('overview');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
    industry: INDUSTRIES[0],
    clientName: '',
    startDate: new Date().toISOString().split('T')[0],
    riskLevel: 'Medio' as any,
    status: 'active' as const
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      await createProject(formData);
      setIsModalOpen(false);
      setFormData({
        name: '',
        description: '',
        location: '',
        industry: INDUSTRIES[0],
        clientName: '',
        startDate: new Date().toISOString().split('T')[0],
        riskLevel: 'Medio',
        status: 'active'
      });
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.industry.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (selectedProject) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        {/* Detail Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setSelectedProject(null)}
              className="p-3 bg-zinc-900/50 border border-white/10 rounded-2xl text-zinc-400 hover:text-white transition-all"
            >
              <X className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-3xl font-black text-white tracking-tighter uppercase">{selectedProject.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                  {selectedProject.status}
                </span>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{selectedProject.industry}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-3 bg-zinc-900/50 border border-white/10 rounded-2xl text-zinc-400 hover:text-white transition-all">
              <BarChart3 className="w-6 h-6" />
            </button>
            <button className="p-3 bg-zinc-900/50 border border-white/10 rounded-2xl text-zinc-400 hover:text-white transition-all">
              <Settings className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 p-1.5 bg-zinc-900/50 border border-white/10 rounded-3xl w-fit">
          {[
            { id: 'overview', label: 'Resumen', icon: Layout },
            { id: 'documents', label: 'Documentos', icon: FileText },
            { id: 'assets', label: 'Activos', icon: Briefcase },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-zinc-500 hover:text-white hover:bg-white/5'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-zinc-900/50 border border-white/10 rounded-[40px] p-8 min-h-[400px]">
          {activeTab === 'overview' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div className="space-y-8">
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4">Información General</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="bg-zinc-800/50 border border-white/5 rounded-2xl p-4 flex items-center gap-4">
                      <MapPin className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Ubicación</p>
                        <p className="text-sm font-bold text-white">{selectedProject.location}</p>
                      </div>
                    </div>
                    <div className="bg-zinc-800/50 border border-white/5 rounded-2xl p-4 flex items-center gap-4">
                      <Calendar className="w-5 h-5 text-blue-500" />
                      <div>
                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Fecha de Inicio</p>
                        <p className="text-sm font-bold text-white">{new Date(selectedProject.startDate).toLocaleDateString('es-CL')}</p>
                      </div>
                    </div>
                    <div className="bg-zinc-800/50 border border-white/5 rounded-2xl p-4 flex items-center gap-4">
                      <Users className="w-5 h-5 text-amber-500" />
                      <div>
                        <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Cliente</p>
                        <p className="text-sm font-bold text-white">{selectedProject.clientName || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4">Descripción</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed bg-zinc-800/30 border border-white/5 rounded-2xl p-6">
                    {selectedProject.description}
                  </p>
                </div>
              </div>
              <div className="space-y-8">
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4">Nivel de Riesgo</h3>
                  <div className="bg-zinc-800/50 border border-white/5 rounded-3xl p-8 flex flex-col items-center justify-center text-center gap-4">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center border-4 ${
                      selectedProject.riskLevel === 'Crítico' ? 'border-red-500/20 text-red-500' :
                      selectedProject.riskLevel === 'Alto' ? 'border-amber-500/20 text-amber-500' :
                      selectedProject.riskLevel === 'Medio' ? 'border-blue-500/20 text-blue-500' : 'border-emerald-500/20 text-emerald-500'
                    }`}>
                      <ShieldAlert className="w-10 h-10" />
                    </div>
                    <div>
                      <p className="text-2xl font-black text-white uppercase tracking-tighter">Riesgo {selectedProject.riskLevel}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Evaluación de Seguridad Base</p>
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
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tighter uppercase">Gestión de Proyectos</h1>
          <p className="text-zinc-500 font-medium text-sm">Administra tus faenas, industrias y niveles de riesgo</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setIsModalOpen(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
        >
          <Plus className="w-5 h-5" />
          Nuevo Proyecto
        </motion.button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
            <Briefcase className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Proyectos Activos</p>
            <p className="text-2xl font-black text-white">{projects.filter(p => p.status === 'active').length}</p>
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
            <Building2 className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Industrias Cubiertas</p>
            <p className="text-2xl font-black text-white">{new Set(projects.map(p => p.industry)).size}</p>
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <ShieldAlert className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Riesgo Crítico</p>
            <p className="text-2xl font-black text-white">{projects.filter(p => p.riskLevel === 'Crítico').length}</p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
        <input
          type="text"
          placeholder="Buscar por nombre, industria o ubicación..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
        />
      </div>

      {/* Projects List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
          <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Sincronizando Proyectos...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <motion.div
              key={project.id}
              whileHover={{ y: -5 }}
              onClick={() => setSelectedProject(project)}
              className={`bg-zinc-900/50 border rounded-3xl p-6 cursor-pointer transition-all relative overflow-hidden group ${
                selectedProject?.id === project.id ? 'border-emerald-500 ring-1 ring-emerald-500/50' : 'border-white/10 hover:border-white/20'
              }`}
            >
              {/* Status Badge */}
              <div className="absolute top-4 right-4">
                <span className={`px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                  project.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 
                  project.status === 'completed' ? 'bg-blue-500/10 text-blue-500' : 'bg-zinc-500/10 text-zinc-500'
                }`}>
                  {project.status === 'active' ? 'Activo' : project.status === 'completed' ? 'Completado' : 'Archivado'}
                </span>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center border border-white/5 group-hover:border-emerald-500/30 transition-all">
                    <Building2 className="w-6 h-6 text-zinc-500 group-hover:text-emerald-500 transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-black text-white truncate uppercase tracking-tight">{project.name}</h3>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest truncate">{project.industry}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <MapPin className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase truncate">{project.location}</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Calendar className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase">{new Date(project.startDate).toLocaleDateString('es-CL')}</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className={`w-4 h-4 ${
                      project.riskLevel === 'Crítico' ? 'text-red-500' :
                      project.riskLevel === 'Alto' ? 'text-amber-500' :
                      project.riskLevel === 'Medio' ? 'text-blue-500' : 'text-emerald-500'
                    }`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Riesgo {project.riskLevel}</span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
              className="relative w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-[40px] shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                    <Plus className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter">Nuevo Proyecto</h3>
                    <p className="text-xs text-zinc-500 font-medium">Configura una nueva faena o centro de trabajo</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6 text-zinc-500" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[70vh] overflow-y-auto no-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Nombre del Proyecto</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ej: Mina Los Bronces - Fase 4"
                      className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Industria / Rubro</label>
                    <select
                      value={formData.industry}
                      onChange={e => setFormData({ ...formData, industry: e.target.value })}
                      className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none"
                    >
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Descripción del Proyecto</label>
                  <textarea
                    required
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Detalles sobre el alcance y objetivos..."
                    rows={3}
                    className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Ubicación</label>
                    <div className="relative">
                      <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                      <input
                        required
                        type="text"
                        value={formData.location}
                        onChange={e => setFormData({ ...formData, location: e.target.value })}
                        placeholder="Ciudad, Región"
                        className="w-full bg-zinc-800 border border-white/5 rounded-2xl pl-14 pr-5 py-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Cliente</label>
                    <input
                      type="text"
                      value={formData.clientName}
                      onChange={e => setFormData({ ...formData, clientName: e.target.value })}
                      placeholder="Nombre de la empresa mandante"
                      className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Nivel de Riesgo Base</label>
                    <select
                      value={formData.riskLevel}
                      onChange={e => setFormData({ ...formData, riskLevel: e.target.value as any })}
                      className="w-full bg-zinc-800 border border-white/5 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none"
                    >
                      {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Fecha de Inicio</label>
                    <div className="relative">
                      <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                      <input
                        required
                        type="date"
                        value={formData.startDate}
                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                        className="w-full bg-zinc-800 border border-white/5 rounded-2xl pl-14 pr-5 py-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isCreating}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-black py-5 rounded-3xl transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-3 uppercase tracking-widest text-sm mt-4"
                >
                  {isCreating ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="w-6 h-6" />
                      Crear Proyecto
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
