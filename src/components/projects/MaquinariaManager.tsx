import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Truck, 
  Settings, 
  AlertTriangle, 
  CheckCircle2, 
  Plus, 
  Search, 
  Filter, 
  Loader2, 
  Calendar,
  User,
  Wrench,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection';
import { db, collection, addDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import { where } from 'firebase/firestore';
import { Asset } from '../../types';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { saveForSync } from '../../utils/pwa-offline';

interface MaquinariaManagerProps {
  projectId: string;
}

export function MaquinariaManager({ projectId }: MaquinariaManagerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const isOnline = useOnlineStatus();
  
  const { data: assets, loading: fetching } = useFirestoreCollection<Asset>(
    'assets',
    [where('projectId', '==', projectId)]
  );

  const [formData, setFormData] = useState({
    name: '',
    type: 'Maquinaria' as const,
    status: 'Operativo' as const,
    lastMaintenance: '',
    nextMaintenance: '',
    operatorId: ''
  });

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const assetData = {
        ...formData,
        projectId,
        createdAt: new Date().toISOString()
      };

      if (!isOnline) {
        await saveForSync({
          type: 'create',
          collection: 'assets',
          data: assetData
        });
        alert('Activo guardado para sincronización cuando haya conexión.');
      } else {
        await addDoc(collection(db, 'assets'), assetData);
      }
      
      setIsAdding(false);
      setFormData({
        name: '',
        type: 'Maquinaria',
        status: 'Operativo',
        lastMaintenance: '',
        nextMaintenance: '',
        operatorId: ''
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'assets');
    } finally {
      setLoading(false);
    }
  };

  const filteredAssets = assets.filter(a => 
    a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    a.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <Truck className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Gestión de Activos</h3>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Maquinaria, Vehículos y Herramientas</p>
          </div>
        </div>
        
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all border bg-zinc-800 hover:bg-zinc-700 text-white border-white/5"
        >
          {isAdding ? (
            <X className="w-4 h-4" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          <span>{isAdding ? 'Cancelar' : 'Añadir Activo'}</span>
        </button>
      </div>

      {isAdding && (
        <motion.form 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleAddAsset}
          className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Nombre del Activo</label>
              <input
                required
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ej: Excavadora CAT 320"
                className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Tipo</label>
              <select
                value={formData.type}
                onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all appearance-none"
              >
                <option value="Maquinaria">Maquinaria</option>
                <option value="Vehículo">Vehículo</option>
                <option value="Herramienta">Herramienta</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Estado</label>
              <select
                value={formData.status}
                onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all appearance-none"
              >
                <option value="Operativo">Operativo</option>
                <option value="En Mantenimiento">En Mantenimiento</option>
                <option value="Fuera de Servicio">Fuera de Servicio</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Próximo Mantenimiento</label>
              <input
                type="date"
                value={formData.nextMaintenance}
                onChange={e => setFormData({ ...formData, nextMaintenance: e.target.value })}
                className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
              />
            </div>
            <div className="space-y-1.5 flex items-end">
              <button
                type="submit"
                disabled={loading}
                className="w-full font-black py-3 rounded-xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Guardar Activo
              </button>
            </div>
          </div>
        </motion.form>
      )}

      {/* Search & Filters */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Buscar maquinaria o vehículos..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500/50 transition-all"
        />
      </div>

      {/* Assets List */}
      <div className="grid grid-cols-1 gap-3">
        {fetching ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          </div>
        ) : filteredAssets.length > 0 ? (
          filteredAssets.map((asset) => (
            <motion.div
              key={asset.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-zinc-900/30 border border-white/5 rounded-2xl p-4 flex items-center justify-between group hover:border-white/10 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border border-white/5 ${
                  asset.status === 'Operativo' ? 'bg-emerald-500/10 text-emerald-500' :
                  asset.status === 'En Mantenimiento' ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'
                }`}>
                  {asset.type === 'Maquinaria' ? <Settings className="w-6 h-6" /> : 
                   asset.type === 'Vehículo' ? <Truck className="w-6 h-6" /> : <Wrench className="w-6 h-6" />}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white uppercase tracking-tight">{asset.name}</h4>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{asset.type}</span>
                    <span className={`text-[9px] font-black uppercase tracking-widest ${
                      asset.status === 'Operativo' ? 'text-emerald-500' :
                      asset.status === 'En Mantenimiento' ? 'text-amber-500' : 'text-red-500'
                    }`}>
                      {asset.status}
                    </span>
                    {asset.isPendingSync && (
                      <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[8px] font-black uppercase tracking-widest flex items-center gap-1">
                        <RefreshCw className="w-2 h-2 animate-spin" />
                        Pendiente
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="hidden md:flex items-center gap-6">
                {asset.nextMaintenance && (
                  <div className="text-right">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Próx. Mantenimiento</p>
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <Calendar className="w-3 h-3" />
                      <span className="text-[10px] font-bold">{new Date(asset.nextMaintenance).toLocaleDateString('es-CL')}</span>
                    </div>
                  </div>
                )}
                <div className="w-px h-8 bg-white/5" />
                <button className="p-2 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-white transition-all">
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="text-center py-12 bg-zinc-900/20 rounded-3xl border border-dashed border-white/5">
            <Truck className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">No hay activos registrados</p>
          </div>
        )}
      </div>
    </div>
  );
}

const X = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);
