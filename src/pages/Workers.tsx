import React, { useState } from 'react';
import { motion } from 'framer-motion';
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
  ShieldCheck
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { Worker } from '../types';
import { AddWorkerModal } from '../components/workers/AddWorkerModal';
import { EPPModal } from '../components/workers/EPPModal';
import { DocsModal } from '../components/workers/DocsModal';
import { QRCodeModal } from '../components/workers/QRCodeModal';
import { MassImportModal } from '../components/workers/MassImportModal';
import { AccessControlModal } from '../components/workers/AccessControlModal';
import { TraceabilityModal } from '../components/workers/TraceabilityModal';
import { ERPSyncModal } from '../components/workers/ERPSyncModal';
import { Database, RefreshCw } from 'lucide-react';

export function Workers() {
  const { selectedProject } = useProject();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isERPSyncModalOpen, setIsERPSyncModalOpen] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [activeModal, setActiveModal] = useState<'epp' | 'docs' | 'qr' | 'safety-plan' | 'training' | 'access' | 'traceability' | null>(null);
  
  // Query workers for the selected project
  const { data: workers, loading } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : 'workers'
  );

  const filteredWorkers = workers.filter(worker => 
    worker.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    worker.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    worker.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-hidden box-border">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">Trabajadores</h1>
          <p className="text-zinc-400 mt-1 text-[10px] sm:text-sm">
            {selectedProject 
              ? `Gestionando personal para: ${selectedProject.name}`
              : 'Gestión centralizada de personal y contratistas'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button 
            onClick={() => setIsERPSyncModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 text-indigo-400 px-4 py-2.5 sm:py-2 rounded-xl font-black uppercase tracking-widest transition-all active:scale-95 text-[10px] sm:text-xs"
          >
            <RefreshCw className="w-4 h-4 sm:w-4 sm:h-4" />
            <span>Sincronizar ERP</span>
          </button>
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all active:scale-95 text-[10px] sm:text-sm"
          >
            <QrCode className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Importación Masiva</span>
          </button>
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 sm:py-2 rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/20 active:scale-95 text-[10px] sm:text-sm"
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
            className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-2.5 pl-9 sm:pl-10 pr-4 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          />
        </div>
        <button className="flex items-center justify-center gap-2 bg-zinc-900/50 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl py-2.5 transition-all text-[10px] sm:text-sm">
          <Filter className="w-4 h-4 sm:w-5 sm:h-5" />
          <span>Filtros Avanzados</span>
        </button>
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
              className="bg-zinc-900/50 border border-white/10 rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-3 sm:p-4">
                <button className="text-zinc-500 hover:text-white transition-colors">
                  <MoreVertical className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>

              <div className="flex items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-zinc-800 flex items-center justify-center text-xl sm:text-2xl font-bold text-emerald-500 border border-white/5 shrink-0">
                  {worker.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-bold text-white text-base sm:text-lg leading-tight group-hover:text-emerald-400 transition-colors pr-6">
                    {worker.name}
                  </h3>
                  <p className="text-zinc-500 text-xs sm:text-sm font-medium mt-0.5">{worker.role}</p>
                  <div className="flex items-center gap-1.5 sm:gap-2 mt-1">
                    <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${worker.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                    <span className="text-[8px] sm:text-[10px] uppercase tracking-wider text-zinc-400 font-bold">
                      {worker.status === 'active' ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4 sm:mb-6">
                <div className="flex items-center gap-2 sm:gap-3 text-zinc-400 text-xs sm:text-sm">
                  <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span className="truncate">{worker.email}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 text-zinc-400 text-xs sm:text-sm">
                  <Phone className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>{worker.phone || 'No registrado'}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 text-zinc-400 text-xs sm:text-sm">
                  <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span>Ingreso: {worker.joinedAt ? new Date(worker.joinedAt).toLocaleDateString() : 'N/A'}</span>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 pt-3 sm:pt-4 border-t border-white/5">
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('epp'); }}
                  className="flex flex-col items-center gap-1 p-1.5 sm:p-2 rounded-lg sm:rounded-xl hover:bg-white/5 transition-colors group/btn"
                >
                  <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[7px] sm:text-[8px] uppercase font-bold text-zinc-500">EPP</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('docs'); }}
                  className="flex flex-col items-center gap-1 p-1.5 sm:p-2 rounded-lg sm:rounded-xl hover:bg-white/5 transition-colors group/btn"
                >
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[7px] sm:text-[8px] uppercase font-bold text-zinc-500">Docs</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('safety-plan'); }}
                  className="flex flex-col items-center gap-1 p-1.5 sm:p-2 rounded-lg sm:rounded-xl hover:bg-white/5 transition-colors group/btn"
                >
                  <BrainCircuit className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[7px] sm:text-[8px] uppercase font-bold text-zinc-500">Plan</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('training'); }}
                  className="flex flex-col items-center gap-1 p-1.5 sm:p-2 rounded-lg sm:rounded-xl hover:bg-white/5 transition-colors group/btn"
                >
                  <GraduationCap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[7px] sm:text-[8px] uppercase font-bold text-zinc-500">Capac</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('qr'); }}
                  className="flex flex-col items-center gap-1 p-1.5 sm:p-2 rounded-lg sm:rounded-xl hover:bg-white/5 transition-colors group/btn"
                >
                  <QrCode className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[7px] sm:text-[8px] uppercase font-bold text-zinc-500">QR</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('access'); }}
                  className="flex flex-col items-center gap-1 p-1.5 sm:p-2 rounded-lg sm:rounded-xl hover:bg-white/5 transition-colors group/btn"
                >
                  <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[7px] sm:text-[8px] uppercase font-bold text-zinc-500">Acceso</span>
                </button>
                <button 
                  onClick={() => { setSelectedWorker(worker); setActiveModal('traceability'); }}
                  className="flex flex-col items-center gap-1 p-1.5 sm:p-2 rounded-lg sm:rounded-xl hover:bg-white/5 transition-colors group/btn"
                >
                  <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400 group-hover/btn:scale-110 transition-transform" />
                  <span className="text-[7px] sm:text-[8px] uppercase font-bold text-zinc-500">Trazab</span>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-2xl sm:rounded-3xl p-12 sm:p-20 text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-800 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
            <UserPlus className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-600" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">No se encontraron trabajadores</h3>
          <p className="text-xs sm:text-sm text-zinc-500 max-w-md mx-auto">
            Comienza añadiendo personal a este proyecto para gestionar su seguridad y documentación.
          </p>
        </div>
      )}

      {activeModal === 'safety-plan' && selectedWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-900 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white">
                  <BrainCircuit className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Plan de Seguridad IA</h2>
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{selectedWorker.name}</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
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

      {activeModal === 'training' && selectedWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-zinc-900 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Capacitaciones IA</h2>
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{selectedWorker.name}</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveModal(null)}
                className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
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

      <AddWorkerModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
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

      <ERPSyncModal
        isOpen={isERPSyncModalOpen}
        onClose={() => setIsERPSyncModalOpen(false)}
        projectId={selectedProject?.id}
      />

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
