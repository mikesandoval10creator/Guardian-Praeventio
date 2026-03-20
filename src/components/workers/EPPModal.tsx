import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Check, Loader2, AlertCircle } from 'lucide-react';
import { db, doc, updateDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { eppCatalog } from '../../data/epp';
import { Worker, NodeType } from '../../types';

interface EPPModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker | null;
  projectId?: string;
}

export function EPPModal({ isOpen, onClose, worker, projectId }: EPPModalProps) {
  const { nodes, addNode, addConnection } = useZettelkasten();
  const [loading, setLoading] = useState(false);
  const [assignedEppIds, setAssignedEppIds] = useState<string[]>(worker?.eppIds || []);

  // Sync state when worker changes
  React.useEffect(() => {
    if (worker) {
      setAssignedEppIds(worker.eppIds || []);
    }
  }, [worker]);

  if (!worker) return null;

  const handleToggleEpp = async (eppId: string) => {
    const isAssigned = assignedEppIds.includes(eppId);
    const newIds = isAssigned 
      ? assignedEppIds.filter(id => id !== eppId)
      : [...assignedEppIds, eppId];
    
    setAssignedEppIds(newIds);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      // 1. Update Worker in Firestore
      const path = projectId ? `projects/${projectId}/workers` : 'workers';
      const workerRef = doc(db, path, worker.id);
      await updateDoc(workerRef, { eppIds: assignedEppIds });

      // 2. Sync with Zettelkasten
      // Find worker node
      const workerNode = nodes.find(n => n.type === NodeType.WORKER && n.metadata.workerId === worker.id);
      
      if (workerNode) {
        for (const eppId of assignedEppIds) {
          const eppItem = eppCatalog.find(e => e.id === eppId);
          if (!eppItem) continue;

          // Find or create EPP node
          let eppNode = nodes.find(n => n.type === NodeType.EPP && n.title === eppItem.name);
          
          if (!eppNode) {
            eppNode = await addNode({
              type: NodeType.EPP,
              title: eppItem.name,
              description: eppItem.description,
              tags: ['epp', eppItem.category.toLowerCase()],
              metadata: { eppId: eppItem.id, category: eppItem.category },
              connections: [],
              projectId: projectId
            });
          }

          if (eppNode) {
            // Connect worker to EPP
            await addConnection(workerNode.id, eppNode.id);
          }
        }
      }

      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'workers');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-indigo-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Asignación de EPP</h2>
                  <p className="text-xs text-zinc-400">{worker.name}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 gap-3">
                {eppCatalog.map((item) => {
                  const isAssigned = assignedEppIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleToggleEpp(item.id)}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group ${
                        isAssigned 
                          ? 'bg-indigo-500/10 border-indigo-500/50' 
                          : 'bg-zinc-800/50 border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl overflow-hidden border ${isAssigned ? 'border-indigo-500/30' : 'border-white/5'}`}>
                        <img 
                          src={item.imageUrl || undefined} 
                          alt={item.name} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="flex-1">
                        <h4 className={`font-bold text-sm ${isAssigned ? 'text-indigo-400' : 'text-white'}`}>
                          {item.name}
                        </h4>
                        <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                          {item.category}
                        </p>
                      </div>
                      <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
                        isAssigned 
                          ? 'bg-indigo-500 border-indigo-500 text-white' 
                          : 'border-white/10 text-transparent'
                      }`}>
                        <Check className="w-4 h-4" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-6 border-t border-white/5 bg-zinc-900/50 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-500 text-white font-bold hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar Cambios</span>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
