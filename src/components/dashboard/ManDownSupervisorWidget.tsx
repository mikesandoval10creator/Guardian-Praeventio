import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, MapPin, Clock, User } from 'lucide-react';
import { collection, onSnapshot, query, where, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { logger } from '../../utils/logger';

interface ManDownEvent {
  id: string;
  workerId: string;
  workerName: string | null;
  location: string;
  status: 'active' | 'acknowledged';
  triggeredAt: any;
}

export function ManDownSupervisorWidget() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const [events, setEvents] = useState<ManDownEvent[]>([]);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedProject?.id) return;

    const q = query(
      collection(db, `projects/${selectedProject.id}/mandown_events`),
      where('status', '==', 'active')
    );

    const unsub = onSnapshot(q, snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as ManDownEvent)));
    }, err => logger.error('[ManDownWidget] snapshot error', { message: err.message }));

    return unsub;
  }, [selectedProject?.id]);

  const acknowledge = async (eventId: string) => {
    if (!selectedProject?.id) return;
    setAcknowledging(eventId);
    try {
      await updateDoc(doc(db, `projects/${selectedProject.id}/mandown_events`, eventId), {
        status: 'acknowledged',
        acknowledgedBy: user?.uid ?? null,
        acknowledgedByName: user?.displayName ?? null,
        acknowledgedAt: serverTimestamp(),
      });
    } catch (err) {
      logger.error('[ManDownWidget] acknowledge failed', { message: (err as Error).message });
    } finally {
      setAcknowledging(null);
    }
  };

  if (events.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="mandown-widget"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        className="mx-1 sm:mx-0 mb-1 sm:mb-3"
      >
        <div className="rounded-2xl border-2 border-red-500 bg-red-950/80 backdrop-blur-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-red-600">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
            </span>
            <AlertTriangle className="w-5 h-5 text-white" />
            <span className="text-white font-black uppercase tracking-widest text-sm">
              ALERTA MAN DOWN — {events.length} {events.length === 1 ? 'trabajador' : 'trabajadores'}
            </span>
          </div>

          {/* Events */}
          <div className="divide-y divide-red-800/50">
            {events.map(ev => (
              <div key={ev.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-red-600/30 border border-red-500/50 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-red-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-bold text-sm truncate">
                      {ev.workerName ?? 'Trabajador desconocido'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <MapPin className="w-3 h-3 text-red-400 shrink-0" />
                      <span className="text-red-300 text-xs truncate">{ev.location}</span>
                    </div>
                    {ev.triggeredAt?.seconds && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 text-red-500 shrink-0" />
                        <span className="text-red-500 text-[10px]">
                          {new Date(ev.triggeredAt.seconds * 1000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => acknowledge(ev.id)}
                  disabled={acknowledging === ev.id}
                  className="shrink-0 flex items-center gap-2 px-3 py-2 bg-white text-red-700 rounded-xl font-black uppercase tracking-wider text-[10px] hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {acknowledging === ev.id ? 'Confirmando...' : 'Confirmar OK'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
