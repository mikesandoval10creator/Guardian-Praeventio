import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, FileSpreadsheet, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { db, collection, addDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';

interface MassImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

export function MassImportModal({ isOpen, onClose, projectId }: MassImportModalProps) {
  const { addNode } = useRiskEngine();
  const [loading, setLoading] = useState(false);
  const [csvData, setCsvData] = useState('');
  const [results, setResults] = useState<{ success: number; errors: number } | null>(null);

  const handleImport = async () => {
    if (!csvData.trim()) return;
    setLoading(true);
    setResults(null);

    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    let successCount = 0;
    let errorCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length < 3) continue;

      const worker: any = {};
      headers.forEach((header, index) => {
        worker[header] = values[index];
      });

      try {
        // 1. Create Node
        const node = await addNode({
          type: NodeType.WORKER,
          title: worker.nombre || worker.name,
          description: `Trabajador: ${worker.cargo || worker.role}. Importado masivamente.`,
          tags: ['trabajador', 'importado', (worker.cargo || worker.role || '').toLowerCase()],
          metadata: {
            email: worker.email,
            phone: worker.telefono || worker.phone,
            role: worker.cargo || worker.role,
            projectId: projectId || null
          },
          connections: [],
          projectId: projectId
        });

        if (!node) throw new Error('Node creation failed');

        // 2. Create Worker
        const path = projectId ? `projects/${projectId}/workers` : 'workers';
        await addDoc(collection(db, path), {
          name: worker.nombre || worker.name,
          role: worker.cargo || worker.role,
          email: worker.email,
          phone: worker.telefono || worker.phone,
          status: 'active',
          joinedAt: new Date().toISOString(),
          projectId: projectId || null,
          nodeId: node.id
        });

        successCount++;
      } catch (error) {
        console.error('Import error for line', i, error);
        errorCount++;
      }
    }

    setResults({ success: successCount, errors: errorCount });
    setLoading(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
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
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-blue-500/5 dark:from-blue-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-500 shrink-0">
                  <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Importación Masiva</h2>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest truncate">Carga múltiples trabajadores desde CSV</p>
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
              {!results ? (
                <>
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20 rounded-2xl">
                      <h4 className="text-sm font-bold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Formato Requerido (CSV)
                      </h4>
                      <code className="text-[10px] text-zinc-600 dark:text-zinc-400 block bg-zinc-100 dark:bg-black/40 p-3 rounded-xl">
                        nombre, cargo, email, telefono<br />
                        Juan Perez, Supervisor, juan@mail.com, +56912345678<br />
                        Maria Soto, Prevencionista, maria@mail.com, +56987654321
                      </code>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Pega tus datos aquí</label>
                      <textarea
                        value={csvData}
                        onChange={(e) => setCsvData(e.target.value)}
                        placeholder="nombre, cargo, email, telefono..."
                        className="w-full h-48 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-2xl p-4 text-zinc-900 dark:text-zinc-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-12 text-center space-y-6">
                  <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-500" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">Importación Finalizada</h3>
                    <p className="text-zinc-500">Se han procesado todos los registros.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-zinc-200 dark:border-white/5">
                      <p className="text-2xl font-black text-emerald-600 dark:text-emerald-500">{results.success}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase">Exitosos</p>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-zinc-200 dark:border-white/5">
                      <p className="text-2xl font-black text-rose-600 dark:text-rose-500">{results.errors}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase">Errores</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex gap-3">
              {!results ? (
                <>
                  <button
                    onClick={onClose}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={loading || !csvData.trim()}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 dark:bg-blue-500 text-white font-bold hover:bg-blue-700 dark:hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Procesando...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        <span>Iniciar Importación</span>
                      </>
                    )}
                  </button>
                </>
              ) : (
                <button
                  onClick={onClose}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black font-black uppercase tracking-widest text-[10px] hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
                >
                  Cerrar
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
