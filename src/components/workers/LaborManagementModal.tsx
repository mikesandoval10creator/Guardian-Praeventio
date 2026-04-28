import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileSignature, CheckCircle2, AlertTriangle, Clock, FileText, Upload, ShieldCheck, Download } from 'lucide-react';
import { Worker } from '../../types';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../services/firebase';
import { useNotifications } from '../../contexts/NotificationContext';
import { useProject } from '../../contexts/ProjectContext';

interface LaborManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker;
}

export function LaborManagementModal({ isOpen, onClose, worker }: LaborManagementModalProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const { addNotification } = useNotifications();
  const { projects } = useProject();

  const [contractStatus, setContractStatus] = useState(worker.contractStatus || 'Vigente');
  const [odiSigned, setOdiSigned] = useState(worker.odiSigned || false);
  const [digitalSignatureStatus, setDigitalSignatureStatus] = useState(worker.digitalSignatureStatus || 'Pendiente');
  const [shiftStart, setShiftStart] = useState(worker.shiftStart || '08:00');
  const [shiftEnd, setShiftEnd] = useState(worker.shiftEnd || '18:00');

  if (!isOpen) return null;

  const checkWorkerShiftOverlaps = async () => {
    if (!navigator.onLine) return [];
    if (!worker.email) return [];

    const overlapPromises = projects.map(async (project) => {
      if (project.isPendingSync) return false;
      if (project.id === worker.projectId) return false; // Skip the current project

      const workersRef = collection(db, `projects/${project.id}/workers`);
      const q = query(workersRef, where('email', '==', worker.email));
      
      try {
        const snapshot = await getDocs(q);
        let hasOverlap = false;

        snapshot.forEach((doc) => {
          const otherWorker = doc.data();
          const otherStart = otherWorker.shiftStart || '08:00';
          const otherEnd = otherWorker.shiftEnd || '18:00';

          // Check if shifts overlap (start1 < end2 && end1 > start2)
          if (shiftStart < otherEnd && shiftEnd > otherStart) {
            hasOverlap = true;
          }
        });

        if (hasOverlap) {
          return project.name;
        }
      } catch (e) {
        // Ignore permission errors
      }
      return false;
    });

    const results = await Promise.all(overlapPromises);
    return results.filter(Boolean) as string[];
  };

  const handleSave = async () => {
    setIsUpdating(true);
    try {
      if (shiftStart >= shiftEnd) {
        addNotification({
          title: 'Error de Turno',
          message: 'La hora de inicio debe ser anterior a la hora de fin.',
          type: 'error'
        });
        setIsUpdating(false);
        return;
      }

      // Check overlaps
      const overlaps = await checkWorkerShiftOverlaps();
      if (overlaps.length > 0) {
        addNotification({
          title: 'Colisión de Turnos',
          message: `El trabajador tiene turnos superpuestos en: ${overlaps.join(', ')}.`,
          type: 'warning' // As required, we might just warn, or block. Let's warn but allow save or block. The requirement implies detection is critical. Let's block it for safety.
        });
        
        const confirmSave = window.confirm(`El trabajador tiene turnos superpuestos en: ${overlaps.join(', ')}.\n\n¿Guardar de todos modos (doble turno/excepción)?`);
        if (!confirmSave) {
          setIsUpdating(false);
          return;
        }
      }

      const workerPath = worker.projectId ? `projects/${worker.projectId}/workers` : 'workers';
      const workerRef = doc(db, workerPath, worker.id);
      await updateDoc(workerRef, {
        contractStatus,
        odiSigned,
        digitalSignatureStatus,
        shiftStart,
        shiftEnd
      });
      
      addNotification({
        title: 'Gestión Laboral Actualizada',
        message: `Los datos laborales de ${worker.name} han sido guardados correctamente.`,
        type: 'success'
      });
      onClose();
    } catch (error) {
      console.error('Error updating labor data:', error);
      addNotification({
        title: 'Error',
        message: 'No se pudieron actualizar los datos laborales.',
        type: 'error'
      });
      handleFirestoreError(error, OperationType.UPDATE, `workers/${worker.id}`);
    } finally {
      setIsUpdating(false);
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
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-indigo-500/5 dark:from-indigo-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-500 shrink-0">
                  <FileSignature className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Gestión Laboral</h2>
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

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-8">
              {/* Estado del Contrato */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                  Estado del Contrato
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {['Vigente', 'Por Vencer', 'Vencido'].map((status) => (
                    <button
                      key={status}
                      onClick={() => setContractStatus(status as any)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        contractStatus === status
                          ? 'bg-indigo-50 dark:bg-indigo-500/20 border-indigo-200 dark:border-indigo-500/50 text-indigo-700 dark:text-indigo-300'
                          : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-white/5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{status}</span>
                        {contractStatus === status && <CheckCircle2 className="w-4 h-4" />}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Turno Laboral */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  Turno Laboral (Asignación)
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Inicio de Turno</label>
                    <input
                      type="time"
                      value={shiftStart}
                      onChange={(e) => setShiftStart(e.target.value)}
                      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Fin de Turno</label>
                    <input
                      type="time"
                      value={shiftEnd}
                      onChange={(e) => setShiftEnd(e.target.value)}
                      className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-zinc-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Obligación de Informar (ODI) */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  Obligación de Informar (ODI)
                </h3>
              <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-zinc-900 dark:text-white font-medium">Documento ODI (DS 40)</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">El trabajador ha sido informado de los riesgos laborales.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button className="p-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded-lg text-zinc-700 dark:text-white transition-colors" title="Descargar Plantilla">
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setOdiSigned(!odiSigned)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      odiSigned
                        ? 'bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30'
                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                    }`}
                  >
                    {odiSigned ? 'Firmado y Aprobado' : 'Marcar como Firmado'}
                  </button>
                </div>
              </div>
            </div>

              {/* Firma Digital */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                  <FileSignature className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                  Firma Digital Nativa
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'Firmado', icon: CheckCircle2, color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
                    { id: 'Pendiente', icon: Clock, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' },
                    { id: 'Rechazado', icon: AlertTriangle, color: 'text-rose-700 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-500/10', border: 'border-rose-200 dark:border-rose-500/20' }
                  ].map((status) => {
                    const Icon = status.icon;
                    return (
                      <button
                        key={status.id}
                        onClick={() => setDigitalSignatureStatus(status.id as any)}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          digitalSignatureStatus === status.id
                            ? `${status.bg} ${status.border} ${status.color}`
                            : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-white/5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="w-4 h-4" />
                          <span className="font-medium text-sm">{status.id}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-xl p-4 flex items-start gap-3 mt-4">
                  <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-indigo-800 dark:text-indigo-200/70 leading-relaxed">
                    Praeventio Guard incluye un sistema de firma electrónica simple nativo, cumpliendo con la Ley 19.799 sobre documentos electrónicos y firmas electrónicas, eliminando la necesidad de integraciones con ERPs externos para la gestión documental de prevención de riesgos.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-800/50 flex justify-end gap-3 shrink-0">
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl font-medium text-zinc-700 dark:text-white hover:bg-zinc-200 dark:hover:bg-white/5 transition-colors text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isUpdating}
                className="px-6 py-2.5 rounded-xl font-medium bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-600 text-white transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                {isUpdating ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
