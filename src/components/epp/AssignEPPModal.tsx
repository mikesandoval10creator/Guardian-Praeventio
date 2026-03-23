import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Package, Calendar } from 'lucide-react';
import { db, serverTimestamp } from '../../services/firebase';
import { collection, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { EPPItem, Worker } from '../../types';

interface AssignEPPModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  eppItems: EPPItem[];
  workers: Worker[];
}

export function AssignEPPModal({ isOpen, onClose, projectId, eppItems, workers }: AssignEPPModalProps) {
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedItem, setSelectedItem] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !selectedWorker || !selectedItem) return;

    setIsSubmitting(true);
    try {
      const worker = workers.find(w => w.id === selectedWorker);
      const item = eppItems.find(i => i.id === selectedItem);

      if (!worker || !item) throw new Error('Invalid selection');

      // Create assignment
      await addDoc(collection(db, `projects/${projectId}/epp_assignments`), {
        projectId,
        workerId: worker.id,
        workerName: worker.name,
        eppItemId: item.id,
        eppItemName: item.name,
        assignedAt: new Date().toISOString(),
        expiresAt: expiresAt || null,
        status: 'active',
        createdAt: serverTimestamp()
      });

      // Decrease stock
      const itemRef = doc(db, `projects/${projectId}/epp_items`, item.id);
      await updateDoc(itemRef, {
        stock: increment(-1)
      });

      onClose();
      setSelectedWorker('');
      setSelectedItem('');
      setExpiresAt('');
    } catch (error) {
      console.error('Error assigning EPP:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl p-6 w-full max-w-md relative"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-6">Asignar EPP</h2>

            <form onSubmit={handleAssign} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Trabajador
                </label>
                <select
                  required
                  value={selectedWorker}
                  onChange={e => setSelectedWorker(e.target.value)}
                  className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                >
                  <option value="">Seleccionar trabajador...</option>
                  {workers.map(worker => (
                    <option key={worker.id} value={worker.id}>{worker.name} - {worker.role}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Item EPP
                </label>
                <select
                  required
                  value={selectedItem}
                  onChange={e => setSelectedItem(e.target.value)}
                  className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                >
                  <option value="">Seleccionar item...</option>
                  {eppItems.filter(item => item.stock > 0).map(item => (
                    <option key={item.id} value={item.id}>{item.name} (Stock: {item.stock})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Fecha de Vencimiento (Opcional)
                </label>
                <input
                  type="date"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                  className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !selectedWorker || !selectedItem}
                className="w-full bg-emerald-500 text-white font-black uppercase tracking-widest py-4 rounded-xl hover:bg-emerald-600 transition-colors mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Asignando...' : 'Confirmar Asignación'}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
