import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle, 
  Users, 
  MapPin, 
  Activity, 
  ShieldAlert, 
  Phone, 
  CheckCircle2, 
  Clock,
  ChevronRight,
  Zap,
  Loader2
} from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { db, collection, onSnapshot, doc, handleFirestoreError, OperationType, query, where } from '../../services/firebase';
import { EmergencyCheckIn } from './EmergencyCheckIn';
import { CrisisChat } from './CrisisChat';
import { DynamicEvacuationMap } from './DynamicEvacuationMap';

export function EmergencyDashboard() {
  const { selectedProject } = useProject();
  const { user, userRole, isAdmin } = useFirebase();
  const [activeTab, setActiveTab] = useState<'overview' | 'checkin' | 'chat' | 'map'>('overview');
  const [stats, setStats] = useState({ total: 0, safe: 0, danger: 0, unknown: 0 });
  const [activeProtocol, setActiveProtocol] = useState<string>('Emergencia General');
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  const isWorker = userRole === 'worker' && !isAdmin;

  useEffect(() => {
    if (!selectedProject?.id) return;

    const projectRef = doc(db, 'projects', selectedProject.id);
    const unsubscribeProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.activeEmergencyProtocol) {
          setActiveProtocol(data.activeEmergencyProtocol);
        }
        if (data.emergencyStartTime) {
          const startTime = data.emergencyStartTime.toDate ? data.emergencyStartTime.toDate().getTime() : new Date(data.emergencyStartTime).getTime();
          const updateTimer = () => {
            setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
          };
          updateTimer();
          const interval = setInterval(updateTimer, 1000);
          return () => clearInterval(interval);
        }
      }
    });

    let checkinsQuery = query(collection(db, `projects/${selectedProject.id}/emergency_checkins`));
    if (isWorker && user) {
      checkinsQuery = query(collection(db, `projects/${selectedProject.id}/emergency_checkins`), where('workerId', '==', user.uid));
    }

    const unsubscribeCheckins = onSnapshot(checkinsQuery, (snapshot) => {
      const workers = snapshot.docs.map(doc => doc.data());
      setStats({
        total: workers.length,
        safe: workers.filter(w => w.status === 'safe').length,
        danger: workers.filter(w => w.status === 'danger').length,
        unknown: workers.filter(w => w.status === 'unknown').length,
      });
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `projects/${selectedProject.id}/emergency_checkins`);
    });

    return () => {
      unsubscribeProject();
      unsubscribeCheckins();
    };
  }, [selectedProject?.id, isWorker, user]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const tabs = [
    { id: 'overview', label: 'Resumen', icon: Activity },
    { id: 'checkin', label: 'Check-in', icon: Users },
    { id: 'chat', label: 'Crisis Chat', icon: ShieldAlert },
    { id: 'map', label: 'Mapa Evacuación', icon: MapPin },
  ];

  return (
    <div className="space-y-8">
      {/* Active Emergency Banner */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-5 sm:p-8 bg-rose-600 rounded-3xl sm:rounded-[40px] shadow-2xl shadow-rose-600/20 text-white relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6 sm:gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-xl sm:rounded-2xl flex items-center justify-center text-rose-600 shadow-xl shrink-0">
                <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8" />
              </div>
              <div>
                <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter leading-none">Emergencia Activa</h2>
                <p className="text-rose-200 text-[10px] sm:text-xs font-bold uppercase tracking-widest mt-1">{activeProtocol}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-rose-200" />
                <span className="text-xs sm:text-sm font-black uppercase tracking-widest">
                  {stats.total > 0 ? Math.round((stats.safe / stats.total) * 100) : 0}% Personal a Salvo
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-rose-200" />
                <span className="text-xs sm:text-sm font-black uppercase tracking-widest">Tiempo: {formatTime(elapsedTime)} min</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            <button className="px-6 sm:px-8 py-3 sm:py-4 bg-white text-rose-600 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] sm:text-xs shadow-xl hover:bg-rose-50 transition-all active:scale-95">
              Solicitar Apoyo Externo
            </button>
            <button className="p-3 sm:p-4 bg-rose-700/50 border border-white/20 rounded-xl sm:rounded-2xl hover:bg-rose-700 transition-all flex items-center justify-center">
              <Phone className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 p-2 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl overflow-x-auto scrollbar-hide shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-3 px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${
              activeTab === tab.id 
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-black shadow-lg' 
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-8 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-[32px] space-y-4 shadow-sm">
                    <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-500">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Personal Seguro</h4>
                      <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">{stats.safe} de {stats.total} trabajadores reportados</p>
                    </div>
                    <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${stats.total > 0 ? (stats.safe / stats.total) * 100 : 0}%` }}
                        className="h-full bg-emerald-500" 
                      />
                    </div>
                  </div>
                  <div className="p-8 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-[32px] space-y-4 shadow-sm">
                    <div className="w-12 h-12 bg-rose-50 dark:bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-600 dark:text-rose-500">
                      <ShieldAlert className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Zonas Críticas</h4>
                      <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">2 áreas con incidentes activos</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-rose-50 dark:bg-rose-500/20 text-rose-600 dark:text-rose-500 text-[8px] font-black uppercase tracking-widest rounded">Sector B</span>
                      <span className="px-2 py-1 bg-amber-50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-500 text-[8px] font-black uppercase tracking-widest rounded">Planta 2</span>
                    </div>
                  </div>
                </div>
                <DynamicEvacuationMap />
              </div>
              <div className="space-y-8">
                <CrisisChat />
              </div>
            </div>
          )}

          {activeTab === 'checkin' && <EmergencyCheckIn />}
          {activeTab === 'chat' && <CrisisChat />}
          {activeTab === 'map' && <DynamicEvacuationMap />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
