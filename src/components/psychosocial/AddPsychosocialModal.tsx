import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Brain, Calendar, User, Loader2, Shield, Activity, FileText } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { useProject } from '../../contexts/ProjectContext';

interface AddPsychosocialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddPsychosocialModal({ isOpen, onClose }: AddPsychosocialModalProps) {
  const [loading, setLoading] = useState(false);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    department: '',
    date: new Date().toISOString().split('T')[0],
    riskLevel: 'low',
    tags: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    
    setLoading(true);
    try {
      const finalTags = formData.tags.split(',').map(t => t.trim()).filter(t => t);
      finalTags.push('ISTAS21');

      await addNode({
        type: NodeType.PSYCHOSOCIAL,
        title: formData.title,
        description: formData.description,
        tags: finalTags,
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          department: formData.department,
          date: formData.date,
          riskLevel: formData.riskLevel,
          status: 'Planificada',
          createdAt: new Date().toISOString()
        }
      });
      onClose();
      setFormData({
        title: '',
        description: '',
        department: '',
        date: new Date().toISOString().split('T')[0],
        riskLevel: 'low',
        tags: ''
      });
    } catch (error) {
      console.error('Error adding psychosocial evaluation:', error);
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
            className="relative w-full max-w-lg bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-rose-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-500">
                  <Brain className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Nueva Evaluación ISTAS21</h2>
                  <p className="text-xs text-zinc-400">Registrar resultados de riesgo psicosocial</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Título de la Evaluación
                </label>
                <div className="relative">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    placeholder="Ej: Evaluación ISTAS21 - Operaciones"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    Departamento
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input
                      type="text"
                      required
                      value={formData.department}
                      onChange={e => setFormData(prev => ({ ...prev, department: e.target.value }))}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                      placeholder="Ej: Operaciones"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                    Fecha
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input
                      type="date"
                      required
                      value={formData.date}
                      onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Nivel de Riesgo Global
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['low', 'medium', 'high'].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, riskLevel: level }))}
                      className={`py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                        formData.riskLevel === level
                          ? level === 'high' ? 'bg-rose-500 text-white' :
                            level === 'medium' ? 'bg-amber-500 text-white' :
                            'bg-emerald-500 text-white'
                          : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      {level === 'high' ? 'Alto' : level === 'medium' ? 'Medio' : 'Bajo'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Descripción / Hallazgos
                </label>
                <textarea
                  required
                  value={formData.description}
                  onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl p-4 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 h-32 resize-none"
                  placeholder="Detalles de la evaluación, dimensiones afectadas..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Etiquetas (separadas por coma)
                </label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={e => setFormData(prev => ({ ...prev, tags: e.target.value }))}
                  className="w-full bg-zinc-800/50 border border-white/10 rounded-xl p-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                  placeholder="Ej: estrés, doble presencia, apoyo social"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-rose-500 hover:bg-rose-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Shield className="w-5 h-5" />
                      Guardar Evaluación
                    </>
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
