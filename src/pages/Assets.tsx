import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Truck, Boxes
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../contexts/ProjectContext';
import { MaquinariaManager } from '../components/projects/MaquinariaManager';
import { EquipmentAdminPanel } from '../components/equipment/EquipmentAdminPanel';

// Phase 5 "make real" — Assets previously mounted ONLY MaquinariaManager, so the
// fully-built EquipmentAdminPanel (QR-registered equipment admin backed by
// listEquipmentBySite / registerEquipmentQr) was orphaned (no import → users
// could never reach it). Surface it via a tab. (Horómetro needs an
// equipment-list container and HazmatStorageManager needs persistence before
// they can be wired the same way — tracked as follow-ups.)
type AssetTab = 'maquinaria' | 'equipos';

export function Assets() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const [tab, setTab] = useState<AssetTab>('maquinaria');

  const tabs = [
    { id: 'maquinaria' as const, label: t('assets.tabs.maquinaria', 'Maquinaria'), icon: Truck },
    { id: 'equipos' as const, label: t('assets.tabs.equipos', 'Equipos'), icon: Boxes },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">{t('assets.header.title', 'Gestión de Activos')}</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {selectedProject
              ? `${t('assets.header.forProject', 'Maquinaria y Equipos para')}: ${selectedProject.name}`
              : t('assets.header.subtitle', 'Base de Datos Centralizada de Activos Industriales')}
          </p>
        </div>
      </div>

      {selectedProject ? (
        <>
          {/* Tabs */}
          <div className="flex flex-wrap gap-2">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-colors border ${
                  tab === id
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-transparent'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-white/10 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {tab === 'maquinaria' && <MaquinariaManager projectId={selectedProject.id} />}
            {tab === 'equipos' && <EquipmentAdminPanel projectId={selectedProject.id} />}
          </motion.div>
        </>
      ) : (
        <div className="bg-white/50 dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-white/10 rounded-[3rem] p-20 text-center">
          <div className="w-20 h-20 bg-zinc-100 dark:bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Truck className="w-10 h-10 text-zinc-400 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">{t('assets.empty.title', 'Selecciona un Proyecto')}</h3>
          <p className="text-zinc-500 text-sm mt-2 uppercase tracking-widest font-bold max-w-md mx-auto">
            {t('assets.empty.message', 'Para gestionar la maquinaria y activos, primero debes seleccionar un proyecto activo desde el selector lateral.')}
          </p>
        </div>
      )}
    </div>
  );
}
