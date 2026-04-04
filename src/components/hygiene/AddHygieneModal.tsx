import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Volume2, Activity, Thermometer, Wind, Loader2 } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';

interface AddHygieneModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

const parameters = [
  { name: 'Ruido Ambiental', icon: Volume2, unit: 'dB', limit: 85 },
  { name: 'Iluminación', icon: Activity, unit: 'lux', limit: 300 },
  { name: 'Estrés Térmico', icon: Thermometer, unit: '°C', limit: 28 },
  { name: 'Particulado (PM10)', icon: Wind, unit: 'µg/m3', limit: 150 },
];

export function AddHygieneModal({ isOpen, onClose, projectId }: AddHygieneModalProps) {
  const { addNode } = useRiskEngine();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    parameter: parameters[0].name,
    value: '',
    location: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const selectedParam = parameters.find(p => p.name === formData.parameter)!;
      const numericValue = parseFloat(formData.value);
      const isSafe = numericValue <= selectedParam.limit;

      await addNode({
        type: NodeType.HYGIENE,
        title: `${formData.parameter} - ${formData.location}`,
        description: `Medición de ${formData.parameter} en ${formData.location}. Valor: ${formData.value}${selectedParam.unit}. Límite: ${selectedParam.limit}${selectedParam.unit}.`,
        tags: ['higiene', formData.parameter.toLowerCase(), isSafe ? 'seguro' : 'alerta'],
        metadata: {
          parameter: formData.parameter,
          value: numericValue,
          unit: selectedParam.unit,
          limit: selectedParam.limit,
          location: formData.location,
          status: isSafe ? 'safe' : 'warning'
        },
        connections: [],
        projectId: projectId
      });

      onClose();
      setFormData({ parameter: parameters[0].name, value: '', location: '' });
    } catch (error) {
      console.error('Error adding hygiene node:', error);
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
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-emerald-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Nuevo Registro</h2>
                  <p className="text-xs text-zinc-400">Monitoreo de agentes ambientales</p>
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
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Parámetro</label>
                <select
                  value={formData.parameter}
                  onChange={(e) => setFormData({ ...formData, parameter: e.target.value })}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                >
                  {parameters.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Valor</label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  placeholder="0.00"
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Ubicación / Área</label>
                <input
                  required
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Ej: Zona de Carga"
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-2.5 px-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
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
                  className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
