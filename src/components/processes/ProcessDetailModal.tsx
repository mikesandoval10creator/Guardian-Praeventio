// SPDX-License-Identifier: MIT
// Sprint 16 — Process detail modal.
//
// Surface header + score + alertas atendidas + tasks list + hallazgos
// relacionados + botones (Cerrar / Pausar / Reanudar). Reads tasks via
// Firestore `tasks` collection filtered by processId. Hallazgos come from
// `hallazgos` collection filtered by processId (best-effort; no schema
// migration required — empty when none exist).

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PauseCircle, PlayCircle, ShieldCheck, ListTodo, Search } from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import type { Process, Task as OrganicTask } from '../../types/organic';
import { db, auth } from '../../services/firebase';
import { CloseProcessModal } from './CloseProcessModal';

export interface ProcessDetailModalProps {
  isOpen: boolean;
  process: Process | null;
  onClose: () => void;
  onStatusChanged?: (next: Process) => void;
}

const STATUS_LABEL: Record<Process['status'], string> = {
  planning: 'En planificación',
  active: 'Activo',
  paused: 'Pausado',
  completed: 'Cerrado',
  aborted: 'Abortado',
};

const STATUS_TONE: Record<Process['status'], string> = {
  planning: 'bg-slate-100 text-slate-700',
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  aborted: 'bg-rose-100 text-rose-700',
};

export function ProcessDetailModal({ isOpen, process, onClose, onStatusChanged }: ProcessDetailModalProps) {
  const [tasks, setTasks] = useState<OrganicTask[]>([]);
  const [hallazgos, setHallazgos] = useState<Array<{ id: string; title?: string; description?: string }>>([]);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [busy, setBusy] = useState<'pause' | 'resume' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to tasks
  useEffect(() => {
    if (!isOpen || !process) {
      setTasks([]);
      return;
    }
    const q = query(collection(db, 'tasks'), where('processId', '==', process.id));
    const un = onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrganicTask, 'id'>) })));
      },
      () => setTasks([])
    );
    return () => un();
  }, [isOpen, process]);

  // Subscribe to hallazgos (best-effort; collection may not exist for all
  // tenants — onSnapshot error fallback is silent).
  useEffect(() => {
    if (!isOpen || !process) {
      setHallazgos([]);
      return;
    }
    const q = query(collection(db, 'hallazgos'), where('processId', '==', process.id));
    const un = onSnapshot(
      q,
      (snap) => setHallazgos(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => setHallazgos([])
    );
    return () => un();
  }, [isOpen, process]);

  const tasksDone = useMemo(() => tasks.filter((t) => t.status === 'done').length, [tasks]);

  if (!isOpen || !process) return null;

  const setStatus = async (next: 'paused' | 'active') => {
    setBusy(next === 'paused' ? 'pause' : 'resume');
    setError(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setError('Sesión no disponible.');
        setBusy(null);
        return;
      }
      const res = await fetch(`/api/processes/${process.id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error ?? `Error ${res.status}`);
      } else {
        onStatusChanged?.({ ...process, status: next });
      }
    } catch (err: any) {
      setError(err?.message ?? 'Error de red');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-2xl rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{process.name}</h3>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_TONE[process.status]}`}>
                  {STATUS_LABEL[process.status]}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                Tipo: {process.type} · Cumplimiento {process.complianceScore}/100 · Alertas atendidas: {process.alertsResponded}
              </p>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {process.description && (
              <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {process.description}
              </p>
            )}

            <section>
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-2">
                <ListTodo className="w-3.5 h-3.5" />
                Tareas ({tasksDone}/{tasks.length})
              </h4>
              {tasks.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Sin tareas registradas.</p>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span className={t.status === 'done' ? 'line-through text-zinc-500' : 'text-zinc-800 dark:text-zinc-200'}>
                        {t.description}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                        {t.status} · {t.date}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-2">
                <Search className="w-3.5 h-3.5" />
                Hallazgos relacionados ({hallazgos.length})
              </h4>
              {hallazgos.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Sin hallazgos asociados.</p>
              ) : (
                <ul className="space-y-1">
                  {hallazgos.slice(0, 6).map((h) => (
                    <li key={h.id} className="text-xs text-zinc-700 dark:text-zinc-300">
                      <span className="font-semibold">{h.title ?? h.id}</span>
                      {h.description && <span className="text-zinc-500"> — {h.description}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800">
            {process.status === 'active' && (
              <button
                disabled={busy !== null}
                onClick={() => setStatus('paused')}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                <PauseCircle className="w-3.5 h-3.5" />
                Pausar
              </button>
            )}
            {process.status === 'paused' && (
              <button
                disabled={busy !== null}
                onClick={() => setStatus('active')}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                <PlayCircle className="w-3.5 h-3.5" />
                Reanudar
              </button>
            )}
            {(process.status === 'active' || process.status === 'paused') && (
              <button
                onClick={() => setShowCloseModal(true)}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                Cerrar proceso
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cerrar
            </button>
          </div>
        </motion.div>

        <CloseProcessModal
          isOpen={showCloseModal}
          process={process}
          onClose={() => setShowCloseModal(false)}
          onClosed={() => {
            setShowCloseModal(false);
            onStatusChanged?.({ ...process, status: 'completed' });
            onClose();
          }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
