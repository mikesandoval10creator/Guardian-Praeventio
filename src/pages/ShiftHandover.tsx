// Praeventio Guard — Sprint K wire UI (2026-05-23) — Cambio de Turno.
//
// Page `/shift-handover`. Service `shiftHandoverService.ts` (startShift +
// logEntry + addHandoverNote + endShift + acknowledgeHandover + summarize)
// + card `ShiftQualityCard.tsx` existían sin page consumidor.
//
// UX:
//   - Botón "Iniciar turno" crea shift activo (un supervisor por turno).
//   - Durante el turno, supervisor agrega entries (log cronológico) y
//     handover notes (categorizadas + severidad) que verá el entrante.
//   - Botón "Cerrar turno" → status endedAt; el entrante hace acknowledge
//     con notas + uid distinto del saliente.
//   - Lista historial de los últimos shifts con badge urgentes/pending.

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Clock,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Sun,
  Moon,
  ArrowDownToLine,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { ShiftQualityCard } from '../components/shiftHandover/ShiftQualityCard';
import {
  startShift,
  logEntry,
  addHandoverNote,
  endShift,
  acknowledgeHandover,
  type ShiftRecord,
  type ShiftKind,
  type HandoverCategory,
} from '../services/shiftHandover/shiftHandoverService';
import {
  saveShift,
  patchShift,
  subscribeShifts,
} from '../services/shiftHandover/shiftHandoverStore';
import { logger } from '../utils/logger';

const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
  extended: 'Extendido',
};

const CATEGORY_LABELS: Record<HandoverCategory, string> = {
  open_incidents: 'Incidentes abiertos',
  equipment_down: 'Equipo fuera',
  pending_controls: 'Controles pendientes',
  absent_workers: 'Ausencias',
  restricted_zones: 'Zonas restringidas',
  active_permits: 'Permisos activos',
  admin_pending: 'Administrativo',
  weather_alert: 'Clima',
  observation: 'Observación',
};

