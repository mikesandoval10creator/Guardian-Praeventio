import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, Plus, Download, Trash2, Loader2, FileCheck, AlertCircle, ShieldCheck, AlertOctagon } from 'lucide-react';
import { db, collection, addDoc, onSnapshot, query, where, handleFirestoreError, OperationType, deleteDoc, doc, updateDoc } from '../../services/firebase';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { analyzeDocumentCompliance } from '../../services/geminiService';
import { Worker, NodeType } from '../../types';

interface WorkerDocument {
  id: string;
  name: string;
  type: string;
  url: string;
  createdAt: string;
  workerId: string;
  compliance?: {
    isCompliant: boolean;
    reason: string;
    urgency: string;
  };
}

interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker | null;
  projectId?: string;
}

export function DocsModal({ isOpen, onClose, worker, projectId }: DocsModalProps) {
  const { nodes, addNode, addConnection } = useRiskEngine();
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<WorkerDocument[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch documents for the worker
  React.useEffect(() => {
    if (!worker || !isOpen) return;

    const path = projectId ? `projects/${projectId}/workers/${worker.id}/documents` : `workers/${worker.id}/documents`;
    const q = query(collection(db, path));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WorkerDocument[];
      setDocuments(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [worker, isOpen, projectId]);

  if (!worker) return null;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !worker) return;
    const file = e.target.files[0];
    setIsUploading(true);
    try {
      const docName = file.name;
      const path = projectId ? `projects/${projectId}/workers/${worker.id}/documents` : `workers/${worker.id}/documents`;
      
      // 1. Upload to Firebase Storage
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('../../services/firebase');
      const storageRef = ref(storage, `documents/${worker.id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      // 2. AI Compliance Check
      const compliance = await analyzeDocumentCompliance(docName, worker.role);

      const newDoc = {
        name: docName,
        type: file.name.split('.').pop()?.toUpperCase() || 'FILE',
        url: downloadURL,
        createdAt: new Date().toISOString(),
        workerId: worker.id,
        compliance
      };

      const docRef = await addDoc(collection(db, path), newDoc);

      // 3. Create Risk Node
      const docNode = await addNode({
        type: NodeType.DOCUMENT,
        title: docName,
        description: `Documento para ${worker.name}: ${docName}\n\nAnálisis IA: ${compliance.reason}`,
        tags: ['documento', 'trabajador', String(worker.name || '').toLowerCase(), compliance.isCompliant ? 'cumple' : 'pendiente'],
        metadata: { 
          documentId: docRef.id, 
          workerId: worker.id,
          type: newDoc.type,
          compliance
        },
        connections: [],
        projectId: projectId
      });

      if (worker.nodeId && docNode) {
        await addConnection(worker.nodeId, docNode.id);
      }

    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'documents');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('¿Estás seguro de eliminar este documento?')) return;
    
    try {
      const path = projectId ? `projects/${projectId}/workers/${worker.id}/documents` : `workers/${worker.id}/documents`;
      await deleteDoc(doc(db, path, docId));
      // Note: We could also delete the Risk node, but usually nodes are kept for history
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'documents');
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
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-amber-500/5 dark:from-amber-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-500 shrink-0">
                  <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Documentación</h2>
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

            <div className="p-6 flex flex-col flex-1 overflow-hidden">
              <div className="flex justify-between items-center mb-4 shrink-0">
                <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Archivos ({documents.length})</h3>
                <label className={`flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  <span>Subir</span>
                  <input 
                    type="file" 
                    className="hidden" 
                    onChange={handleUpload}
                    disabled={isUploading}
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  />
                </label>
              </div>

              <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2 flex-1">
                {documents.length > 0 ? (
                  documents.map((doc) => (
                    <div 
                      key={doc.id}
                      className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 hover:border-amber-500/30 dark:hover:border-amber-500/30 transition-all group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center shrink-0">
                        <FileCheck className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-zinc-900 dark:text-white truncate">{doc.name}</h4>
                          {doc.compliance && (
                            <div className={`p-0.5 rounded-full shrink-0 ${
                              doc.compliance.isCompliant ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 
                              doc.compliance.urgency === 'HIGH' ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                            }`}>
                              {doc.compliance.isCompliant ? (
                                <ShieldCheck className="w-3 h-3" />
                              ) : doc.compliance.urgency === 'HIGH' ? (
                                <AlertOctagon className="w-3 h-3" />
                              ) : (
                                <AlertCircle className="w-3 h-3" />
                              )}
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-500 uppercase font-bold tracking-wider">
                          {doc.type} • {new Date(doc.createdAt).toLocaleDateString()}
                        </p>
                        {doc.compliance && !doc.compliance.isCompliant && (
                          <p className="text-[10px] text-zinc-600 dark:text-zinc-400 italic mt-1 line-clamp-1">
                            {doc.compliance.reason}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button className="p-2 hover:bg-zinc-200 dark:hover:bg-white/5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
                          <Download className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(doc.id)}
                          className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-10 text-center">
                    <div className="w-12 h-12 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <FileText className="w-6 h-6 text-zinc-400 dark:text-zinc-600" />
                    </div>
                    <p className="text-zinc-500 text-sm">No hay documentos cargados</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-amber-50 dark:bg-amber-500/5 border-t border-zinc-200 dark:border-white/5 text-center shrink-0">
              <p className="text-[10px] text-zinc-500 font-medium">
                Los documentos son enlazados automáticamente a la Red Neuronal para análisis de cumplimiento.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
