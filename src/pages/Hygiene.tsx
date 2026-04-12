import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Shield, 
  Wind, 
  Thermometer, 
  Volume2, 
  Activity, 
  AlertTriangle, 
  BarChart3,
  Plus,
  Loader2,
  MapPin
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { AddHygieneModal } from '../components/hygiene/AddHygieneModal';
import { NoiseMonitor } from '../components/hygiene/NoiseMonitor';
import { BreathingExercise } from '../components/hygiene/BreathingExercise';
import { VitalityMonitor } from '../components/hygiene/VitalityMonitor';
import { FloraFaunaCatalog } from '../components/hygiene/FloraFaunaCatalog';
import { MorningRoutine } from '../components/hygiene/MorningRoutine';
import { NutritionLog } from '../components/hygiene/NutritionLog';

const iconMap: Record<string, any> = {
  'Ruido Ambiental': Volume2,
  'Iluminación': Activity,
  'Estrés Térmico': Thermometer,
  'Particulado (PM10)': Wind,
};

export function Hygiene() {
  const { selectedProject } = useProject();
  const { nodes, loading } = useRiskEngine();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const hygieneNodes = nodes.filter(node => 
    node.type === NodeType.HYGIENE && 
    (selectedProject ? node.projectId === selectedProject.id : true)
  );

  const alerts = hygieneNodes.filter(n => n.metadata.status === 'warning');

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Higiene y Salud</h1>
          <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Monitoreo de agentes ambientales y salud ocupacional</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-lg shadow-emerald-500/20 active:scale-95 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Registro</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Environmental Monitoring */}
        <div className="lg:col-span-2 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            </div>
          ) : hygieneNodes.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {hygieneNodes.map((node, index) => {
                const Icon = iconMap[node.metadata.parameter] || Activity;
                const status = node.metadata.status;
                const progress = Math.min(100, (node.metadata.value / node.metadata.limit) * 100);

                return (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 hover:border-emerald-500/30 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-emerald-500 border border-white/5">
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        status === 'safe' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {status === 'safe' ? 'Normal' : 'Alerta'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-zinc-500 text-xs font-bold uppercase tracking-widest">{node.metadata.parameter}</h3>
                      <div className="flex items-center gap-1 text-[9px] text-zinc-600 font-bold uppercase tracking-tighter">
                        <MapPin className="w-2.5 h-2.5" />
                        {node.metadata.location}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-white">{node.metadata.value} {node.metadata.unit}</span>
                      <span className="text-xs text-zinc-500 font-medium">Límite: {node.metadata.limit} {node.metadata.unit}</span>
                    </div>
                    <div className="mt-6 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${status === 'safe' ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-3xl p-20 text-center">
              <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-zinc-600" />
              </div>
              <p className="text-zinc-500 text-sm">No hay registros de higiene ambiental para este proyecto.</p>
            </div>
          )}

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-indigo-500" />
                Tendencias Mensuales
              </h3>
              <select className="bg-zinc-800 border border-white/10 text-zinc-400 text-xs rounded-lg px-3 py-1.5 focus:outline-none">
                <option>Últimos 30 días</option>
                <option>Últimos 6 meses</option>
              </select>
            </div>
            <div className="h-48 flex items-end justify-between gap-2">
              {[40, 65, 45, 80, 55, 70, 90, 60, 45, 75, 50, 65].map((h, i) => (
                <div 
                  key={i} 
                  className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/40 transition-all rounded-t-lg relative group"
                  style={{ height: `${h}%` }}
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {h}% Nivel
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              <span>Ene</span>
              <span>Jun</span>
              <span>Dic</span>
            </div>
          </div>
        </div>

        {/* Health Stats & Tools */}
        <div className="space-y-6">
          <MorningRoutine />
          <NutritionLog />
          <VitalityMonitor />
          <NoiseMonitor />
          <BreathingExercise />

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-500" />
              Salud Ocupacional
            </h3>
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-zinc-800/50 border border-white/5">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-zinc-400">Exámenes Médicos</span>
                  <span className="text-xs font-bold text-emerald-500">92%</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: '92%' }} />
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-zinc-800/50 border border-white/5">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-zinc-400">Vacunación</span>
                  <span className="text-xs font-bold text-blue-500">78%</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: '78%' }} />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Alertas Críticas ({alerts.length})
            </h3>
            <div className="space-y-3">
              {alerts.length > 0 ? (
                alerts.map(alert => (
                  <div key={alert.id} className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[10px] font-black uppercase text-amber-500 mb-0.5">{alert.metadata.parameter}</p>
                      <p className="text-xs text-amber-200 leading-relaxed">
                        {alert.description}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  <p className="text-xs text-emerald-200">No hay alertas críticas activas.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AddHygieneModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        projectId={selectedProject?.id}
      />
    </div>
  );
}
