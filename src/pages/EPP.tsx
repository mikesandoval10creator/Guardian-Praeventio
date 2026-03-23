import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, 
  Search, 
  Plus, 
  Filter, 
  Loader2, 
  Package, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  ArrowRight,
  X,
  UserPlus
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { EPPItem, EPPAssignment, Worker } from '../types';
import { db, serverTimestamp } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { AssignEPPModal } from '../components/epp/AssignEPPModal';

export function EPP() {
  const { selectedProject } = useProject();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [isAdding, setIsAdding] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  
  const [newItem, setNewItem] = useState({
    name: '',
    category: '',
    description: '',
    imageUrl: '',
    required: false,
    stock: 0
  });

  const { data: eppItems, loading } = useFirestoreCollection<EPPItem>(
    selectedProject ? `projects/${selectedProject.id}/epp_items` : null
  );

  const { data: eppAssignments } = useFirestoreCollection<EPPAssignment>(
    selectedProject ? `projects/${selectedProject.id}/epp_assignments` : null
  );

  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : null
  );

  const categories = ['Todos', ...new Set((eppItems || []).map(item => item.category))];

  const filteredEPP = (eppItems || []).filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === 'Todos' || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;

    try {
      await addDoc(collection(db, `projects/${selectedProject.id}/epp_items`), {
        ...newItem,
        projectId: selectedProject.id,
        createdAt: serverTimestamp()
      });
      setIsAdding(false);
      setNewItem({ name: '', category: '', description: '', imageUrl: '', required: false, stock: 0 });
    } catch (error) {
      console.error('Error adding EPP item:', error);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter">Gestión de EPP</h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] mt-2">
            Catálogo Maestro e Inventario de Seguridad
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-zinc-900/50 border border-white/10 rounded-2xl px-4 py-2 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Package className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Total Items</p>
              <p className="text-sm font-bold text-white">{eppItems?.length || 0}</p>
            </div>
          </div>
          <button 
            onClick={() => setIsAssigning(true)}
            className="bg-zinc-800 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-700 transition-all shadow-xl shadow-black/5 flex items-center gap-2 border border-white/10"
          >
            <UserPlus className="w-4 h-4" />
            <span>Asignar EPP</span>
          </button>
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-white text-black px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl shadow-white/5 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir al Catálogo</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'En Stock', value: (eppItems || []).reduce((acc, item) => acc + (item.stock || 0), 0).toString(), icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Por Reponer', value: (eppItems || []).filter(item => (item.stock || 0) < 10).length.toString(), icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Vencimientos', value: '0', icon: Clock, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Asignados', value: (eppAssignments || []).filter(a => a.status === 'active').length.toString(), icon: Shield, color: 'text-blue-500', bg: 'bg-blue-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-zinc-900/50 border border-white/5 rounded-3xl p-6 flex items-center gap-4 group hover:border-white/10 transition-all"
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
            placeholder="Buscar EPP por nombre o descripción..."
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

      {/* Catalog Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredEPP.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            className="bg-zinc-900/30 border border-white/5 rounded-[2.5rem] p-6 group hover:border-emerald-500/30 transition-all relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-6">
              <div className={`w-2 h-2 rounded-full ${item.required ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-zinc-700'}`} />
            </div>

            <div className="aspect-square rounded-3xl bg-zinc-800/50 border border-white/5 mb-6 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform duration-500">
              <img 
                src={item.imageUrl || undefined} 
                alt={item.name}
                className="w-3/4 h-3/4 object-contain opacity-80 group-hover:opacity-100 transition-opacity"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                  {item.category}
                </span>
              </div>
              <h3 className="text-lg font-black text-white uppercase tracking-tight leading-tight">
                {item.name}
              </h3>
              <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                {item.description}
              </p>
            </div>

            <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Stock Disponible</span>
                <span className="text-sm font-bold text-white">{item.stock || 0} u.</span>
              </div>
              <button className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-emerald-500 transition-all group/btn">
                <ArrowRight className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {filteredEPP.length === 0 && !loading && (
        <div className="text-center py-20 bg-zinc-900/20 rounded-[3rem] border border-dashed border-white/5">
          <Shield className="w-16 h-16 text-zinc-800 mx-auto mb-6" />
          <h3 className="text-xl font-black text-white uppercase tracking-tight">No se encontraron items</h3>
          <p className="text-zinc-500 text-sm mt-2 uppercase tracking-widest font-bold">Ajusta tus filtros de búsqueda</p>
        </div>
      )}

      {/* Add EPP Modal */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-white/10 rounded-3xl p-6 w-full max-w-md relative"
            >
              <button
                onClick={() => setIsAdding(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-6">Añadir EPP</h2>

              <form onSubmit={handleAddItem} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Nombre</label>
                  <input
                    type="text"
                    required
                    value={newItem.name}
                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                    className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    placeholder="Ej: Casco de Seguridad"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Categoría</label>
                  <input
                    type="text"
                    required
                    value={newItem.category}
                    onChange={e => setNewItem({ ...newItem, category: e.target.value })}
                    className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    placeholder="Ej: Protección de Cabeza"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Descripción</label>
                  <textarea
                    required
                    value={newItem.description}
                    onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                    className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none h-24"
                    placeholder="Descripción del EPP..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Stock Inicial</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={newItem.stock}
                      onChange={e => setNewItem({ ...newItem, stock: parseInt(e.target.value) || 0 })}
                      className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">URL Imagen</label>
                    <input
                      type="url"
                      value={newItem.imageUrl}
                      onChange={e => setNewItem({ ...newItem, imageUrl: e.target.value })}
                      className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="required"
                    checked={newItem.required}
                    onChange={e => setNewItem({ ...newItem, required: e.target.checked })}
                    className="w-5 h-5 rounded border-white/10 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-zinc-900"
                  />
                  <label htmlFor="required" className="text-sm font-bold text-white">
                    EPP Obligatorio
                  </label>
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 text-white font-black uppercase tracking-widest py-4 rounded-xl hover:bg-emerald-600 transition-colors mt-6"
                >
                  Guardar Item
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AssignEPPModal
        isOpen={isAssigning}
        onClose={() => setIsAssigning(false)}
        projectId={selectedProject?.id}
        eppItems={eppItems || []}
        workers={workers || []}
      />
    </div>
  );
}
