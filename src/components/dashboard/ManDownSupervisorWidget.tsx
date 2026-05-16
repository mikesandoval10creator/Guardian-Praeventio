import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle, Clock, User, ShieldAlert } from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { analytics } from '../../services/analytics';

interface ManDownEvent {
  id: string;
  workerId: string;
  workerName?: string;
  timestamp: { toDate: () => Date } | Date;
  status: 'pending' | 'acknowledged' | 'resolved';
  acknowledgedBy?: string;
  acknowledgedAt?: { toDate: () => Date } | Date;
  location?: { lat: number; lng: number };
}

function toDate(v: ManDownEvent['timestamp']): Date {
  if (!v) return new Date();
  if (v instanceof Date) return v;
  return (v as { toDate: () => Date }).toDate();
}

function fmt(v: ManDownEvent['timestamp']): string {
  return toDate(v).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function ManDownSupervisorWidget() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const [events, setEvents] = useState<ManDownEvent[]>([]);
  const [acking, setAcking] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedProject?.id) return undefined;
    const q = query(
      collection(db, 'projects', selectedProject.id, 'mandown_events'),
      orderBy('timestamp', 'desc'),
      limit(10),
    );
    return onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ManDownEvent)));
    });
  }, [selectedProject?.id]);

  const acknowledge = async (eventId: string) => {
    if (!selectedProject?.id || !user) return;
    setAcking(eventId);
    try {
      await updateDoc(
        doc(db, 'projects', selectedProject.id, 'mandown_events', eventId),
        {
          status: 'acknowledged',
          acknowledgedBy: user.displayName ?? user.email ?? user.uid,
          acknowledgedAt: new Date(),
        },
      );
      // Wave-14 analytics: ack of a man-down (fall-detection) event closes
      // the safety-critical loop — supervisor responded, protocol applied.
      // We treat ack as `risk.resolved` with `resolution_kind:
      // 'protocol_applied'` (the supervisor responded but no discrete
      // tarea was created). `risk_class:'fall'` mirrors the
      // emergency.fall.detected origin. Catalog row 60.
      try {
        const ev = events.find((e) => e.id === eventId);
        const startedMs = ev ? toDate(ev.timestamp).getTime() : Date.now();
        analytics.track('risk.resolved', {
          risk_id: eventId,
          risk_class: 'fall',
          time_to_resolve_seconds: Math.max(0, Math.floor((Date.now() - startedMs) / 1000)),
          resolution_kind: 'protocol_applied',
        });
      } catch { /* analytics must never break user flow */ }
    } finally {
      setAcking(null);
    }
  };

  const pending = events.filter((e) => e.status === 'pending');
  const recent = events.filter((e) => e.status !== 'pending').slice(0, 3);

  if (events.length === 0) return null;

  return (
    <div className="rounded-2xl border border-red-200/60 dark:border-red-900/40 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-950/40 border-b border-red-100 dark:border-red-900/40">
        <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-sm font-bold text-red-700 dark:text-red-300">Man Down — Alertas</span>
        {pending.length > 0 && (
          <span className="ml-auto min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center px-1.5">
            {pending.length}
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2">
        {/* Pending events */}
        <AnimatePresence initial={false}>
          {pending.map((ev) => (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50"
            >
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5 animate-pulse" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <User className="w-3 h-3 text-red-400 shrink-0" />
                  <span className="text-[12px] font-semibold text-red-700 dark:text-red-300 truncate">
                    {ev.workerName ?? ev.workerId}
                  </span>
                  <span className="text-[10px] text-red-400 ml-auto shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {fmt(ev.timestamp)}
                  </span>
                </div>
                {ev.location && (
                  <p className="text-[10px] text-red-500 dark:text-red-400 mt-0.5">
                    {ev.location.lat.toFixed(5)}, {ev.location.lng.toFixed(5)}
                  </p>
                )}
              </div>
              <button
                onClick={() => acknowledge(ev.id)}
                disabled={acking === ev.id}
                className="shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 transition-colors"
              >
                {acking === ev.id ? '…' : 'ACK'}
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Recent acknowledged */}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {recent.map((ev) => (
              <div
                key={ev.id}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 text-zinc-400"
              >
                <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                <span className="text-[11px] truncate flex-1">
                  {ev.workerName ?? ev.workerId}
                </span>
                <span className="text-[10px] shrink-0">{fmt(ev.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
