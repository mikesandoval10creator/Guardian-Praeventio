import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  Search, 
  Filter, 
  Plus,
  BarChart3,
  ChevronRight,
  Info,
  Check,
  WifiOff,
  RefreshCw,
  X,
  BrainCircuit,
  User,
  Calendar as CalendarIcon,
  Save,
  Loader2,
  Database,
  Briefcase
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { RiskNode, NodeType, Worker } from '../types';
import { IPERCAnalysis } from '../components/risks/IPERCAnalysis';
import { Modal } from '../components/shared/Modal';
import { where, addDoc, collection as firestoreCollection, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { suggestRisksWithAI } from '../services/geminiService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { INDUSTRY_IPER_BASE } from '../data/industryIPER';

const getCriticalityColor = (criticidad?: string) => {
  switch (criticidad?.toLowerCase()) {
    case 'crítica': return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
    case 'alta': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
    case 'media': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    case 'baja': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    default: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
  }
};

const getCriticalityTextColor = (criticidad?: string) => {
  switch (criticidad?.toLowerCase()) {
    case 'crítica': return 'text-rose-500';
    case 'alta': return 'text-orange-500';
    case 'media': return 'text-amber-500';
    case 'baja': return 'text-emerald-500';
    default: return 'text-zinc-500';
  }
};

export function Matrix() {
  const { selectedProject } = useProject();
  const { isAdmin } = useFirebase();
  const { updateNode, addNode, deleteNode, nodes } = useRiskEngine();
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [manualRisk, setManualRisk] = useState({
    title: '',
    description: '',
    probabilidad: 3,
    severidad: 3,
    controles: ''
  });
  const isOnline = useOnlineStatus();

  // Fetch workers for assignment
  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : null
  );

  const handleSeedMatrix = async () => {
    if (!selectedProject || !isOnline) return;
    setIsSeeding(true);
    try {
      const industryKey = selectedProject.industry || 'General';
      const initialNodes = INDUSTRY_IPER_BASE[industryKey] || INDUSTRY_IPER_BASE['General'];

      for (const node of initialNodes) {
        await addNode({
          title: node.title,
          description: node.description,
          type: NodeType.RISK,
          projectId: selectedProject.id,
          tags: [...node.tags, 'IPER_BASE'],
          connections: [],
          metadata: {
            actividad: node.actividad,
            riesgo: node.riesgo,
            consecuencia: node.consecuencia,
            probabilidad: node.probabilidad,
            severidad: node.severidad,
            criticidad: (node.probabilidad * node.severidad) >= 16 ? 'Crítica' : (node.probabilidad * node.severidad) >= 9 ? 'Alta' : (node.probabilidad * node.severidad) >= 4 ? 'Media' : 'Baja',
            controles: node.controles,
            status: 'approved',
            source: 'Seed'
          }
        });
      }
    } catch (error) {
      console.error('Error seeding matrix:', error);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleAssignControl = async (nodeId: string, workerId: string, deadline: string) => {
    const node = ipercNodes.find(n => n.id === nodeId);
    const worker = workers?.find(w => w.id === workerId);
    if (!node || !worker || !selectedProject) return;

    try {
      // Update node metadata
      await updateNode(nodeId, {
        metadata: {
          ...node.metadata,
          responsibleId: workerId,
          responsibleName: worker.name,
          deadline: deadline
        }
      });

      // Create calendar event
      await addDoc(firestoreCollection(db, `projects/${selectedProject.id}/events`), {
        title: `Control: ${node.title}`,
        description: `Implementar/Verificar medida de control: ${node.metadata?.controles || 'General'}. Responsable: ${worker.name}`,
        date: deadline,
        time: "09:00",
        location: selectedProject.name,
        type: 'Inspección',
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });

      setEditingNode(null);
    } catch (error) {
      console.error('Error assigning control:', error);
    }
  };

  const handleSuggestRisks = async () => {
    if (!selectedProject || !isOnline) return;
    setIsSuggesting(true);
    try {
      const context = `Proyecto: ${selectedProject.name}. Descripción: ${selectedProject.description}. INDUSTRIA: ${selectedProject.industry || 'General'}. Genera riesgos ESPECÍFICOS para esta industria, aplicando protocolos y normativas chilenas correspondientes al rubro.`;
      const suggestions = await suggestRisksWithAI(selectedProject.industry || 'General', context);
      
      for (const suggestion of suggestions) {
        await addNode({
          title: suggestion.title,
          description: suggestion.description,
          type: NodeType.RISK,
          projectId: selectedProject.id,
          tags: [selectedProject.industry || 'General', 'AI_Suggestion'],
          connections: [],
          metadata: {
            status: 'pending_approval',
            probabilidad: suggestion.probabilidad,
            severidad: suggestion.severidad,
            criticidad: suggestion.criticidad,
            recomendaciones: suggestion.recomendaciones,
            controles: suggestion.controles.join(', '),
            normativa: suggestion.normativa,
            source: 'AI_Suggestion'
          }
        });
      }
    } catch (error) {
      console.error('Error suggesting risks:', error);
      alert('Error al sugerir riesgos con IA.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    
    try {
      const score = manualRisk.probabilidad * manualRisk.severidad;
      const criticality = score >= 16 ? 'Crítica' : score >= 9 ? 'Alta' : score >= 4 ? 'Media' : 'Baja';

      await addNode({
        title: manualRisk.title,
        description: manualRisk.description,
        type: NodeType.RISK,
        projectId: selectedProject.id,
        tags: [selectedProject.industry || 'General', 'Manual'],
        connections: [],
        metadata: {
          probabilidad: manualRisk.probabilidad,
          severidad: manualRisk.severidad,
          criticidad: criticality,
          controles: manualRisk.controles,
          status: 'approved',
          source: 'Manual'
        }
      });
      
      setIsManualModalOpen(false);
      setManualRisk({ title: '', description: '', probabilidad: 3, severidad: 3, controles: '' });
    } catch (error) {
      console.error('Error adding manual risk:', error);
    }
  };

  // Query IPERC nodes from Risk Engine
  const ipercNodes = nodes.filter(node => 
    node.type === NodeType.RISK && 
    node.projectId === selectedProject?.id &&
    (node.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
     node.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const approvedRisks = ipercNodes.filter(node => node.metadata?.status !== 'pending_approval');
  const pendingRisks = ipercNodes.filter(node => node.metadata?.status === 'pending_approval');

  const handleApproveRisk = async (nodeId: string) => {
    const node = pendingRisks.find(n => n.id === nodeId);
    if (!node) return;
    
    await updateNode(nodeId, {
      metadata: {
        ...node.metadata,
        status: 'approved'
      }
    });
  };

  const handleRejectRisk = async (nodeId: string) => {
    await deleteNode(nodeId);
  };

  if (!selectedProject) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full h-full flex flex-col items-center justify-center min-h-[70vh]">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900/40 border border-white/5 rounded-[40px] p-8 sm:p-16 text-center max-w-3xl w-full backdrop-blur-xl relative overflow-hidden shadow-2xl"
        >
          {/* Decorative background elements */}
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
          
          <div className="relative z-10">
            <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-[40px] flex items-center justify-center mx-auto mb-10 shadow-2xl border border-white/5 group">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Grid className="w-8 h-8 text-emerald-500" />
              </div>
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-6 tracking-tight">
              Matriz IPER Inteligente
            </h2>
            
            <p className="text-zinc-400 text-base sm:text-lg leading-relaxed mb-12 max-w-xl mx-auto">
              Diseñe su Matriz de Identificación de Peligros y Evaluación de Riesgos con precisión quirúrgica. Seleccione un proyecto para cargar los protocolos específicos de su rubro.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              <button 
                onClick={() => {
                  const sidebarBtn = document.querySelector('[aria-label="Abrir Menú"]') as HTMLButtonElement;
                  if (sidebarBtn) sidebarBtn.click();
                }}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-emerald-500 hover:bg-emerald-600 text-white px-10 py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all shadow-xl shadow-emerald-500/30 active:scale-95"
              >
                <Plus className="w-5 h-5" />
                Vincular Proyecto
              </button>
              
              <Link 
                to="/projects"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-white/5 hover:bg-white/10 text-white px-10 py-5 rounded-2xl font-black text-sm uppercase tracking-widest transition-all border border-white/10 active:scale-95"
              >
                <Briefcase className="w-5 h-5" />
                Gestión de Proyectos
              </Link>
            </div>
            
            <div className="mt-16 pt-10 border-t border-white/5 grid grid-cols-3 gap-8">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-emerald-500/50" />
                  <p className="text-2xl font-black text-white">0</p>
                </div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Peligros ID</p>
              </div>
              <div className="text-center border-x border-white/5">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-amber-500/50" />
                  <p className="text-2xl font-black text-white">0%</p>
                </div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Efectividad</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <CalendarIcon className="w-4 h-4 text-blue-500/50" />
                  <p className="text-2xl font-black text-white">0</p>
                </div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Controles</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-hidden box-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">Matriz IPERC IA</h1>
          <p className="text-zinc-400 mt-1 text-[10px] sm:text-sm">Identificación de Peligros, Evaluación de Riesgos y Medidas de Control</p>
          {selectedProject?.industry && (
            <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/20">
              <Shield className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Protocolos: {selectedProject.industry}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <button 
            disabled={isSuggesting || !isOnline}
            onClick={handleSuggestRisks}
            className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-black px-4 py-2.5 sm:py-2 rounded-xl font-bold transition-all shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50 text-[10px] sm:text-sm disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
          >
            {!isOnline ? <WifiOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Zap className={`w-4 h-4 sm:w-5 sm:h-5 ${isSuggesting ? 'animate-pulse' : ''}`} />}
            <span>{!isOnline ? 'Requiere Conexión' : isSuggesting ? 'Sugiriendo...' : 'Auto-Completar por Industria'}</span>
          </button>
          <button 
            disabled={!isOnline}
            onClick={() => setIsAIModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all shadow-lg shadow-violet-600/20 active:scale-95 text-[10px] sm:text-sm disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
          >
            {!isOnline ? <WifiOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <BrainCircuit className="w-4 h-4 sm:w-5 sm:h-5" />}
            <span>{!isOnline ? 'Requiere Conexión' : 'Análisis IA'}</span>
          </button>
          <button 
            onClick={() => setIsManualModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/20 active:scale-95 text-[10px] sm:text-sm"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Manual</span>
          </button>
        </div>
      </div>

      {/* Dynamic Industry Protocols */}
      {selectedProject && (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-6 mb-8 flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center shrink-0">
            <Shield className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-sm font-black text-indigo-400 uppercase tracking-widest mb-1">Protocolos Dinámicos Activos</h2>
            <p className="text-zinc-300 text-sm leading-relaxed">
              El sistema ha recalibrado automáticamente las exigencias de seguridad y parámetros de estrés para el sector <span className="font-bold text-white">{selectedProject.industry || 'General'}</span>. Las matrices de riesgo y normativas aplicables se han ajustado al entorno operativo actual.
            </p>
          </div>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
        {[
          { label: 'Riesgos Críticos', value: approvedRisks.filter(n => n.metadata?.criticidad?.toLowerCase() === 'crítica' || n.metadata?.criticidad?.toLowerCase() === 'alta').length, icon: AlertTriangle, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'Riesgos Medios', value: approvedRisks.filter(n => n.metadata?.criticidad?.toLowerCase() === 'media').length, icon: Info, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Controles Activos', value: approvedRisks.length * 2, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 flex items-center gap-4">
            <div className={`w-14 h-14 ${stat.bg} rounded-2xl flex items-center justify-center`}>
              <stat.icon className={`w-7 h-7 ${stat.color}`} />
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">{stat.label}</p>
              <h3 className="text-3xl font-bold text-white leading-none">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      {/* Pending Suggestions (Admin Only) */}
      {isAdmin && pendingRisks.length > 0 && (
        <div className="mb-6 sm:mb-8 space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
            <div className="p-2 bg-amber-500/10 rounded-lg shrink-0">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
            </div>
            <h2 className="text-sm sm:text-lg font-bold text-white leading-tight">Sugerencias de IA Pendientes</h2>
            <span className="bg-amber-500 text-black text-[8px] sm:text-[10px] font-black px-2 py-0.5 rounded-full ml-1 sm:ml-2 shrink-0">
              {pendingRisks.length}
            </span>
          </div>
          
          <div className="grid grid-cols-1 gap-3 sm:gap-4">
            <AnimatePresence>
              {pendingRisks.map((node, index) => (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-zinc-900/80 border border-amber-500/30 rounded-xl sm:rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-black/20"
                >
                  <div className="flex items-start gap-3 sm:gap-4 flex-1">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center border ${getCriticalityColor(node.metadata?.criticidad)}`}>
                      <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-white text-sm sm:text-lg leading-tight truncate">{node.title}</h3>
                      <p className="text-zinc-400 text-[10px] sm:text-sm mt-1 line-clamp-2">{node.description}</p>
                      <div className="flex items-center gap-2 sm:gap-3 mt-2 sm:mt-3">
                        <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Criticidad:</span>
                        <span className={`text-[8px] sm:text-[10px] font-black uppercase tracking-widest ${getCriticalityTextColor(node.metadata?.criticidad)}`}>
                          {node.metadata?.criticidad || 'Baja'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:w-auto w-full">
                    <button 
                      onClick={() => handleRejectRisk(node.id)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-500 border border-zinc-700 hover:border-rose-500/30 px-3 py-2.5 sm:py-2 rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-widest transition-all"
                    >
                      <X className="w-4 h-4" />
                      Descartar
                    </button>
                    <button 
                      onClick={() => handleApproveRisk(node.id)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 sm:py-2 rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
                    >
                      <Check className="w-4 h-4" />
                      Aprobar
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="relative flex-1 w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar en la matriz..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2 sm:py-2.5 pl-9 sm:pl-10 pr-4 text-[10px] sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-zinc-900/50 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl px-4 py-2 sm:py-2.5 transition-all text-[10px] sm:text-sm w-full sm:w-auto">
          <Filter className="w-4 h-4 sm:w-5 sm:h-5" />
          <span>Filtros</span>
        </button>
      </div>

      {/* Matrix Table/List */}
      {loading ? (
        <div className="flex items-center justify-center py-10 sm:py-20">
          <div className="animate-spin rounded-full h-8 w-8 sm:h-12 sm:w-12 border-b-2 border-emerald-500"></div>
        </div>
      ) : approvedRisks.length > 0 ? (
        <div className="overflow-x-auto bg-zinc-900/30 border border-white/5 rounded-[2rem] p-4 sm:p-6">
          <table className="w-full text-left border-separate border-spacing-y-3">
            <thead>
              <tr className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                <th className="px-4 py-2">Actividad / Tarea</th>
                <th className="px-4 py-2">Peligro / Riesgo / Consecuencia</th>
                <th className="px-4 py-2 text-center">P x S</th>
                <th className="px-4 py-2">Medidas de Control</th>
                <th className="px-4 py-2">Responsable & Plazo</th>
                <th className="px-4 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {approvedRisks.map((node) => {
                const p = node.metadata?.probabilidad || 1;
                const s = node.metadata?.severidad || 1;
                const score = p * s;
                const criticality = score >= 16 ? 'Crítica' : score >= 9 ? 'Alta' : score >= 4 ? 'Media' : 'Baja';
                
                return (
                  <motion.tr
                    key={node.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-zinc-900/50 hover:bg-zinc-800/50 transition-all group"
                  >
                    <td className="px-4 py-4 rounded-l-2xl border-y border-l border-white/5">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Actividad</span>
                        <h3 className="text-xs font-bold text-white leading-tight">{node.metadata?.actividad || 'General'}</h3>
                      </div>
                    </td>
                    <td className="px-4 py-4 border-y border-white/5">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border ${getCriticalityColor(criticality)}`}>
                          <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">{node.title}</h3>
                          <p className="text-[10px] text-zinc-500 line-clamp-1">Peligro: {node.description}</p>
                          {node.metadata?.consecuencia && (
                            <p className="text-[9px] text-rose-400/70 font-medium mt-0.5 italic">Consecuencia: {node.metadata.consecuencia}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 border-y border-white/5 text-center">
                      <div className="inline-flex flex-col items-center">
                        <span className={`text-xs font-black ${getCriticalityTextColor(criticality)}`}>{p} x {s} = {score}</span>
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-600">{criticality}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 border-y border-white/5">
                      <p className="text-xs text-zinc-300 leading-relaxed max-w-xs">
                        {node.metadata?.controles || 'Sin controles definidos'}
                      </p>
                    </td>
                    <td className="px-4 py-4 border-y border-white/5">
                      {editingNode === node.id ? (
                        <div className="space-y-2 min-w-[200px]">
                          <select 
                            className="w-full bg-zinc-950 border border-white/10 rounded-lg p-1.5 text-[10px] text-white"
                            onChange={(e) => {
                              const workerId = e.target.value;
                              const deadline = (document.getElementById(`deadline-${node.id}`) as HTMLInputElement).value;
                              if (workerId && deadline) handleAssignControl(node.id, workerId, deadline);
                            }}
                          >
                            <option value="">Asignar Responsable...</option>
                            {workers?.map(w => (
                              <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                          </select>
                          <input 
                            id={`deadline-${node.id}`}
                            type="date" 
                            className="w-full bg-zinc-950 border border-white/10 rounded-lg p-1.5 text-[10px] text-white"
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {node.metadata?.responsibleName ? (
                            <>
                              <div className="flex items-center gap-1.5 text-emerald-500">
                                <User className="w-3 h-3" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">{node.metadata.responsibleName}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-zinc-500">
                                <CalendarIcon className="w-3 h-3" />
                                <span className="text-[10px] font-bold">{node.metadata.deadline ? format(new Date(node.metadata.deadline), 'dd/MM/yyyy') : 'Sin fecha'}</span>
                              </div>
                            </>
                          ) : (
                            <button 
                              onClick={() => setEditingNode(node.id)}
                              className="text-[10px] font-black text-zinc-500 hover:text-white uppercase tracking-widest flex items-center gap-1.5"
                            >
                              <Plus className="w-3 h-3" />
                              Asignar Control
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 rounded-r-2xl border-y border-r border-white/5 text-right">
                      <button className="p-2 hover:bg-white/5 rounded-xl text-zinc-600 hover:text-emerald-500 transition-all">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-2xl sm:rounded-3xl p-10 sm:p-20 text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-800 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <Database className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-600" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">Matriz IPER no inicializada</h3>
          <p className="text-[10px] sm:text-sm text-zinc-500 max-w-md mx-auto mb-6">
            No se han encontrado riesgos definidos para este proyecto. Puedes sembrar la matriz base o usar la IA para generar riesgos específicos.
          </p>
          <button 
            onClick={handleSeedMatrix}
            disabled={isSeeding || !isOnline}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all shadow-xl shadow-emerald-500/20 disabled:opacity-50"
          >
            {isSeeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Sembrar Matriz Base
          </button>
        </div>
      )}

      {/* AI Analysis Modal */}
      <Modal 
        isOpen={isAIModalOpen} 
        onClose={() => setIsAIModalOpen(false)}
        title="Análisis IPERC con IA"
      >
        <IPERCAnalysis onClose={() => setIsAIModalOpen(false)} />
      </Modal>

      {/* Manual Entry Modal */}
      <Modal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        title="Nueva Identificación de Peligro"
      >
        <form onSubmit={handleManualSubmit} className="space-y-4 p-1">
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Título del Peligro / Riesgo</label>
            <input 
              required
              type="text"
              value={manualRisk.title}
              onChange={e => setManualRisk({...manualRisk, title: e.target.value})}
              placeholder="Ej: Caída a distinto nivel"
              className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-sm text-white focus:ring-2 focus:ring-emerald-500/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Descripción del Evento</label>
            <textarea 
              required
              value={manualRisk.description}
              onChange={e => setManualRisk({...manualRisk, description: e.target.value})}
              placeholder="Describa cómo ocurre el riesgo..."
              className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-sm text-white h-24 focus:ring-2 focus:ring-emerald-500/50 transition-all"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Probabilidad (1-5)</label>
              <select 
                value={manualRisk.probabilidad}
                onChange={e => setManualRisk({...manualRisk, probabilidad: parseInt(e.target.value)})}
                className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-sm text-white focus:ring-2 focus:ring-emerald-500/50 transition-all"
              >
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Severidad (1-5)</label>
              <select 
                value={manualRisk.severidad}
                onChange={e => setManualRisk({...manualRisk, severidad: parseInt(e.target.value)})}
                className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-sm text-white focus:ring-2 focus:ring-emerald-500/50 transition-all"
              >
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">Medidas de Control</label>
            <textarea 
              required
              value={manualRisk.controles}
              onChange={e => setManualRisk({...manualRisk, controles: e.target.value})}
              placeholder="EPP, procedimientos, barreras físicas..."
              className="w-full bg-zinc-900 border border-white/10 rounded-xl p-3 text-sm text-white h-24 focus:ring-2 focus:ring-emerald-500/50 transition-all"
            />
          </div>
          <button 
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-emerald-500/20"
          >
            Guardar en Matriz
          </button>
        </form>
      </Modal>
    </div>
  );
}

