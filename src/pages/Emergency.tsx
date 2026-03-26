import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FileText, 
  AlertTriangle, 
  Phone, 
  Shield, 
  ChevronRight, 
  BookOpen, 
  Download,
  Search,
  CheckCircle2,
  Clock,
  Activity,
  Zap,
  Power,
  Loader2
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useManDownDetection } from '../hooks/useManDownDetection';
import { DynamicEvacuationMap } from '../components/emergency/DynamicEvacuationMap';
import { EmergencyDashboard } from '../components/emergency/EmergencyDashboard';
import { db, doc, onSnapshot, setDoc, handleFirestoreError, OperationType } from '../services/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';

interface EmergencyProtocol {
  id: string;
  title: string;
  category: string;
  lastReview: string;
  status: 'active' | 'review' | 'draft';
}

export function Emergency() {
  const { selectedProject } = useProject();
  const [searchTerm, setSearchTerm] = useState('');
  const [isCrisisMode, setIsCrisisMode] = useState(false);
  const { isActive, isAlerting, countdown, startDetection, stopDetection } = useManDownDetection();

  const { data: protocolsData, loading: loadingProtocols } = useFirestoreCollection<EmergencyProtocol>(
    selectedProject ? `projects/${selectedProject.id}/emergency_protocols` : null
  );

  React.useEffect(() => {
    if (!selectedProject?.id) return;
    const projectRef = doc(db, 'projects', selectedProject.id);
    const unsubscribe = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        setIsCrisisMode(docSnap.data().isEmergencyActive || false);
      }
    });
    return () => unsubscribe();
  }, [selectedProject?.id]);

  const toggleCrisisMode = async () => {
    if (!selectedProject?.id) return;
    try {
      const projectRef = doc(db, 'projects', selectedProject.id);
      const newStatus = !isCrisisMode;
      const updateData: any = { isEmergencyActive: newStatus };
      
      if (newStatus) {
        updateData.emergencyStartTime = new Date().toISOString();
        updateData.activeEmergencyProtocol = 'Emergencia General';
      } else {
        updateData.emergencyStartTime = null;
        updateData.activeEmergencyProtocol = null;
      }
      
      await setDoc(projectRef, updateData, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${selectedProject.id}`);
    }
  };

  // Fallback to default protocols if none exist in Firestore
  const defaultProtocols: EmergencyProtocol[] = [
    { id: 'P1', title: 'Protocolo de Incendio', category: 'Fuego', lastReview: '2024-01-15', status: 'active' },
    { id: 'P2', title: 'Protocolo de Sismo', category: 'Natural', lastReview: '2024-02-10', status: 'active' },
    { id: 'P3', title: 'Protocolo de Derrame Químico', category: 'Químico', lastReview: '2023-11-20', status: 'review' },
    { id: 'P4', title: 'Protocolo de Primeros Auxilios', category: 'Salud', lastReview: '2024-03-05', status: 'active' },
  ];

  const protocols = protocolsData && protocolsData.length > 0 ? protocolsData : defaultProtocols;

  const filteredProtocols = protocols.filter(p => 
    p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-hidden box-border">
      {/* Man Down Alert Overlay */}
      <AnimatePresence>
        {isAlerting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-rose-600/90 backdrop-blur-xl p-6"
          >
            <div className="max-w-md w-full text-center space-y-8">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="w-32 h-32 bg-white rounded-full flex items-center justify-center mx-auto shadow-2xl shadow-white/20"
              >
                <AlertTriangle className="w-16 h-16 text-rose-600" />
              </motion.div>
              <div className="space-y-2">
                <h2 className="text-4xl font-black text-white uppercase tracking-tighter">¡ALERTA DE INMOVILIDAD!</h2>
                <p className="text-white/80 font-bold uppercase tracking-widest text-xs">Se ha detectado falta de movimiento prolongada</p>
              </div>
              <div className="text-8xl font-black text-white tabular-nums">
                {countdown}
              </div>
              <p className="text-white/60 text-sm font-medium">
                Si no cancelas esta alerta, se enviará una notificación de emergencia a todo el equipo en {countdown} segundos.
              </p>
              <button
                onClick={stopDetection}
                className="w-full bg-white text-rose-600 py-6 rounded-3xl font-black uppercase tracking-widest shadow-2xl active:scale-95 transition-all"
              >
                Cancelar Alerta
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Plan de Emergencia</h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            {selectedProject 
              ? `Protocolos y planes de acción para: ${selectedProject.name}`
              : 'Gestión centralizada de protocolos de seguridad y respuesta'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="flex gap-2 w-full sm:w-auto">
            <Link 
              to="/emergency-generator"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white px-3 sm:px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[9px] sm:text-[10px] transition-all"
            >
              <Zap className="w-4 h-4" />
              <span>Generador IA</span>
            </Link>
            <button 
              onClick={toggleCrisisMode}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[9px] sm:text-[10px] transition-all ${
                isCrisisMode 
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' 
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              <Zap className={`w-4 h-4 ${isCrisisMode ? 'animate-pulse' : ''}`} />
              <span>{isCrisisMode ? 'Crisis Activa' : 'Modo Crisis'}</span>
            </button>
          </div>
          <button className="w-full sm:w-auto flex items-center justify-center gap-2 bg-zinc-900/50 border border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 px-4 py-3 sm:py-2 rounded-xl font-medium transition-all text-sm">
            <Download className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Descargar Plan Completo</span>
          </button>
          <button className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-3 sm:py-2 rounded-xl font-medium transition-all shadow-lg shadow-emerald-500/20 active:scale-95 text-sm">
            <Phone className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Contactos de Emergencia</span>
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {isCrisisMode ? (
          <motion.div
            key="crisis-dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <EmergencyDashboard />
          </motion.div>
        ) : (
          <motion.div
            key="standard-emergency"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            {/* Protocols List */}
            <div className="lg:col-span-2 space-y-6">
              <DynamicEvacuationMap />
              
              {/* Man Down Control Panel */}
              <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all ${
                isActive ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-900/50 border-white/10'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 sm:mb-6">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all shrink-0 ${
                      isActive ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-white leading-tight">Hombre Caído (Auto-Detección)</h3>
                      <p className="text-[10px] sm:text-xs text-zinc-500 font-medium uppercase tracking-widest mt-0.5">
                        {isActive ? 'Monitoreo de movimiento activo' : 'Sistema desactivado'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={isActive ? stopDetection : startDetection}
                    className={`w-full sm:w-14 h-12 sm:h-14 rounded-xl sm:rounded-full flex items-center justify-center gap-2 transition-all active:scale-95 ${
                      isActive ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                    }`}
                  >
                    <Power className="w-5 h-5 sm:w-6 sm:h-6" />
                    <span className="sm:hidden font-bold uppercase tracking-widest text-xs">
                      {isActive ? 'Desactivar' : 'Activar'}
                    </span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-3 sm:p-4 bg-black/20 rounded-xl sm:rounded-2xl border border-white/5">
                    <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Estado Sensores</p>
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                      <span className="text-[10px] sm:text-xs font-bold text-white uppercase">{isActive ? 'Conectado' : 'Inactivo'}</span>
                    </div>
                  </div>
                  <div className="p-3 sm:p-4 bg-black/20 rounded-xl sm:rounded-2xl border border-white/5">
                    <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Último Movimiento</p>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span className="text-[10px] sm:text-xs font-bold text-white uppercase">{isActive ? 'Hace 1s' : '--:--'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Buscar protocolo de emergencia..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {filteredProtocols.map((protocol, index) => (
                  <motion.div
                    key={protocol.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-zinc-900/50 border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 transition-all group cursor-pointer flex flex-col"
                  >
                    <div className="flex items-start justify-between mb-3 sm:mb-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-zinc-800 flex items-center justify-center text-emerald-500 border border-white/5 shrink-0">
                        <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[7px] sm:text-[8px] font-black uppercase tracking-widest ${
                        protocol.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                      }`}>
                        {protocol.status === 'active' ? 'Vigente' : 'En Revisión'}
                      </span>
                    </div>
                    <h3 className="font-bold text-white text-base sm:text-lg group-hover:text-emerald-400 transition-colors leading-tight flex-1">{protocol.title}</h3>
                    <p className="text-zinc-500 text-[10px] sm:text-xs font-medium mt-1 uppercase tracking-wider">{protocol.category}</p>
                    <div className="flex items-center justify-between mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-white/5">
                      <div className="flex items-center gap-1.5 text-zinc-500 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                        <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span>Revisión: {protocol.lastReview}</span>
                      </div>
                      <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 text-zinc-600 group-hover:text-emerald-500 transition-colors" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Sidebar Info */}
            <div className="space-y-4 sm:space-y-6">
              <div className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-bold text-white mb-3 sm:mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                  Alertas Recientes
                </h3>
                <div className="space-y-3 sm:space-y-4">
                  {[
                    { title: 'Simulacro Programado', date: 'Mañana, 10:00 AM', type: 'info' },
                    { title: 'Revisión de Extintores', date: 'Viernes, 14:00 PM', type: 'warning' },
                  ].map((alert, i) => (
                    <div key={i} className="flex gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl bg-zinc-800/50 border border-white/5">
                      <div className={`w-1 sm:w-1.5 rounded-full shrink-0 ${alert.type === 'info' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                      <div>
                        <h4 className="text-xs sm:text-sm font-bold text-white">{alert.title}</h4>
                        <p className="text-[9px] sm:text-[10px] text-zinc-500 font-medium uppercase tracking-wider mt-0.5">{alert.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-bold text-white mb-3 sm:mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                  Estado de Cumplimiento
                </h3>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-zinc-400">Plan de Emergencia</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-zinc-400">Brigada de Emergencia</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-zinc-400">Señalética</span>
                    <div className="w-4 h-4 rounded-full border-2 border-zinc-700" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
