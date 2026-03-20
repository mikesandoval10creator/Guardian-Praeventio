import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, FileSpreadsheet, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { db, collection, addDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { NodeType } from '../../types';

interface MassImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

export function MassImportModal({ isOpen, onClose, projectId }: MassImportModalProps) {
  const { addNode } = useZettelkasten();
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-blue-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <FileSpreadsheet className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Importación Masiva</h2>
                  <p className="text-xs text-zinc-400">Carga múltiples trabajadores desde CSV</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {!results ? (
                <>
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
                      <h4 className="text-sm font-bold text-blue-400 mb-2 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Formato Requerido (CSV)
                      </h4>
                      <code className="text-[10px] text-zinc-400 block bg-black/40 p-3 rounded-xl">
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
                        className="w-full h-48 bg-zinc-800/50 border border-white/10 rounded-2xl p-4 text-zinc-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={onClose}
                      className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={loading || !csvData.trim()}
                      className="flex-2 px-4 py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
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
                  </div>
                </>
              ) : (
                <div className="py-12 text-center space-y-6">
                  <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Importación Finalizada</h3>
                    <p className="text-zinc-500">Se han procesado todos los registros.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
                    <div className="bg-zinc-800/50 p-4 rounded-2xl border border-white/5">
                      <p className="text-2xl font-black text-emerald-500">{results.success}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase">Exitosos</p>
                    </div>
                    <div className="bg-zinc-800/50 p-4 rounded-2xl border border-white/5">
                      <p className="text-2xl font-black text-rose-500">{results.errors}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase">Errores</p>
                    </div>
                  </div>

                  <button
                    onClick={onClose}
                    className="px-8 py-3 rounded-xl bg-white text-black font-black uppercase tracking-widest text-[10px] hover:bg-zinc-200 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
