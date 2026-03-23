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

export function Documents() {
  const { selectedProject } = useProject();
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

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    // Mock add for now
    try {
      await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
        name: 'Nuevo Documento',
        type: 'PDF',
        category: 'SST',
        version: '1.0',
        status: 'Vigente',
        updatedAt: new Date().toISOString(),
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });
      setIsAdding(false);
    } catch (error) {
      console.error('Error adding document:', error);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">Gestión Documental</h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] mt-2">
            Repositorio Central de Evidencia y Cumplimiento
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-white text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl shadow-white/5 flex items-center gap-2"
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
          { label: 'Por Vencer', value: '0', icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Críticos', value: '0', icon: Shield, color: 'text-red-500', bg: 'bg-red-500/10' },
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
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar documentos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 md:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
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
      <div className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-6 py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Nombre del Archivo</th>
                <th className="px-6 py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Categoría</th>
                <th className="px-6 py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Versión</th>
                <th className="px-6 py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Estado</th>
                <th className="px-6 py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Última Modificación</th>
                <th className="px-6 py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Sincronizando Archivos...</p>
                  </td>
                </tr>
              ) : filteredDocs.length > 0 ? (
                filteredDocs.map((doc) => (
                  <tr key={doc.id} className="group hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center border border-white/5">
                          <FileText className="w-5 h-5 text-zinc-400" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white uppercase tracking-tight">{doc.name}</p>
                          <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">{doc.type}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">{doc.category}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">v{doc.version}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${
                        doc.status === 'Vigente' ? 'bg-emerald-500/10 text-emerald-500' :
                        doc.status === 'Vencido' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                        {new Date(doc.updatedAt).toLocaleDateString('es-CL')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-all">
                          <Download className="w-4 h-4" />
                        </button>
                        <button className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-all">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <Folder className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                    <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest">No se encontraron documentos</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
