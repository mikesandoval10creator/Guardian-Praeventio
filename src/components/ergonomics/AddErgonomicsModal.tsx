import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Layout, Activity, Shield, AlertTriangle, Loader2, MapPin } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';

interface AddErgonomicsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

const assessmentTypes = [
  'Evaluación RULA',
  'Evaluación REBA',
  'Evaluación NIOSH',
  'Evaluación ROSA',
  'Checklist Ergonómico',
];

const riskLevels = [
  { value: 'low', label: 'Bajo', color: 'text-emerald-500' },
  { value: 'medium', label: 'Medio', color: 'text-amber-500' },
  { value: 'high', label: 'Alto', color: 'text-rose-500' },
];

export function AddErgonomicsModal({ isOpen, onClose, projectId }: AddErgonomicsModalProps) {
  const { addNode } = useRiskEngine();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    workstation: '',
    type: assessmentTypes[0],
    risk: riskLevels[0].value,
    observations: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await addNode({
        type: NodeType.ERGONOMICS,
        title: `${formData.type} - ${formData.workstation}`,
        description: `Evaluación ergonómica de tipo ${formData.type} en el puesto ${formData.workstation}. Nivel de riesgo: ${formData.risk}. Observaciones: ${formData.observations}`,
        tags: ['ergonomia', String(formData.type || '').toLowerCase(), formData.risk],
        metadata: {
          workstation: formData.workstation,
          assessmentType: formData.type,
          risk: formData.risk,
          observations: formData.observations,
          status: 'completed',
          date: new Date().toISOString().split('T')[0]
        },
        connections: [],
        projectId: projectId
      });

      onClose();
      setFormData({
        workstation: '',
        type: assessmentTypes[0],
        risk: riskLevels[0].value,
        observations: '',
      });
    } catch (error) {
      console.error('Error adding ergonomics node:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex justify-between items-center bg-gradient-to-r from-orange-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                  <Layout className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Nueva Evaluación</h2>
                  <p className="text-sm text-zinc-400">Análisis ergonómico de puesto</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              <form id="add-ergonomics-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Puesto de Trabajo</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      required
                      type="text"
                      value={formData.workstation}
                      onChange={(e) => setFormData({ ...formData, workstation: e.target.value })}
                      placeholder="Ej: Puesto de Trabajo 01"
                      className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Tipo de Evaluación</label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
                    >
                      {assessmentTypes.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Nivel de Riesgo</label>
                    <select
                      value={formData.risk}
                      onChange={(e) => setFormData({ ...formData, risk: e.target.value })}
                      className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm"
                    >
                      {riskLevels.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Observaciones / Hallazgos</label>
                  <textarea
                    value={formData.observations}
                    onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                    placeholder="Detalles de la evaluación..."
                    rows={4}
                    className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all text-sm resize-none"
                  />
                </div>
              </form>
            </div>
            
            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-900 dark:text-white bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="add-ergonomics-form"
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white font-medium text-sm hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar Evaluación</span>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
