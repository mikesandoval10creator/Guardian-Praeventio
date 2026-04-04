import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle2, 
  AlertCircle, 
  User, 
  MapPin, 
  Clock,
  ShieldCheck,
  ShieldAlert,
  Users
} from 'lucide-react';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useProject } from '../../contexts/ProjectContext';
import { db, collection, query, onSnapshot, doc, setDoc, getDocs, writeBatch, serverTimestamp, handleFirestoreError, OperationType } from '../../services/firebase';

interface WorkerStatus {
  id: string;
  name: string;
  status: 'safe' | 'danger' | 'unknown';
  lastLocation?: string;
  timestamp: string;
}

export function EmergencyCheckIn() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [myStatus, setMyStatus] = useState<'safe' | 'danger' | 'unknown'>('unknown');
  const [workers, setWorkers] = useState<WorkerStatus[]>([]);

  useEffect(() => {
    if (!selectedProject?.id) return;

    // Listen to emergency state (could be a document in the project)
    const projectRef = doc(db, 'projects', selectedProject.id);
    const unsubscribeProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        setIsEmergencyActive(docSnap.data().isEmergencyActive || false);
      }
    });

    // Listen to check-ins
    const checkinsRef = collection(db, `projects/${selectedProject.id}/emergency_checkins`);
    const unsubscribeCheckins = onSnapshot(checkinsRef, (snapshot) => {
      const newWorkers = snapshot.docs.map(doc => {
        const data = doc.data();
        let timeString = '';
        if (data.timestamp) {
          const date = data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
          timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        if (data.workerId === user?.uid) {
          setMyStatus(data.status);
        }

        return {
          id: doc.id,
          name: data.name || 'Desconocido',
          status: data.status || 'unknown',
          lastLocation: data.lastLocation,
          timestamp: timeString
        } as WorkerStatus;
      });
      setWorkers(newWorkers);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `projects/${selectedProject.id}/emergency_checkins`);
    });

    return () => {
      unsubscribeProject();
      unsubscribeCheckins();
    };
  }, [selectedProject?.id, user?.uid]);

  const handleStatusUpdate = async (status: 'safe' | 'danger') => {
    if (!selectedProject?.id || !user) return;

    try {
      const checkinRef = doc(db, `projects/${selectedProject.id}/emergency_checkins`, user.uid);
      await setDoc(checkinRef, {
        projectId: selectedProject.id,
        workerId: user.uid,
        name: user.displayName || 'Usuario',
        status: status,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${selectedProject.id}/emergency_checkins`);
    }
  };

  const toggleEmergency = async () => {
    if (!selectedProject?.id) return;
    try {
      const projectRef = doc(db, 'projects', selectedProject.id);
      const newStatus = !isEmergencyActive;
      await setDoc(projectRef, { isEmergencyActive: newStatus }, { merge: true });

      if (newStatus) {
        // Populate emergency_checkins with all workers
        const workersRef = collection(db, `projects/${selectedProject.id}/workers`);
        const workersSnap = await getDocs(workersRef);
        
        const checkinsRef = collection(db, `projects/${selectedProject.id}/emergency_checkins`);
        
        const batch = writeBatch(db);
        for (const workerDoc of workersSnap.docs) {
          const workerData = workerDoc.data();
          const checkinDocRef = doc(checkinsRef, workerDoc.id);
          batch.set(checkinDocRef, {
            projectId: selectedProject.id,
            workerId: workerDoc.id,
            name: workerData.name || 'Desconocido',
            status: 'unknown',
            timestamp: serverTimestamp()
          });
        }
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${selectedProject.id}`);
    }
  };

  const stats = {
    total: workers.length,
    safe: workers.filter(w => w.status === 'safe').length,
    danger: workers.filter(w => w.status === 'danger').length,
    unknown: workers.filter(w => w.status === 'unknown').length,
  };

  return (
    <div className="space-y-6">
      {/* Emergency Trigger (Admin only in real app) */}
      <div className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isEmergencyActive ? 'bg-rose-500 animate-pulse' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
          <span className="text-xs font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Estado de Emergencia: {isEmergencyActive ? 'ACTIVO' : 'INACTIVO'}
          </span>
        </div>
        <button
          onClick={toggleEmergency}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm ${
            isEmergencyActive 
              ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white' 
              : 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
          }`}
        >
          {isEmergencyActive ? 'Finalizar Emergencia' : 'Declarar Emergencia'}
        </button>
      </div>

      <AnimatePresence>
        {isEmergencyActive && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="space-y-6"
          >
            {/* My Status Card */}
            <div className="p-8 bg-white dark:bg-zinc-900 border-2 border-rose-200 dark:border-rose-500/50 rounded-3xl shadow-xl shadow-rose-500/5 dark:shadow-rose-500/10 text-center space-y-6">
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">¿Estás a salvo?</h3>
                <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Confirma tu estado para el equipo de rescate</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleStatusUpdate('safe')}
                  className={`flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all shadow-sm ${
                    myStatus === 'safe'
                      ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20'
                      : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-white/5 text-zinc-500 hover:border-emerald-500/30 hover:text-emerald-600 dark:hover:text-emerald-500'
                  }`}
                >
                  <ShieldCheck className="w-10 h-10" />
                  <span className="font-black uppercase tracking-widest text-xs">Estoy a Salvo</span>
                </button>
                <button
                  onClick={() => handleStatusUpdate('danger')}
                  className={`flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all shadow-sm ${
                    myStatus === 'danger'
                      ? 'bg-rose-500 border-rose-400 text-white shadow-lg shadow-rose-500/20'
                      : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-white/5 text-zinc-500 hover:border-rose-500/30 hover:text-rose-600 dark:hover:text-rose-500'
                  }`}
                >
                  <ShieldAlert className="w-10 h-10" />
                  <span className="font-black uppercase tracking-widest text-xs">Necesito Ayuda</span>
                </button>
              </div>
            </div>

            {/* Real-time Status Dashboard */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl text-center shadow-sm">
                <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest mb-1">A Salvo</p>
                <p className="text-3xl font-black text-zinc-900 dark:text-white">{stats.safe}</p>
              </div>
              <div className="p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-2xl text-center shadow-sm">
                <p className="text-[10px] font-black text-rose-600 dark:text-rose-500 uppercase tracking-widest mb-1">En Peligro</p>
                <p className="text-3xl font-black text-zinc-900 dark:text-white">{stats.danger}</p>
              </div>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5 rounded-2xl text-center shadow-sm">
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Sin Reportar</p>
                <p className="text-3xl font-black text-zinc-900 dark:text-white">{stats.unknown}</p>
              </div>
            </div>

            {/* Worker List */}
            <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5 flex items-center justify-between">
                <h4 className="text-[10px] font-black text-zinc-900 dark:text-white uppercase tracking-widest flex items-center gap-2">
                  <Users className="w-3 h-3" />
                  Estado del Personal
                </h4>
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Total: {stats.total}</span>
              </div>
              <div className="divide-y divide-zinc-200 dark:divide-white/5">
                {workers.map((worker) => (
                  <div key={worker.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 dark:text-zinc-500">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{worker.name}</p>
                        {worker.lastLocation && (
                          <p className="text-[10px] text-zinc-500 flex items-center gap-1">
                            <MapPin className="w-2 h-2" />
                            {worker.lastLocation}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className={`text-[10px] font-black uppercase tracking-widest ${
                          worker.status === 'safe' ? 'text-emerald-600 dark:text-emerald-500' : 
                          worker.status === 'danger' ? 'text-rose-600 dark:text-rose-500' : 'text-zinc-500'
                        }`}>
                          {worker.status === 'safe' ? 'A Salvo' : 
                           worker.status === 'danger' ? 'En Peligro' : 'Sin Reportar'}
                        </p>
                        <p className="text-[8px] text-zinc-400 dark:text-zinc-600 font-bold uppercase tracking-widest">{worker.timestamp}</p>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${
                        worker.status === 'safe' ? 'bg-emerald-500' : 
                        worker.status === 'danger' ? 'bg-rose-500 animate-pulse' : 'bg-zinc-300 dark:bg-zinc-700'
                      }`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
