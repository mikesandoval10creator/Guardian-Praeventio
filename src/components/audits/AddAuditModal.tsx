import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ClipboardCheck, Calendar, User, Loader2, Shield, Activity, FileText } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { useProject } from '../../contexts/ProjectContext';

interface AddAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: string;
}

export function AddAuditModal({ isOpen, onClose, initialType = 'Interna' }: AddAuditModalProps) {
  const [loading, setLoading] = useState(false);
  const { addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    auditor: '',
    date: new Date().toISOString().split('T')[0],
    type: initialType,
    isoStandard: 'ISO 45001:2018',
    scope: '',
    tags: ''
  });

  // Reset form when opened with new initialType
  React.useEffect(() => {
    if (isOpen) {
      setFormData(prev => ({ ...prev, type: initialType }));
    }
  }, [isOpen, initialType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    
    setLoading(true);
    try {
      const finalTags = formData.tags.split(',').map(t => t.trim()).filter(t => t);
      if (formData.type === 'Certificación') {
        finalTags.push(formData.isoStandard);
        finalTags.push('ISO');
      }

      await addNode({
        type: NodeType.AUDIT,
        title: formData.title,
        description: formData.description,
        tags: finalTags,
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          auditor: formData.auditor,
          date: formData.date,
          type: formData.type,
          scope: formData.scope,
          status: 'Planificada',
          score: 0,
          createdAt: new Date().toISOString()
        }
      });
      onClose();
      setFormData({
        title: '',
        description: '',
        auditor: '',
        date: new Date().toISOString().split('T')[0],
        type: 'Interna',
        isoStandard: 'ISO 45001:2018',
        scope: '',
        tags: ''
      });
    } catch (error) {
      console.error('Error adding audit:', error);
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
            className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-blue-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <ClipboardCheck className="w-6 h-6 text-blue-600 dark:text-blue-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-tight">Nueva Auditoría</h3>
                  <p className="text-xs text-zinc-500 font-medium">Planificar verificación de cumplimiento</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-full transition-colors">
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Título de la Auditoría</label>
                <input
                  required
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ej: Auditoría Trimestral de Seguridad e Higiene"
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                />
              </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Tipo</label>
            <select
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value })}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            >
              <option>Interna</option>
              <option>Externa</option>
              <option>Certificación</option>
              <option>Gubernamental</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Fecha Programada</label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                required
                type="date"
                value={formData.date}
                onChange={e => setFormData({ ...formData, date: e.target.value })}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl pl-11 pr-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
              />
            </div>
          </div>
        </div>

        {formData.type === 'Certificación' && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Norma ISO</label>
            <select
              value={formData.isoStandard}
              onChange={e => setFormData({ ...formData, isoStandard: e.target.value })}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            >
              <option value="ISO 45001:2018">ISO 45001:2018 (SST)</option>
              <option value="ISO 9001:2015">ISO 9001:2015 (Calidad)</option>
              <option value="ISO 14001:2015">ISO 14001:2015 (Medio Ambiente)</option>
            </select>
          </div>
        )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Auditor Responsable</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    required
                    type="text"
                    value={formData.auditor}
                    onChange={e => setFormData({ ...formData, auditor: e.target.value })}
                    placeholder="Nombre del auditor..."
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl pl-11 pr-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Alcance / Objetivo</label>
                <textarea
                  required
                  value={formData.scope}
                  onChange={e => setFormData({ ...formData, scope: e.target.value })}
                  placeholder="Define el alcance de la auditoría..."
                  rows={2}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Descripción</label>
                <textarea
                  required
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Detalles adicionales..."
                  rows={2}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 uppercase tracking-widest text-xs mt-2"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <FileText className="w-5 h-5" />
                    Planificar Auditoría
                  </>
                )}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
