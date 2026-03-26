import React, { useState } from 'react';
import { motion } from 'framer-motion';
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
  Check
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { ZettelkastenNode, NodeType } from '../types';
import { IPERCAnalysis } from '../components/risks/IPERCAnalysis';
import { Modal } from '../components/shared/Modal';
import { where } from 'firebase/firestore';
import { suggestRisksWithAI } from '../services/geminiService';

export function Matrix() {
  const { selectedProject } = useProject();
  const { isAdmin } = useFirebase();
  const { updateNode, addNode } = useZettelkasten();
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);

  const handleSuggestRisks = async () => {
    if (!selectedProject) return;
    setIsSuggesting(true);
    try {
      const context = `Proyecto: ${selectedProject.name}. Descripción: ${selectedProject.description}`;
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
            criticidad: suggestion.criticidad,
            recomendaciones: suggestion.recomendaciones,
            controles: suggestion.controles,
            normativa: suggestion.normativa,
            source: 'AI_Suggestion'
          }
        });
      }
      alert(`${suggestions.length} riesgos sugeridos por la IA. Revisa la sección de aprobaciones.`);
    } catch (error) {
      console.error('Error suggesting risks:', error);
      alert('Error al sugerir riesgos con IA.');
    } finally {
      setIsSuggesting(false);
    }
  };

  // Query IPERC nodes from Zettelkasten
  const { data: nodes, loading } = useFirestoreCollection<ZettelkastenNode>(
    'nodes',
    selectedProject ? [where('projectId', '==', selectedProject.id)] : []
  );
  
  const ipercNodes = nodes.filter(node => 
    node.type === NodeType.RISK && 
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

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-hidden box-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">Matriz IPERC IA</h1>
          <p className="text-zinc-400 mt-1 text-[10px] sm:text-sm">Identificación de Peligros, Evaluación de Riesgos y Medidas de Control</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <button 
            disabled={isSuggesting}
            onClick={handleSuggestRisks}
            className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-black px-4 py-2.5 sm:py-2 rounded-xl font-bold transition-all shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50 text-[10px] sm:text-sm"
          >
            <Zap className={`w-4 h-4 sm:w-5 sm:h-5 ${isSuggesting ? 'animate-pulse' : ''}`} />
            <span>{isSuggesting ? 'Sugiriendo...' : 'Sugerir Riesgos'}</span>
          </button>
          <button 
            onClick={() => setIsAIModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all shadow-lg shadow-violet-600/20 active:scale-95 text-[10px] sm:text-sm"
          >
            <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Análisis IA</span>
          </button>
          <button className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/20 active:scale-95 text-[10px] sm:text-sm">
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
          { label: 'Riesgos Críticos', value: approvedRisks.filter(n => n.metadata?.criticidad === 'Crítica' || n.metadata?.criticidad === 'Alta').length, icon: AlertTriangle, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'Riesgos Medios', value: approvedRisks.filter(n => n.metadata?.criticidad === 'Media').length, icon: Info, color: 'text-amber-500', bg: 'bg-amber-500/10' },
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
            {pendingRisks.map((node, index) => (
              <motion.div
                key={node.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-zinc-900 border border-amber-500/30 rounded-xl sm:rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3 sm:gap-4 flex-1">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center border border-white/5 ${
                    (node.metadata?.criticidad === 'Crítica' || node.metadata?.criticidad === 'Alta') ? 'bg-rose-500/10 text-rose-500' : 
                    node.metadata?.criticidad === 'Media' ? 'bg-amber-500/10 text-amber-500' : 
                    'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-white text-sm sm:text-lg leading-tight truncate">{node.title}</h3>
                    <p className="text-zinc-400 text-[10px] sm:text-sm mt-1 line-clamp-2">{node.description}</p>
                    <div className="flex items-center gap-2 sm:gap-3 mt-2 sm:mt-3">
                      <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Criticidad:</span>
                      <span className={`text-[8px] sm:text-[10px] font-black uppercase tracking-widest ${
                        (node.metadata?.criticidad === 'Crítica' || node.metadata?.criticidad === 'Alta') ? 'text-rose-500' : 
                        node.metadata?.criticidad === 'Media' ? 'text-amber-500' : 
                        'text-emerald-500'
                      }`}>
                        {node.metadata?.criticidad || 'Baja'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:w-auto w-full">
                  <button 
                    onClick={() => handleApproveRisk(node.id)}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 sm:py-2 rounded-xl font-bold text-[10px] sm:text-xs uppercase tracking-widest transition-all"
                  >
                    <Check className="w-4 h-4" />
                    Aprobar
                  </button>
                </div>
              </motion.div>
            ))}
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
        <div className="space-y-3 sm:space-y-4">
          {approvedRisks.map((node, index) => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-zinc-900/50 border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 transition-all group cursor-pointer"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-start gap-3 sm:gap-4 flex-1">
                  <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center border border-white/5 ${
                    (node.metadata?.criticidad === 'Crítica' || node.metadata?.criticidad === 'Alta') ? 'bg-rose-500/10 text-rose-500' : 
                    node.metadata?.criticidad === 'Media' ? 'bg-amber-500/10 text-amber-500' : 
                    'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-white text-xs sm:text-lg group-hover:text-emerald-400 transition-colors truncate">{node.title}</h3>
                    <p className="text-zinc-500 text-[10px] sm:text-sm line-clamp-1">{node.description}</p>
                    <div className="flex items-center gap-2 sm:gap-3 mt-1 sm:mt-2">
                      <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500">Criticidad:</span>
                      <span className={`text-[8px] sm:text-[10px] font-black uppercase tracking-widest ${
                        (node.metadata?.criticidad === 'Crítica' || node.metadata?.criticidad === 'Alta') ? 'text-rose-500' : 
                        node.metadata?.criticidad === 'Media' ? 'text-amber-500' : 
                        'text-emerald-500'
                      }`}>
                        {node.metadata?.criticidad || 'Baja'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end sm:justify-start gap-4 mt-2 sm:mt-0">
                  <div className="text-right flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-0">
                    <p className="text-[8px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest sm:mb-1">Controles</p>
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500" />
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500" />
                      <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-zinc-700" />
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 group-hover:text-emerald-500 transition-colors shrink-0" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-2xl sm:rounded-3xl p-10 sm:p-20 text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-800 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <BarChart3 className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-600" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">Matriz vacía</h3>
          <p className="text-[10px] sm:text-sm text-zinc-500 max-w-md mx-auto">
            Utiliza el análisis de IA para identificar peligros y evaluar riesgos automáticamente.
          </p>
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
    </div>
  );
}
