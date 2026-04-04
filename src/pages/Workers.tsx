import React, { useState, useEffect } from 'react';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { PersonalizedSafetyPlan } from '../components/workers/PersonalizedSafetyPlan';
import { TrainingRecommendations } from '../components/workers/TrainingRecommendations';
import { 
  UserPlus, 
  Search, 
  Filter, 
  MoreVertical, 
  Mail, 
  Phone, 
  Calendar,
  Shield,
  FileText,
  QrCode,
  BrainCircuit,
  GraduationCap,
  X,
  ShieldCheck,
  WifiOff,
  ChevronDown
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { Worker } from '../types';
import { AddWorkerModal } from '../components/workers/AddWorkerModal';
import { EditWorkerModal } from '../components/workers/EditWorkerModal';
import { EPPModal } from '../components/workers/EPPModal';
import { DocsModal } from '../components/workers/DocsModal';
import { QRCodeModal } from '../components/workers/QRCodeModal';
import { MassImportModal } from '../components/workers/MassImportModal';
import { AccessControlModal } from '../components/workers/AccessControlModal';
import { TraceabilityModal } from '../components/workers/TraceabilityModal';
import { LaborManagementModal } from '../components/workers/LaborManagementModal';
import { Database, RefreshCw, FileSignature } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function Workers() {
  const { selectedProject } = useProject();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [workerToEdit, setWorkerToEdit] = useState<Worker | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [filterRole, setFilterRole] = useState('all');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activeDropdown && !(e.target as Element).closest('.dropdown-container')) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown]);
  const [activeModal, setActiveModal] = useState<'epp' | 'docs' | 'qr' | 'safety-plan' | 'training' | 'access' | 'traceability' | 'labor' | null>(null);
  const isOnline = useOnlineStatus();
  
  const collectionPath = selectedProject ? `projects/${selectedProject.id}/workers` : 'workers';
  
  const handleDelete = async (workerId: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este trabajador?')) return;

    try {
      const workerRef = doc(db, collectionPath, workerId);
      await deleteDoc(workerRef);
    } catch (error) {
      console.error('Error deleting worker:', error);
      alert('Error al eliminar el trabajador');
    }
  };

  // Query workers for the selected project (now automatically includes pending actions)
  const { data: workers, loading } = useFirestoreCollection<Worker & { isPendingSync?: boolean }>(collectionPath);
  
  const filteredWorkers = workers.filter(worker => {
    const matchesSearch = worker.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          worker.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          worker.role.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = filterRole === 'all' || worker.role === filterRole;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-hidden box-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-white tracking-tight leading-tight">Trabajadores</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-xs sm:text-sm">
            {selectedProject 
              ? `Gestionando personal para: ${selectedProject.name}`
              : 'Gestión centralizada de personal y contratistas'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            disabled={!isOnline}
            title={!isOnline ? 'Requiere conexión a internet' : ''}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all active:scale-95 text-xs sm:text-sm ${
              !isOnline
                ? 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white'
            }`}
          >
            {!isOnline ? <WifiOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <QrCode className="w-4 h-4 sm:w-5 sm:h-5" />}
            <span>{!isOnline ? 'Requiere Conexión' : 'Importación Masiva'}</span>
          </button>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all active:scale-95 shadow-lg shadow-emerald-500/20 text-xs sm:text-sm"
          >
            <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Añadir Trabajador</span>
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por nombre, email o cargo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-9 sm:pl-10 pr-4 text-xs sm:text-sm text-zinc-900 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-sm"
          />
        </div>
        <div className="relative">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl py-2.5 pl-4 pr-10 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none transition-all shadow-sm"
          >
            <option value="all">Todos los roles</option>
            <option value="Supervisor">Supervisor</option>
            <option value="Operario">Operario</option>
            <option value="Prevencionista">Prevencionista</option>
            <option value="Técnico">Técnico</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      {/* Workers Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12 sm:py-20">
          <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-b-2 border-emerald-500"></div>
        </div>
      ) : filteredWorkers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredWorkers.map((worker, index) => (
            <motion.div
              key={worker.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 transition-all group relative shadow-sm"
            >
              <div className="absolute top-0 right-0 p-3 sm:p-4">
                <div className="relative dropdown-container">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveDropdown(activeDropdown === worker.id ? null : worker.id);
                    }}
                    className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    <MoreVertical className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  <AnimatePresence>
                    {activeDropdown === worker.id && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-1 w-32 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl z-20 overflow-hidden"
                      >
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setWorkerToEdit(worker);
                            setIsEditModalOpen(true);
                            setActiveDropdown(null);
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                        >
                          Editar
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(worker.id);
                            setActiveDropdown(null);
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                        >
                          Eliminar
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="flex items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-xl sm:text-2xl font-bold text-emerald-500 border border-zinc-200 dark:border-white/5 shrink-0">
                  {worker.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-zinc-900 dark:text-white text-base sm:text-lg leading-tight group-hover:text-emerald-500 dark:group-hover:text-emerald-400 transition-colors pr-6">
                    {worker.name}
                  </h3>
                  <p className="text-zinc-500 text-xs sm:text-sm font-medium mt-0.5">{worker.role}</p>
                  <div className="flex items-center gap-1.5 sm:gap-2 mt-1">
                    <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${worker.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                    <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                      {worker.status === 'active' ? 'Activo' : 'Inactivo'}
                    </span>
                    {worker.isPendingSync && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[9px] font-black uppercase tracking-widest flex items-center gap-1">
                        <RefreshCw className="w-2 h-2 animate-spin" />
                        Pendiente
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4 sm:mb-6">
                <div className="flex items-center gap-2 sm:gap-3 text-zinc-400 dark:text-zinc-500 text-xs sm:text-sm">
                  <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span className="truncate">{worker.email}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 text-zinc-400 dark:text-zinc-500 text-xs sm:text-sm">
                  <Phone className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>{worker.phone || 'No registrado'}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 text-zinc-400 dark:text-zinc-500 text-xs sm:text-sm">
                  <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>Ingreso: {worker.joinedAt ? new Date(worker.joinedAt).toLocaleDateString() : 'N/A'}</span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 pt-4 border-t border-zinc-200 dark:border-white/5">
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('labor'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <FileSignature className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 dark:text-amber-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">Laboral</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('epp'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500 dark:text-indigo-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">EPP</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('docs'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 dark:text-amber-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">Docs</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('safety-plan'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <BrainCircuit className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 dark:text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">Plan</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('training'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-500 dark:text-indigo-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">Capac</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('qr'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <QrCode className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500 dark:text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">QR</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('access'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500 dark:text-rose-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">Acceso</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('traceability'); }}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group/btn"
                >
                  <Database className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500 dark:text-blue-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[10px] sm:text-xs uppercase font-bold text-zinc-500 dark:text-zinc-400">Trazab</span>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl p-12 sm:p-20 text-center shadow-sm">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-50 dark:bg-zinc-800 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <UserPlus className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-400 dark:text-zinc-600" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white mb-2">No se encontraron trabajadores</h3>
          <p className="text-xs sm:text-sm text-zinc-500 max-w-md mx-auto">
            Comienza añadiendo personal a este proyecto para gestionar su seguridad y documentación.
          </p>
        </div>
      )}

      <AnimatePresence>
        {activeModal === 'safety-plan' && selectedWorker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-emerald-50 dark:bg-gradient-to-r dark:from-emerald-500/10 dark:to-transparent shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0">
                    <BrainCircuit className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Plan de Seguridad IA</h2>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest truncate">{selectedWorker.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveModal(null)}
                  className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-xl transition-colors shrink-0"
                >
                  <X className="w-5 h-5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white dark:bg-zinc-900">
                <PersonalizedSafetyPlan worker={{
                  id: selectedWorker.id,
                  title: selectedWorker.name,
                  description: selectedWorker.role,
                  type: 'PERSON' as any,
                  projectId: selectedProject?.id || '',
                  tags: [selectedWorker.role],
                  metadata: { role: selectedWorker.role },
                  connections: [],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeModal === 'training' && selectedWorker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-indigo-50 dark:bg-gradient-to-r dark:from-indigo-500/10 dark:to-transparent shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-600 dark:text-indigo-500 shrink-0">
                    <GraduationCap className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Capacitaciones IA</h2>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest truncate">{selectedWorker.name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveModal(null)}
                  className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-xl transition-colors shrink-0"
                >
                  <X className="w-5 h-5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white dark:bg-zinc-900">
                <TrainingRecommendations worker={{
                  id: selectedWorker.id,
                  title: selectedWorker.name,
                  description: selectedWorker.role,
                  type: 'PERSON' as any,
                  projectId: selectedProject?.id || '',
                  tags: [selectedWorker.role],
                  metadata: { role: selectedWorker.role },
                  connections: [],
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AddWorkerModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        projectId={selectedProject?.id}
      />

      <EditWorkerModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setWorkerToEdit(null);
        }}
        worker={workerToEdit}
        projectId={selectedProject?.id}
      />

      <EPPModal 
        isOpen={activeModal === 'epp'} 
        onClose={() => setActiveModal(null)} 
        worker={selectedWorker}
        projectId={selectedProject?.id}
      />

      <DocsModal 
        isOpen={activeModal === 'docs'} 
        onClose={() => setActiveModal(null)} 
        worker={selectedWorker}
        projectId={selectedProject?.id}
      />

      <QRCodeModal 
        isOpen={activeModal === 'qr'} 
        onClose={() => setActiveModal(null)} 
        worker={selectedWorker}
      />

      <MassImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        projectId={selectedProject?.id}
      />

      {selectedWorker && (
        <LaborManagementModal
          isOpen={activeModal === 'labor'}
          onClose={() => setActiveModal(null)}
          worker={selectedWorker}
        />
      )}

      <AccessControlModal
        isOpen={activeModal === 'access'}
        onClose={() => setActiveModal(null)}
        worker={selectedWorker}
        projectId={selectedProject?.id}
      />

      <TraceabilityModal
        isOpen={activeModal === 'traceability'}
        onClose={() => setActiveModal(null)}
        worker={selectedWorker}
        projectId={selectedProject?.id || null}
      />
    </div>
  );
}
