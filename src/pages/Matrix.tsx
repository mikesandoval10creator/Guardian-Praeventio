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
  Info
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { ZettelkastenNode, NodeType } from '../types';
import { IPERCAnalysis } from '../components/risks/IPERCAnalysis';
import { Modal } from '../components/shared/Modal';
import { where } from 'firebase/firestore';

export function Matrix() {
  const { selectedProject } = useProject();
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Matriz IPERC IA</h1>
          <p className="text-zinc-400 mt-1">Identificación de Peligros, Evaluación de Riesgos y Medidas de Control</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsAIModalOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl font-medium transition-all shadow-lg shadow-violet-600/20 active:scale-95"
          >
            <Zap className="w-5 h-5" />
            <span>Análisis IA</span>
          </button>
          <button className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/20 active:scale-95">
            <Plus className="w-5 h-5" />
            <span>Manual</span>
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[
          { label: 'Riesgos Críticos', value: ipercNodes.filter(n => n.metadata?.criticidad === 'Crítica' || n.metadata?.criticidad === 'Alta').length, icon: AlertTriangle, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'Riesgos Medios', value: ipercNodes.filter(n => n.metadata?.criticidad === 'Media').length, icon: Info, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Controles Activos', value: ipercNodes.length * 2, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
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

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar en la matriz..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-zinc-900/50 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl px-4 py-2.5 transition-all">
          <Filter className="w-5 h-5" />
          <span>Filtros</span>
        </button>
      </div>

      {/* Matrix Table/List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
        </div>
      ) : ipercNodes.length > 0 ? (
        <div className="space-y-4">
          {ipercNodes.map((node, index) => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-zinc-900/50 border border-white/10 rounded-2xl p-5 hover:border-emerald-500/30 transition-all group cursor-pointer"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4 flex-1">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center border border-white/5 ${
                    (node.metadata?.criticidad === 'Crítica' || node.metadata?.criticidad === 'Alta') ? 'bg-rose-500/10 text-rose-500' : 
                    node.metadata?.criticidad === 'Media' ? 'bg-amber-500/10 text-amber-500' : 
                    'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg group-hover:text-emerald-400 transition-colors">{node.title}</h3>
                    <p className="text-zinc-500 text-sm line-clamp-1">{node.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Criticidad:</span>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${
                        (node.metadata?.criticidad === 'Crítica' || node.metadata?.criticidad === 'Alta') ? 'text-rose-500' : 
                        node.metadata?.criticidad === 'Media' ? 'text-amber-500' : 
                        'text-emerald-500'
                      }`}>
                        {node.metadata?.criticidad || 'Baja'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden md:block">
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Controles</p>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <div className="w-2 h-2 rounded-full bg-zinc-700" />
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-emerald-500 transition-colors" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-3xl p-20 text-center">
          <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <BarChart3 className="w-10 h-10 text-zinc-600" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Matriz vacía</h3>
          <p className="text-zinc-500 max-w-md mx-auto">
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
