import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Heart, Stethoscope, User, Calendar, Loader2 } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';

interface AddMedicineModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

const examTypes = [
  'Pre-ocupacional',
  'Periódico',
  'Retiro',
  'Post-incapacidad',
  'Vigilancia Epidemiológica',
];

const results = [
  'Apto',
  'Apto con restricción',
  'No Apto',
  'Pendiente',
];

export function AddMedicineModal({ isOpen, onClose, projectId }: AddMedicineModalProps) {
  const { addNode } = useRiskEngine();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    patient: '',
    type: examTypes[0],
    date: new Date().toISOString().split('T')[0],
    result: results[0],
    observations: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await addNode({
        type: NodeType.MEDICINE,
        title: `Examen ${formData.type} - ${formData.patient}`,
        description: `Examen médico de tipo ${formData.type} para el trabajador ${formData.patient}. Resultado: ${formData.result}. Observaciones: ${formData.observations}`,
        tags: ['medicina', formData.type.toLowerCase(), formData.result.toLowerCase().replace(' ', '-')],
        metadata: {
          patient: formData.patient,
          examType: formData.type,
          date: formData.date,
          result: formData.result,
          observations: formData.observations,
          status: formData.result === 'Pendiente' ? 'scheduled' : 'completed'
        },
        connections: [],
        projectId: projectId
      });

      onClose();
      setFormData({
        patient: '',
        type: examTypes[0],
        date: new Date().toISOString().split('T')[0],
        result: results[0],
        observations: '',
      });
    } catch (error) {
      console.error('Error adding medicine node:', error);
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-rose-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
                  <Heart className="w-6 h-6 text-rose-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Nueva Consulta</h2>
                  <p className="text-xs text-zinc-400">Registro de salud ocupacional</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Paciente / Trabajador</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    required
                    type="text"
                    value={formData.patient}
                    onChange={(e) => setFormData({ ...formData, patient: e.target.value })}
                    placeholder="Nombre completo"
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Tipo de Examen</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm"
                  >
                    {examTypes.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Fecha</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                      required
                      type="date"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Resultado</label>
                <select
                  value={formData.result}
                  onChange={(e) => setFormData({ ...formData, result: e.target.value })}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm"
                >
                  {results.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Observaciones</label>
                <textarea
                  value={formData.observations}
                  onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                  placeholder="Detalles adicionales..."
                  rows={3}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all text-sm resize-none"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-rose-500 text-white font-bold hover:bg-rose-600 transition-all shadow-lg shadow-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar</span>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