export function ShiftHandover() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form state.
  const [shiftKind, setShiftKind] = useState<ShiftKind>('morning');
  const [logText, setLogText] = useState('');
  const [logRequiresFollowUp, setLogRequiresFollowUp] = useState(false);
  const [noteCategory, setNoteCategory] = useState<HandoverCategory>('observation');
  const [noteText, setNoteText] = useState('');
  const [noteSeverity, setNoteSeverity] = useState<'info' | 'attention' | 'urgent'>('info');
  const [ackNotes, setAckNotes] = useState('');

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setShifts([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeShifts(
      projectId,
      (list) => {
        setShifts(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('shifts_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  // Turno activo del user actual (solo uno por supervisor).
  const myActiveShift = useMemo(
    () =>
      shifts.find(
        (s) => s.supervisorUid === user?.uid && !s.endedAt,
      ) ?? null,
    [shifts, user],
  );

  // Último turno cerrado sin acknowledge — candidato para handover.
  const pendingAck = useMemo(
    () =>
      shifts.find(
        (s) => s.endedAt && !s.acknowledgedAt && s.supervisorUid !== user?.uid,
      ) ?? null,
    [shifts, user],
  );

  const handleStart = useCallback(async () => {
    if (!user || !selectedProject) {
      setFeedback('Seleccioná un proyecto y autenticación válida.');
      return;
    }
    if (myActiveShift) {
      setFeedback('Ya tenés un turno activo. Cerralo antes de iniciar otro.');
      return;
    }
    try {
      const shift = startShift({
        id: `shift_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        projectId: selectedProject.id,
        kind: shiftKind,
        supervisorUid: user.uid,
      });
      await saveShift(selectedProject.id, shift);
      setFeedback(`Turno ${SHIFT_KIND_LABELS[shiftKind]} iniciado.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('startShift failed', { err: msg });
      setFeedback(msg);
    }
  }, [user, selectedProject, myActiveShift, shiftKind]);

  const handleLogEntry = useCallback(async () => {
    if (!myActiveShift || !user || !selectedProject) return;
    try {
      const updated = logEntry(myActiveShift, {
        authorUid: user.uid,
        authorRole: 'supervisor',
        text: logText,
        requiresFollowUp: logRequiresFollowUp,
      });
      await patchShift(selectedProject.id, myActiveShift.id, {
        logEntries: updated.logEntries,
      });
      setLogText('');
      setLogRequiresFollowUp(false);
      setFeedback('Entrada de log agregada.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback(msg);
    }
  }, [myActiveShift, user, selectedProject, logText, logRequiresFollowUp]);

  const handleAddNote = useCallback(async () => {
    if (!myActiveShift || !selectedProject) return;
    try {
      const updated = addHandoverNote(myActiveShift, {
        category: noteCategory,
        text: noteText,
        severity: noteSeverity,
      });
      await patchShift(selectedProject.id, myActiveShift.id, {
        handoverNotes: updated.handoverNotes,
      });
      setNoteText('');
      setFeedback('Nota de handover agregada.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback(msg);
    }
  }, [myActiveShift, selectedProject, noteCategory, noteText, noteSeverity]);

  const handleEnd = useCallback(async () => {
    if (!myActiveShift || !selectedProject) return;
    try {
      const ended = endShift(myActiveShift);
      await patchShift(selectedProject.id, myActiveShift.id, {
        endedAt: ended.endedAt,
      });
      setFeedback('Turno cerrado. El siguiente supervisor puede hacer handover.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback(msg);
    }
  }, [myActiveShift, selectedProject]);

  const handleAcknowledge = useCallback(async () => {
    if (!pendingAck || !user || !selectedProject) return;
    try {
      const acked = acknowledgeHandover(pendingAck, user.uid, ackNotes.trim() || undefined);
      await patchShift(selectedProject.id, pendingAck.id, {
        acknowledgedByUid: acked.acknowledgedByUid,
        acknowledgedAt: acked.acknowledgedAt,
        acknowledgmentNotes: acked.acknowledgmentNotes,
      });
      setAckNotes('');
      setFeedback(`Handover de ${pendingAck.id.slice(0, 12)} confirmado.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback(msg);
    }
  }, [pendingAck, user, selectedProject, ackNotes]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
            <Clock className="w-6 h-6 text-indigo-500" /> Cambio de turno
          </h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Handover formal supervisor saliente → supervisor entrante.
            Log cronológico durante el turno + notas categorizadas con
            severidad para que el entrante priorice al recibir.
          </p>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto para iniciar turnos.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {feedback && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Pending acknowledge banner. */}
            {pendingAck && (
              <section className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-900/20 p-4 space-y-3">
                <h2 className="text-sm font-black text-rose-700 dark:text-rose-300 uppercase tracking-widest flex items-center gap-2">
                  <ArrowDownToLine className="w-4 h-4" /> Handover pendiente de recibir
                </h2>
                <p className="text-xs text-rose-700 dark:text-rose-300">
                  El supervisor saliente cerró el turno {SHIFT_KIND_LABELS[pendingAck.kind]} con
                  {' '}{pendingAck.handoverNotes.length} nota(s) y{' '}
                  {pendingAck.logEntries.filter((e) => e.requiresFollowUp).length} follow-up(s).
                  Confirmá la recepción para tomar el turno entrante.
                </p>
                <ShiftQualityCard shift={pendingAck} />
                <textarea
                  value={ackNotes}
                  onChange={(e) => setAckNotes(e.target.value)}
                  rows={2}
                  placeholder="Notas opcionales del supervisor entrante (qué priorizás del handover)…"
                  className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleAcknowledge}
                  className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Confirmar recepción del turno
                </button>
              </section>
            )}

            {/* My active shift OR start form. */}
            {myActiveShift ? (
              <section className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/15 p-4 space-y-4">
                <h2 className="text-sm font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-widest flex items-center gap-2">
                  {myActiveShift.kind === 'night' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  Turno activo: {SHIFT_KIND_LABELS[myActiveShift.kind]}
                </h2>
                <ShiftQualityCard shift={myActiveShift} />

                {/* Log entry form. */}
                <div className="space-y-2">
                  <h3 className="text-xs font-black text-zinc-700 dark:text-zinc-300">
                    Agregar entrada al log ({myActiveShift.logEntries.length} entradas)
                  </h3>
                  <input
                    type="text"
                    value={logText}
                    onChange={(e) => setLogText(e.target.value)}
                    placeholder="Descripción de lo que pasó (min 5 chars)…"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                  />
                  <label className="flex items-center gap-2 text-[10px] text-zinc-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={logRequiresFollowUp}
                      onChange={(e) => setLogRequiresFollowUp(e.target.checked)}
                    />
                    Requiere follow-up del próximo turno
                  </label>
                  <button
                    type="button"
                    onClick={handleLogEntry}
                    disabled={logText.trim().length < 5}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
                  >
                    Agregar entrada
                  </button>
                </div>

                {/* Handover note form. */}
                <div className="space-y-2 pt-3 border-t border-indigo-200 dark:border-indigo-800">
                  <h3 className="text-xs font-black text-zinc-700 dark:text-zinc-300">
                    Nota para handover ({myActiveShift.handoverNotes.length} notas)
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={noteCategory}
                      onChange={(e) => setNoteCategory(e.target.value as HandoverCategory)}
                      className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <select
                      value={noteSeverity}
                      onChange={(e) => setNoteSeverity(e.target.value as 'info' | 'attention' | 'urgent')}
                      className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                    >
                      <option value="info">Info</option>
                      <option value="attention">Atención</option>
                      <option value="urgent">Urgente</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Nota para el supervisor entrante (min 5 chars)…"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleAddNote}
                    disabled={noteText.trim().length < 5}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
                  >
                    Agregar nota
                  </button>
                </div>

                <div className="pt-3 border-t border-indigo-200 dark:border-indigo-800">
                  <button
                    type="button"
                    onClick={handleEnd}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-zinc-700 hover:bg-zinc-600 text-white"
                  >
                    Cerrar turno
                  </button>
                </div>
              </section>
            ) : (
              <section className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-4 space-y-3">
                <h2 className="text-sm font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-widest">
                  Iniciar turno
                </h2>
                <div className="flex flex-wrap gap-2">
                  {(Object.entries(SHIFT_KIND_LABELS) as Array<[ShiftKind, string]>).map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setShiftKind(k)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                        shiftKind === k
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!user}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Iniciar turno
                </button>
              </section>
            )}

            {/* Historial — últimos 5 turnos cerrados. */}
            {shifts.filter((s) => s.endedAt).length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest">
                  Historial reciente
                </h2>
                <ul className="space-y-1.5">
                  {shifts
                    .filter((s) => s.endedAt)
                    .slice(0, 5)
                    .map((s) => (
                      <li
                        key={s.id}
                        className="rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/40 p-2 text-xs flex items-center gap-2"
                      >
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
                          s.acknowledgedAt
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        }`}>
                          {s.acknowledgedAt ? 'Recibido' : 'Sin recibir'}
                        </span>
                        <span className="text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                          {SHIFT_KIND_LABELS[s.kind]} · {s.logEntries.length} entradas · {s.handoverNotes.length} notas
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {new Date(s.startedAt).toLocaleDateString('es-CL')}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ShiftHandover;
