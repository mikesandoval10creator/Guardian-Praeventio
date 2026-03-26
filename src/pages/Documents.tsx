import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Folder, 
  FileText, 
  Search, 
  Plus, 
  Filter, 
  Download, 
  MoreVertical, 
  Clock, 
  Shield, 
  CheckCircle2,
  Loader2,
  X,
  Upload
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { db, serverTimestamp } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';

import { AddDocumentModal } from '../components/documents/AddDocumentModal';

interface Document {
  id: string;
  name: string;
  type: string;
  category: string;
  version: string;
  status: 'Vigente' | 'Vencido' | 'Pendiente';
  updatedAt: string;
  url?: string;
  projectId: string;
}

import { useNavigate } from 'react-router-dom';

export function Documents() {
  const { selectedProject } = useProject();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [isAdding, setIsAdding] = useState(false);

  const { data: documents, loading } = useFirestoreCollection<Document>(
    selectedProject ? `projects/${selectedProject.id}/documents` : null
  );

  const categories = ['Todos', 'Legal', 'Técnico', 'SST', 'Administrativo'];

  const filteredDocs = (documents || []).filter(doc => {
    const matchesSearch = doc.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === 'Todos' || doc.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Gestión Documental</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Repositorio Central de Evidencia y Cumplimiento
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-white text-black px-6 py-3 sm:py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl shadow-white/5 flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <Upload className="w-4 h-4" />
            <span>Subir Documento</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Vigentes', value: (documents || []).filter(d => d.status === 'Vigente').length, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Por Vencer', value: (documents || []).filter(d => d.status === 'Pendiente').length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Críticos', value: (documents || []).filter(d => d.status === 'Vencido').length, icon: Shield, color: 'text-red-500', bg: 'bg-red-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 flex items-center gap-4"
          >
            <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center border border-white/5`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</p>
              <p className="text-xl font-black text-white tracking-tight">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar documentos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900/50 border border-white/10 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-xs sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 sm:px-6 py-2.5 sm:py-4 rounded-xl sm:rounded-2xl text-[8px] sm:text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
                activeCategory === cat 
                  ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/20' 
                  : 'bg-zinc-900/50 text-zinc-500 border-white/5 hover:border-white/10 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Documents List */}
      <div className="bg-zinc-900/30 border border-white/5 rounded-2xl sm:rounded-[2.5rem] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Nombre del Archivo</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Categoría</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Versión</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Estado</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Última Modificación</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 sm:px-6 py-10 sm:py-20 text-center">
                    <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-500 animate-spin mx-auto mb-3 sm:mb-4" />
                    <p className="text-[8px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest">Sincronizando Archivos...</p>
                  </td>
                </tr>
              ) : filteredDocs.length > 0 ? (
                filteredDocs.map((doc) => (
                  <tr key={doc.id} className="group hover:bg-white/5 transition-colors">
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div 
                        className="flex items-center gap-2 sm:gap-3 cursor-pointer"
                        onClick={() => navigate(`/documents/${doc.id}`)}
                      >
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-zinc-800 flex items-center justify-center border border-white/5 shrink-0">
                          <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-white uppercase tracking-tight hover:text-emerald-400 transition-colors truncate">{doc.name}</p>
                          <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest truncate">{doc.type || 'Documento IA'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-wider">{doc.category}</span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-wider">v{doc.version || '1.0'}</span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest whitespace-nowrap ${
                        doc.status === 'Vigente' ? 'bg-emerald-500/10 text-emerald-500' :
                        doc.status === 'Vencido' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-[8px] sm:text-[9px] font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                        {new Date(doc.updatedAt || (doc as any).uploadDate || (doc as any).createdAt || new Date()).toLocaleDateString('es-CL')}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-1 sm:gap-2">
                        <button 
                          onClick={() => navigate(`/documents/${doc.id}`)}
                          className="p-1.5 sm:p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-all"
                          title="Ver Documento"
                        >
                          <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
                        </button>
                        {doc.url ? (
                          <a 
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 sm:p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-all"
                            title="Descargar Original"
                          >
                            <Download className="w-3 h-3 sm:w-4 sm:h-4" />
                          </a>
                        ) : (
                          <button disabled className="p-1.5 sm:p-2 rounded-lg text-zinc-600 cursor-not-allowed" title="Sin archivo original">
                            <Download className="w-3 h-3 sm:w-4 sm:h-4" />
                          </button>
                        )}
                        <button className="p-1.5 sm:p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-all">
                          <MoreVertical className="w-3 h-3 sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 sm:px-6 py-10 sm:py-20 text-center">
                    <Folder className="w-8 h-8 sm:w-12 sm:h-12 text-zinc-800 mx-auto mb-3 sm:mb-4" />
                    <p className="text-[10px] sm:text-sm font-bold text-zinc-500 uppercase tracking-widest">No se encontraron documentos</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {selectedProject && (
        <AddDocumentModal 
          isOpen={isAdding} 
          onClose={() => setIsAdding(false)} 
          projectId={selectedProject.id} 
        />
      )}
    </div>
  );
}
