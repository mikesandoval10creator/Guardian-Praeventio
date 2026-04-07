import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Package, Calendar, Loader2 } from 'lucide-react';
import { db, serverTimestamp, storage, ref, uploadBytes, getDownloadURL } from '../../services/firebase';
import { collection, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { EPPItem, Worker, NodeType } from '../../types';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { jsPDF } from 'jspdf';
import { useFirebase } from '../../contexts/FirebaseContext';

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
  const { addNode } = useRiskEngine();
  const { user } = useFirebase();

  const generatePDF = async (worker: Worker, item: EPPItem, assignmentId: string) => {
    const doc = new jsPDF();
    const date = new Date().toLocaleDateString('es-CL');
    
    // Header
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('ACTA DE ENTREGA DE EPP', 105, 20, { align: 'center' });
    
    // Content
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Fecha: ${date}`, 20, 40);
    doc.text(`ID Asignación: ${assignmentId}`, 20, 50);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Datos del Trabajador:', 20, 70);
    doc.setFont('helvetica', 'normal');
    doc.text(`Nombre: ${worker.name}`, 30, 80);
    doc.text(`Rol: ${worker.role}`, 30, 90);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Detalles del Equipo de Protección Personal:', 20, 110);
    doc.setFont('helvetica', 'normal');
    doc.text(`Equipo: ${item.name}`, 30, 120);
    doc.text(`Categoría: ${item.category}`, 30, 130);
    if (expiresAt) {
      doc.text(`Fecha de Vencimiento: ${new Date(expiresAt).toLocaleDateString('es-CL')}`, 30, 140);
    }
    
    // Declaration
    doc.setFontSize(10);
    const declaration = `Por medio de la presente, el trabajador declara recibir conforme el Equipo de Protección Personal (EPP) detallado anteriormente, comprometiéndose a darle el uso correcto, mantenerlo en buen estado y solicitar su recambio cuando corresponda, de acuerdo a lo establecido en la Ley 16.744 y el Reglamento Interno de Orden, Higiene y Seguridad.`;
    const splitDeclaration = doc.splitTextToSize(declaration, 170);
    doc.text(splitDeclaration, 20, 160);
    
    // Signatures
    doc.line(30, 240, 90, 240);
    doc.text('Firma del Trabajador', 45, 250);
    
    doc.line(120, 240, 180, 240);
    doc.text('Firma Prevención de Riesgos', 125, 250);
    
    return doc.output('blob');
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !selectedWorker || !selectedItem || !user) return;

    setIsSubmitting(true);
    try {
      const worker = workers.find(w => w.id === selectedWorker);
      const item = eppItems.find(i => i.id === selectedItem);

      if (!worker || !item) throw new Error('Invalid selection');

      // Create assignment
      const assignmentRef = await addDoc(collection(db, `projects/${projectId}/epp_assignments`), {
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

      // Generate and upload PDF
      const pdfBlob = await generatePDF(worker, item, assignmentRef.id);
      const storageRef = ref(storage, `projects/${projectId}/documents/epp_acta_${assignmentRef.id}.pdf`);
      await uploadBytes(storageRef, pdfBlob);
      const downloadUrl = await getDownloadURL(storageRef);

      // Save document metadata
      const docRef = await addDoc(collection(db, `projects/${projectId}/documents`), {
        name: `Acta de Entrega EPP - ${worker.name} - ${item.name}`,
        category: 'SST',
        type: 'Acta de Entrega',
        status: 'Vigente',
        url: downloadUrl,
        uploadDate: new Date().toISOString(),
        uploadedBy: user.displayName || user.email || 'Sistema',
        projectId,
        createdAt: serverTimestamp()
      });

      // Decrease stock
      const itemRef = doc(db, `projects/${projectId}/epp_items`, item.id);
      await updateDoc(itemRef, {
        stock: increment(-1)
      });

      // Add to Risk Network
      await addNode({
        type: NodeType.EPP,
        title: `Asignación: ${item.name} a ${worker.name}`,
        description: `Se ha asignado ${item.name} a ${worker.name}. Acta de entrega generada.`,
        tags: ['epp', 'asignacion', String(item.category || '').toLowerCase(), 'acta'],
        projectId,
        connections: [worker.id], // Connect to worker node if it exists
        metadata: {
          assignmentId: assignmentRef.id,
          documentId: docRef.id,
          workerId: worker.id,
          eppItemId: item.id,
          assignedAt: new Date().toISOString(),
          expiresAt: expiresAt || null,
          status: 'active',
          pdfUrl: downloadUrl
        }
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
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex justify-between items-center bg-gradient-to-r from-emerald-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Asignar EPP</h2>
                  <p className="text-xs font-medium text-emerald-500">Generación de Acta</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-lg transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <form id="assign-epp-form" onSubmit={handleAssign} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 ml-1 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Trabajador
                  </label>
                  <select
                    required
                    value={selectedWorker}
                    onChange={e => setSelectedWorker(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="">Seleccionar trabajador...</option>
                    {workers.map(worker => (
                      <option key={worker.id} value={worker.id}>{worker.name} - {worker.role}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 ml-1 flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Item EPP
                  </label>
                  <select
                    required
                    value={selectedItem}
                    onChange={e => setSelectedItem(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  >
                    <option value="">Seleccionar item...</option>
                    {eppItems.filter(item => item.stock > 0).map(item => (
                      <option key={item.id} value={item.id}>{item.name} (Stock: {item.stock})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 ml-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Fecha de Vencimiento (Opcional)
                  </label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={e => setExpiresAt(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                  />
                </div>
              </form>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900 shrink-0 flex justify-end gap-3">
              <button 
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium text-sm hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="assign-epp-form"
                disabled={isSubmitting || !selectedWorker || !selectedItem}
                className="px-4 py-2 rounded-xl bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Generando Acta...</span>
                  </>
                ) : (
                  <span>Confirmar Asignación</span>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
