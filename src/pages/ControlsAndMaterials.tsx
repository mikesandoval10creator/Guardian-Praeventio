import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Shield, Wrench, AlertTriangle, CheckCircle2, Plus, Search, Filter, Box } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { db, collection, onSnapshot, query, where, limit, handleFirestoreError, OperationType } from '../services/firebase';
import { useProject } from '../contexts/ProjectContext';

interface Control {
  id: string;
  title: string;
  type: string;
  status: string;
  description: string;
  efficiency?: number;
  createdAt: any;
}

interface Material {
  id: string;
  name: string;
  type: string;
  stock: number;
  minStock: number;
}

export function ControlsAndMaterials() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'controls' | 'materials'>('controls');
  const [searchTerm, setSearchTerm] = useState('');
  const [controls, setControls] = useState<Control[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const { selectedProject } = useProject();

  useEffect(() => {
    if (!selectedProject) return undefined;

    const controlsPath = `projects/${selectedProject.id}/controls`;
    const materialsPath = `projects/${selectedProject.id}/materials`;

    // Note: doc creation must set active=true for these listeners to surface it.
    // TODO Firestore: composite index needed for (active ASC) — Firestore auto-creates single-field indexes, no manual entry required.
    const qControls = query(
      collection(db, controlsPath),
      where('active', '==', true),
      limit(200),
    );
    const qMaterials = query(
      collection(db, materialsPath),
      where('active', '==', true),
      limit(200),
    );

    const unsubscribeControls = onSnapshot(qControls, (snapshot) => {
      setControls(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Control[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, controlsPath));

    const unsubscribeMaterials = onSnapshot(qMaterials, (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, materialsPath));

    return () => {
      unsubscribeControls();
      unsubscribeMaterials();
    };
  }, [selectedProject]);

  const filteredControls = controls.filter(c => 
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredMaterials = materials.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-500" />
            {t('controlsAndMaterials.title', 'Controles y Materiales')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('controlsAndMaterials.subtitle', 'Gestión de Entidades Críticas')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setActiveTab('controls')} variant={activeTab === 'controls' ? 'primary' : 'secondary'}>
            <Wrench className="w-4 h-4 mr-2" /> {t('controlsAndMaterials.controls', 'Controles')}
          </Button>
          <Button onClick={() => setActiveTab('materials')} variant={activeTab === 'materials' ? 'primary' : 'secondary'}>
            <Box className="w-4 h-4 mr-2" /> {t('controlsAndMaterials.materials', 'Materiales')}
          </Button>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-token" />
          <input
            type="text"
            placeholder={activeTab === 'controls' ? t('controlsAndMaterials.searchControls', 'Buscar controles...') : t('controlsAndMaterials.searchMaterials', 'Buscar materiales...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface border border-default-token rounded-xl py-3 pl-12 pr-4 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>
        <Button variant="secondary" className="shrink-0">
          <Filter className="w-4 h-4" />
        </Button>
        <Button className="shrink-0 bg-[#4db6ac] hover:bg-[#3a9e95]">
          <Plus className="w-4 h-4 mr-2" />
          {t('controlsAndMaterials.new', 'Nuevo')}
        </Button>
      </div>

      {activeTab === 'controls' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredControls.map((control, idx) => (
            <motion.div key={control.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
              <Card className="p-6 border-default-token hover:border-emerald-500/30 transition-all">
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2 rounded-lg ${control.status === 'Operativo' ? 'bg-emerald-500/10 text-emerald-500' : control.status === 'En Revisión' ? 'bg-amber-500/10 text-amber-500' : 'bg-rose-500/10 text-rose-500'}`}>
                    {control.status === 'Operativo' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-muted-token bg-elevated px-2 py-1 rounded-md">
                    {control.type}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-primary-token mb-2">{control.title}</h3>
                <p className="text-sm text-muted-token mb-4">{control.description}</p>
                <div className="text-xs text-muted-token border-t border-default-token pt-4 flex justify-between items-center">
                  <span>{t('controlsAndMaterials.efficiency', 'Eficiencia')}: <span className="text-primary-token">{control.efficiency}%</span></span>
                </div>
              </Card>
            </motion.div>
          ))}
          {filteredControls.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-token">
              {t('controlsAndMaterials.noControls', 'No se encontraron controles.')}
            </div>
          )}
        </div>
      )}

      {activeTab === 'materials' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMaterials.map((material, idx) => (
            <motion.div key={material.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
              <Card className="p-6 border-default-token hover:border-blue-500/30 transition-all">
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2 rounded-lg ${material.stock < material.minStock ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    <Box className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-muted-token bg-elevated px-2 py-1 rounded-md">
                    {t('controlsAndMaterials.stock', 'Stock')}: {material.stock}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-primary-token mb-2">{material.name}</h3>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-token">{t('controlsAndMaterials.type', 'Tipo')}:</span>
                    <span className="text-secondary-token font-mono">{material.type}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-token">{t('controlsAndMaterials.minStock', 'Stock Mínimo')}:</span>
                    <span className="text-secondary-token font-mono">{material.minStock}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-token border-t border-default-token pt-4 flex justify-between items-center">
                  <span>{t('controlsAndMaterials.status', 'Estado')}:</span>
                  <span className={`font-bold uppercase ${material.stock < material.minStock ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {material.stock < material.minStock ? t('controlsAndMaterials.lowStock', 'Bajo Stock') : t('controlsAndMaterials.sufficient', 'Suficiente')}
                  </span>
                </div>
              </Card>
            </motion.div>
          ))}
          {filteredMaterials.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-token">
              {t('controlsAndMaterials.noMaterials', 'No se encontraron materiales.')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
