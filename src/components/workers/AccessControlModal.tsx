import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, Loader2, Calendar, ShieldAlert } from 'lucide-react';
import { Worker } from '../../types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

interface AccessControlModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker | null;
  projectId?: string;
}

export function AccessControlModal({ isOpen, onClose, worker, projectId }: AccessControlModalProps) {
  const [loading, setLoading] = useState(false);
  const [medicalDate, setMedicalDate] = useState('');
  const [certifications, setCertifications] = useState('');

  useEffect(() => {
    if (worker) {
      setMedicalDate(worker.medicalClearanceDate || '');
      setCertifications(worker.certifications?.join(', ') || '');
    }
  }, [worker]);

  if (!worker) return null;

  const handleSave = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const workerRef = doc(db, `projects/${projectId}/workers`, worker.id);
      
      const certsArray = certifications
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      await updateDoc(workerRef, {
        medicalClearanceDate: medicalDate || null,
        certifications: certsArray
      });

      onClose();
    } catch (error) {
      console.error('Error updating access control:', error);
      alert('Error al actualizar los datos de control de acceso.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && worker && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-zinc-200 dark:border-white/10 flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-emerald-500/5 dark:from-emerald-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0">
                  <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Control de Acceso</h2>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest truncate">{worker.name}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
                    Examen Médico de Aptitud (Vencimiento)
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                    <input
                      type="date"
                      value={medicalDate}
                      onChange={(e) => setMedicalDate(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    />
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">Si la fecha es anterior a hoy, el torniquete bloqueará el acceso.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
                    Certificaciones Técnicas
                  </label>
                  <input
                    type="text"
                    value={certifications}
                    onChange={(e) => setCertifications(e.target.value)}
                    placeholder="Ej: Trabajo en Altura, Espacios Confinados"
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 px-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Separadas por coma. Requeridas para roles específicos (ej. Altura, Eléctrico).</p>
                </div>
              </div>

              <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-emerald-600 dark:text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  Estos datos son verificados en tiempo real por el <strong>Torniquete Virtual</strong>. Cualquier incumplimiento generará una alerta en la Red Neuronal y bloqueará el acceso.
                </p>
              </div>

              <button
                onClick={handleSave}
                disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white py-3 rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Guardar Configuración
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
