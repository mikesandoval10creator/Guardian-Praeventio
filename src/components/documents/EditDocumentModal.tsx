import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, Loader2 } from 'lucide-react';
import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

import { saveForSync } from '../../utils/pwa-offline';

interface Document {
  id: string;
  name: string;
  type: string;
  category: string;
  version: string;
  status: 'Vigente' | 'Vencido' | 'Pendiente';
  updatedAt: string;
  url?: string;
  projectId: string;
}

interface EditDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: Document | null;
  projectId?: string;
}

export function EditDocumentModal({ isOpen, onClose, document, projectId }: EditDocumentModalProps) {
  const [loading, setLoading] = useState(false);
  const isOnline = useOnlineStatus();
  const [formData, setFormData] = useState({
    name: '',
    type: 'PDF',
    category: 'Legal',
    version: '1.0',
    status: 'Vigente' as 'Vigente' | 'Vencido' | 'Pendiente'
  });

  useEffect(() => {
    if (document) {
      setFormData({
        name: document.name || '',
        type: document.type || 'PDF',
        category: document.category || 'Legal',
        version: document.version || '1.0',
        status: document.status || 'Vigente'
      });
    }
  }, [document]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!document || !projectId) return;
    setLoading(true);

    try {
      if (!isOnline) {
        await saveForSync({
          type: 'update',
          collection: `projects/${projectId}/documents`,
          docId: document.id,
          data: {
            ...formData,
            updatedAt: new Date().toISOString()
          }
        });
        alert('Edición guardada para sincronización cuando haya conexión.');
      } else {
        const docRef = doc(db, `projects/${projectId}/documents`, document.id);
        await updateDoc(docRef, {
          ...formData,
          updatedAt: new Date().toISOString()
        });
      }

      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}/documents`);
    } finally {
      setLoading(false);
    }
  };

  if (!document) return null;

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
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-indigo-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl shadow-indigo-500/10 flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-indigo-50 dark:bg-gradient-to-r dark:from-indigo-500/10 dark:to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-500 shrink-0">
                  <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Editar Documento</h2>
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-300 font-bold uppercase tracking-widest truncate">Actualiza la información del archivo</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 bg-white dark:bg-zinc-900">
              <form id="edit-doc-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
                    Nombre del Documento
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                    placeholder="Ej. Matriz IPERC 2024"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
                      Categoría
                    </label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
                    >
                      <option value="Legal">Legal</option>
                      <option value="Técnico">Técnico</option>
                      <option value="SST">SST</option>
                      <option value="Administrativo">Administrativo</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
                      Tipo
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
                    >
                      <option value="PDF">PDF</option>
                      <option value="DOCX">Word (DOCX)</option>
                      <option value="XLSX">Excel (XLSX)</option>
                      <option value="IMG">Imagen</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
                      Versión
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.version}
                      onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                      placeholder="1.0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2">
                      Estado
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Vigente' | 'Vencido' | 'Pendiente' })}
                      className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
                    >
                      <option value="Vigente">Vigente</option>
                      <option value="Pendiente">Pendiente</option>
                      <option value="Vencido">Vencido</option>
                    </select>
                  </div>
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 rounded-xl text-xs font-black text-zinc-600 dark:text-white uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="edit-doc-form"
                  disabled={loading}
                  className="flex-1 px-4 py-3 rounded-xl text-xs font-black text-white uppercase tracking-widest bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : !isOnline ? (
                    'Guardar Offline'
                  ) : (
                    'Guardar Cambios'
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
