import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Phone, Briefcase, Loader2, ShieldAlert } from 'lucide-react';
import { db, collection, addDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useIndustryIntegration } from '../../hooks/useIndustryIntegration';
import { NodeType } from '../../types';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { saveForSync } from '../../utils/pwa-offline';
import { TacticalOnboardingModal } from './TacticalOnboardingModal';

interface AddWorkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

export function AddWorkerModal({ isOpen, onClose, projectId }: AddWorkerModalProps) {
  const { addNode } = useRiskEngine();
  const { getEPP, availableRoles } = useIndustryIntegration();
  const [loading, setLoading] = useState(false);
  const [suggestedEPP, setSuggestedEPP] = useState<string[]>([]);
  const isOnline = useOnlineStatus();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [newWorkerData, setNewWorkerData] = useState<{name: string, role: string} | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    email: '',
    phone: '',
    status: 'active' as const,
    hasArt22: false
  });

  // Update EPP suggestions when role changes
  useEffect(() => {
    if (formData.role.length > 2) {
      const epp = getEPP(formData.role);
      setSuggestedEPP(epp);
    } else {
      setSuggestedEPP([]);
    }
  }, [formData.role, getEPP]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const path = projectId ? `projects/${projectId}/workers` : 'workers';
      const workerData = {
        ...formData,
        joinedAt: new Date().toISOString(),
        projectId: projectId || null,
        requiredEPP: suggestedEPP // Save required EPP to worker profile
      };

      if (!isOnline) {
        await saveForSync({
          type: 'create',
          collection: path,
          data: {
            ...workerData,
            createNode: true,
            nodeData: {
              type: NodeType.WORKER,
              title: formData.name,
              description: `Trabajador: ${formData.role}. Contacto: ${formData.email}`,
              tags: ['trabajador', String(formData.role || '').toLowerCase()],
              metadata: {
                email: formData.email,
                phone: formData.phone,
                role: formData.role,
                projectId: projectId || null,
                requiredEPP: suggestedEPP
              },
              connections: [],
              projectId: projectId
            }
          }
        });
      } else {
        // 1. Create Risk Node first to get the ID
        const node = await addNode({
          type: NodeType.WORKER,
          title: formData.name,
          description: `Trabajador: ${formData.role}. Contacto: ${formData.email}`,
          tags: ['trabajador', String(formData.role || '').toLowerCase()],
          metadata: {
            email: formData.email,
            phone: formData.phone,
            role: formData.role,
            projectId: projectId || null,
            requiredEPP: suggestedEPP // Inject the smart EPP requirement
          },
          connections: [],
          projectId: projectId
        });

        if (!node) throw new Error('Error al crear el nodo de conocimiento');

        // 2. Save to Firestore workers collection (subcollection or global)
        await addDoc(collection(db, path), { ...workerData, nodeId: node.id });
      }

      // Trigger Onboarding
      setNewWorkerData({ name: formData.name, role: formData.role });
      setShowOnboarding(true);

    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'workers');
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardingClose = () => {
    setShowOnboarding(false);
    setNewWorkerData(null);
    setFormData({ name: '', role: '', email: '', phone: '', status: 'active', hasArt22: false });
    onClose();
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && !showOnboarding && (
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
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-emerald-500/30 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl shadow-emerald-500/10 flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-emerald-50 dark:bg-gradient-to-r dark:from-emerald-500/10 dark:to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0">
                  <User className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Añadir Trabajador</h2>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-300 font-bold uppercase tracking-widest truncate">Ingresa los datos del nuevo personal</p>
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
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Nombre Completo</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ej: Juan Pérez"
                    className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm shadow-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Cargo / Función</label>
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                  <input
                    required
                    type="text"
                    list="roles-list"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    placeholder="Ej: Soldador, Operador de Grúa..."
                    className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm shadow-sm"
                  />
                  <datalist id="roles-list">
                    {availableRoles.map(role => (
                      <option key={role} value={role} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Risk Node AI Suggestion Box */}
              <AnimatePresence>
                {suggestedEPP.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 mt-2">
                      <div className="flex items-center gap-2 mb-2">
                        <ShieldAlert className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider">
                          Matriz EPP Automática (Red Neuronal)
                        </span>
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
                        Según el cargo de <strong>{formData.role}</strong>, el sistema asignará automáticamente los siguientes EPP:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {suggestedEPP.map((epp, idx) => (
                          <span key={idx} className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-1 rounded-md">
                            {epp}
                          </span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                    <input
                      required
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="juan@empresa.com"
                      className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm shadow-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">Teléfono</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="+56 9 1234 5678"
                      className="w-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm shadow-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-xl cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.hasArt22}
                    onChange={e => setFormData({ ...formData, hasArt22: e.target.checked })}
                    className="w-4 h-4 text-emerald-500 rounded border-zinc-300 focus:ring-emerald-500"
                  />
                  <div>
                    <p className="text-xs font-bold text-zinc-900 dark:text-white">Contrato Artículo 22</p>
                    <p className="text-[10px] text-zinc-500">Activa el rastreo GPS 24/7 automáticamente por exención de jornada laboral.</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-white font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar</span>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      <TacticalOnboardingModal 
        isOpen={showOnboarding} 
        onClose={handleOnboardingClose} 
        workerData={newWorkerData} 
      />
    </>
  );
}
