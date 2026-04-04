import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldCheck, FileText, GraduationCap, AlertTriangle, Clock, Calendar } from 'lucide-react';
import { Worker } from '../../types';
import { useRiskEngine } from '../../hooks/useRiskEngine';

interface TraceabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker | null;
  projectId: string | null;
}

export function TraceabilityModal({ isOpen, onClose, worker, projectId }: TraceabilityModalProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const { nodes } = useRiskEngine();

  useEffect(() => {
    if (isOpen && worker) {
      fetchLogs();
    } else {
      setLogs([]);
    }
  }, [isOpen, worker, nodes]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      // Fetch real logs from Risk nodes related to this worker
      const workerNodes = nodes.filter(n => 
        (n.metadata?.authorId === worker.id) || 
        n.tags.includes(worker.name) ||
        n.title.includes(worker.name) ||
        n.description.includes(worker.name)
      );

      const realLogs = workerNodes.map(node => {
        let icon = FileText;
        let color = 'text-zinc-500';
        let bg = 'bg-zinc-500/10';

        if (node.type === 'Hallazgo' || node.type === 'Incidente') {
          icon = AlertTriangle;
          color = 'text-amber-500';
          bg = 'bg-amber-500/10';
        } else if (node.type === 'EPP') {
          icon = ShieldCheck;
          color = 'text-emerald-500';
          bg = 'bg-emerald-500/10';
        } else if (node.type === 'Capacitación') {
          icon = GraduationCap;
          color = 'text-blue-500';
          bg = 'bg-blue-500/10';
        }

        return {
          id: node.id,
          type: node.type,
          action: node.title,
          details: node.description,
          date: node.createdAt,
          user: node.metadata?.authorId === worker.id ? worker.name : 'Sistema',
          icon,
          color,
          bg
        };
      });

      // Sort by date descending
      realLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setLogs(realLogs);
    } catch (error) {
      console.error("Error fetching logs:", error);
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
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-indigo-500/5 dark:from-indigo-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-500 shrink-0">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Trazabilidad Inmutable</h2>
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

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              {loading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                </div>
              ) : logs.length > 0 ? (
                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-zinc-200 dark:before:via-white/10 before:to-transparent">
                  {logs.map((log, index) => {
                    const Icon = log.icon;
                    return (
                      <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 text-zinc-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${log.bg}`}>
                            <Icon className={`w-4 h-4 ${log.color}`} />
                          </div>
                        </div>
                        
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 shadow-sm">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="font-bold text-zinc-900 dark:text-white text-sm">{log.action}</h3>
                            <time className="text-[10px] font-medium text-zinc-500 flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(log.date).toLocaleDateString()}
                            </time>
                          </div>
                          <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mb-2">{log.details}</p>
                          <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-600 dark:text-zinc-500 bg-zinc-100 dark:bg-black/20 px-2 py-1 rounded-md inline-flex">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500"></span>
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

            <div className="p-6 border-t border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-900">
              <button
                onClick={onClose}
                className="w-full bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white font-bold py-3 rounded-xl transition-colors"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
