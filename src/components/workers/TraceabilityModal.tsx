import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, FileText, GraduationCap, AlertTriangle, Clock, Calendar } from 'lucide-react';
import { Worker } from '../../types';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../services/firebase';

interface TraceabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker | null;
  projectId: string | null;
}

export function TraceabilityModal({ isOpen, onClose, worker, projectId }: TraceabilityModalProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && worker) {
      fetchLogs();
    } else {
      setLogs([]);
    }
  }, [isOpen, worker]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      // In a real app, we would query a dedicated 'audit_logs' collection.
      // For this demo, we'll simulate fetching logs from different collections
      // related to the worker (EPP deliveries, training, incidents).
      
      const simulatedLogs = [
        {
          id: '1',
          type: 'epp',
          action: 'Entrega de EPP',
          details: 'Casco de seguridad, Lentes, Guantes',
          date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
          user: 'Admin',
          icon: ShieldCheck,
          color: 'text-emerald-500',
          bg: 'bg-emerald-500/10'
        },
        {
          id: '2',
          type: 'training',
          action: 'Capacitación Completada',
          details: 'Uso correcto de extintores (100%)',
          date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
          user: 'Sistema',
          icon: GraduationCap,
          color: 'text-blue-500',
          bg: 'bg-blue-500/10'
        },
        {
          id: '3',
          type: 'document',
          action: 'Documento Firmado',
          details: 'Contrato de Trabajo y Anexo ODI',
          date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
          user: worker?.name,
          icon: FileText,
          color: 'text-purple-500',
          bg: 'bg-purple-500/10'
        },
        {
          id: '4',
          type: 'incident',
          action: 'Reporte de Incidente',
          details: 'Casi accidente: Caída de material cerca del área de trabajo',
          date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
          user: worker?.name,
          icon: AlertTriangle,
          color: 'text-amber-500',
          bg: 'bg-amber-500/10'
        }
      ];

      setLogs(simulatedLogs);
    } catch (error) {
      console.error("Error fetching logs:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !worker) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          <div className="p-6 border-b border-white/10 flex items-center justify-between bg-zinc-800/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Trazabilidad Inmutable</h2>
                <p className="text-xs text-zinc-400">Historial de acciones de {worker.name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
              </div>
            ) : logs.length > 0 ? (
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
                {logs.map((log, index) => {
                  const Icon = log.icon;
                  return (
                    <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white/10 bg-zinc-900 text-zinc-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${log.bg}`}>
                          <Icon className={`w-4 h-4 ${log.color}`} />
                        </div>
                      </div>
                      
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-2xl bg-zinc-900/50 border border-white/5 shadow-sm">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-bold text-white text-sm">{log.action}</h3>
                          <time className="text-[10px] font-medium text-zinc-500 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(log.date).toLocaleDateString()}
                          </time>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed mb-2">{log.details}</p>
                        <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-500 bg-black/20 px-2 py-1 rounded-md inline-flex">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500"></span>
                          Registrado por: {log.user}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500">
                <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay registros de trazabilidad para este trabajador.</p>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-white/10 bg-zinc-900">
            <button
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl transition-colors"
            >
              Cerrar
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
