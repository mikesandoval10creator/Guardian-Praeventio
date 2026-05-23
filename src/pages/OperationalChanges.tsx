// Praeventio Guard — Sprint K wire UI (2026-05-23) — Gestión de Cambios (MOC).
//
// Page `/operational-changes`. Service `operationalChangeService.ts`
// (declareChange + acknowledgeChange + revertChange + summarize) + card
// `OperationalChangeCard.tsx` existían sin page consumidor.
//
// UX:
//   - Supervisor declara cambio (kind, what/previous/new, rationale,
//     impact, affectedWorkers).
//   - Workers afectados confirman lectura (acknowledge button visible
//     solo si el user está en affectedWorkerUids y no ha hecho ack).
//   - Card muestra coverage % de acknowledgments.

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  GitCompare,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Undo2,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { OperationalChangeCard } from '../components/changeMgmt/OperationalChangeCard';
import {
  declareChange,
  acknowledgeChange,
  revertChange,
  summarizeAcknowledgments,
  type OperationalChange,
  type ChangeKind,
  type ChangeImpact,
} from '../services/changeMgmt/operationalChangeService';
import {
  saveChange,
  patchChange,
  subscribeChanges,
} from '../services/changeMgmt/operationalChangeStore';
import { logger } from '../utils/logger';

const KIND_LABELS: Record<ChangeKind, string> = {
  supervisor: 'Supervisor',
  procedure: 'Procedimiento',
  equipment: 'Equipo',
  shift: 'Turno',
  work_zone: 'Zona de trabajo',
  mandatory_epp: 'EPP obligatorio',
  applicable_norm: 'Norma aplicable',
  critical_control: 'Control crítico',
  other: 'Otro',
};

export function OperationalChanges() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [changes, setChanges] = useState<OperationalChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form state.
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<ChangeKind>('procedure');
  const [whatChanged, setWhatChanged] = useState('');
  const [previousValue, setPreviousValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [rationale, setRationale] = useState('');
  const [impact, setImpact] = useState<ChangeImpact>('medium');
  const [affectedUidsRaw, setAffectedUidsRaw] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setChanges([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeChanges(
      projectId,
      (list) => {
        setChanges(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('changes_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const resetForm = () => {
    setKind('procedure');
    setWhatChanged('');
    setPreviousValue('');
    setNewValue('');
    setRationale('');
    setImpact('medium');
    setAffectedUidsRaw('');
    setShowForm(false);
    setFeedback(null);
  };

  const handleDeclare = useCallback(async () => {
    if (!user || !selectedProject) {
      setFeedback('Necesitás un proyecto y autenticación válida.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const affectedWorkerUids = affectedUidsRaw
        .split(/[,\n\s]+/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      const change = declareChange({
        projectId: selectedProject.id,
        kind,
        whatChanged,
        previousValue,
        newValue,
        rationale,
        impact,
        affectedWorkerUids,
        declaredByUid: user.uid,
        declaredByRole: 'supervisor',
        effectiveFrom: new Date().toISOString(),
      });
      await saveChange(selectedProject.id, change);
      setFeedback(`Cambio declarado (${change.id.slice(0, 12)}). ${affectedWorkerUids.length} workers deben confirmar lectura.`);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('declareChange failed', { err: msg });
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  }, [user, selectedProject, kind, whatChanged, previousValue, newValue, rationale, impact, affectedUidsRaw]);

  const handleAcknowledge = useCallback(
    async (change: OperationalChange) => {
      if (!user || !selectedProject) return;
      try {
        const updated = acknowledgeChange(change, user.uid);
        await patchChange(selectedProject.id, change.id, {
          acknowledgments: updated.acknowledgments,
        });
        setFeedback('Lectura confirmada.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [user, selectedProject],
  );

  const handleRevert = useCallback(
    async (change: OperationalChange) => {
      if (!user || !selectedProject) return;
      const reason = window.prompt('Motivo de la reversión (mín 15 chars):', '');
      if (!reason || reason.trim().length < 15) {
        setFeedback('Reversión cancelada o motivo demasiado corto (mín 15 chars).');
        return;
      }
      try {
        const reverted = revertChange(change, reason.trim());
        await patchChange(selectedProject.id, change.id, {
          revertedAt: reverted.revertedAt,
          revertedReason: reverted.revertedReason,
        });
        setFeedback('Cambio revertido.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [user, selectedProject],
  );

  const activeChanges = useMemo(
    () => changes.filter((c) => !c.revertedAt),
    [changes],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <GitCompare className="w-6 h-6 text-violet-500" /> Gestión de cambios (MOC)
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              Cada cambio operacional (supervisor, procedimiento, EPP, equipo,
              control crítico, norma aplicable) queda registrado con justificación,
              impacto y lectura confirmada por los trabajadores afectados.
              ISO 45001 §8.1.3 — Management of Change.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Declarar cambio
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto.
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

            {showForm && (
              <section className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-900/15 p-4 space-y-3">
                <h2 className="text-sm font-black text-violet-700 dark:text-violet-300 uppercase tracking-widest">
                  Nuevo cambio
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Tipo</span>
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value as ChangeKind)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      {Object.entries(KIND_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Impacto</span>
                    <select
                      value={impact}
                      onChange={(e) => setImpact(e.target.value as ChangeImpact)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      <option value="low">Bajo</option>
                      <option value="medium">Medio</option>
                      <option value="high">Alto</option>
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">Qué cambió</span>
                  <input
                    type="text"
                    value={whatChanged}
                    onChange={(e) => setWhatChanged(e.target.value)}
                    placeholder="Ej: Procedimiento de izaje en zona norte"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Antes</span>
                    <input
                      type="text"
                      value={previousValue}
                      onChange={(e) => setPreviousValue(e.target.value)}
                      placeholder="Valor previo"
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Después</span>
                    <input
                      type="text"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="Valor nuevo"
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Justificación (mín 20 chars)
                  </span>
                  <textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    rows={2}
                    placeholder="Por qué fue necesario el cambio"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    UIDs de trabajadores afectados (separados por coma o salto de línea)
                  </span>
                  <textarea
                    value={affectedUidsRaw}
                    onChange={(e) => setAffectedUidsRaw(e.target.value)}
                    rows={2}
                    placeholder="worker-001, worker-002, worker-003"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleDeclare}
                    disabled={submitting || rationale.trim().length < 20 || !whatChanged.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Declarar
                  </button>
                </div>
              </section>
            )}

            {changes.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                Sin cambios registrados.
              </div>
            ) : (
              <ul className="space-y-3">
                {changes.map((c) => {
                  const summary = summarizeAcknowledgments(c);
                  const meRequired = user && c.affectedWorkerUids.includes(user.uid);
                  const meAcked = user && c.acknowledgments.some((a) => a.workerUid === user.uid);
                  return (
                    <li key={c.id} className="space-y-2">
                      <OperationalChangeCard change={c} summary={summary} />
                      {!c.revertedAt && (
                        <div className="flex flex-wrap gap-2">
                          {meRequired && !meAcked && (
                            <button
                              type="button"
                              onClick={() => handleAcknowledge(c)}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirmo lectura
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRevert(c)}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-rose-600 hover:text-white flex items-center gap-1.5"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            Revertir
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {activeChanges.length > 0 && (
              <div className="text-[10px] text-zinc-500 text-right">
                {activeChanges.length} cambios activos · {changes.length - activeChanges.length} revertidos
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default OperationalChanges;
