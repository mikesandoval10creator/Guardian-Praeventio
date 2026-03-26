import React from 'react';
import { motion } from 'framer-motion';
import { 
  Truck
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { MaquinariaManager } from '../components/projects/MaquinariaManager';

export function Assets() {
  const { selectedProject } = useProject();

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Gestión de Activos</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {selectedProject 
              ? `Maquinaria y Equipos para: ${selectedProject.name}`
              : 'Base de Datos Centralizada de Activos Industriales'}
          </p>
        </div>
      </div>

      {selectedProject ? (
        <MaquinariaManager projectId={selectedProject.id} />
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-[3rem] p-20 text-center">
          <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Truck className="w-10 h-10 text-zinc-600" />
          </div>
          <h3 className="text-xl font-black text-white uppercase tracking-tight">Selecciona un Proyecto</h3>
          <p className="text-zinc-500 text-sm mt-2 uppercase tracking-widest font-bold max-w-md mx-auto">
            Para gestionar la maquinaria y activos, primero debes seleccionar un proyecto activo desde el selector lateral.
          </p>
        </div>
      )}
    </div>
  );
}
