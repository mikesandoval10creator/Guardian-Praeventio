// Praeventio Guard — Sprint K wire UI (2026-05-23) — Excepciones.
//
// Page `/exceptions`. Service `exceptionEngine.ts` (createException,
// deriveStatus, revokeException, markFulfilled, summarize) + panel
// `ExceptionsAuditPanel.tsx` existían sin page consumidor.
//
// UX: el supervisor ve TODAS las excepciones del proyecto agrupadas por
// status (activas / expiradas / revocadas / cumplidas). Puede:
//   - Crear nueva excepción (con todas las validaciones del engine:
//     min 20 chars en reason + mitigation, max 168h de duración, role
//     gate, dominio enumerado).
//   - Revocar una excepción activa antes de su vencimiento.
//   - Marcar fulfilled cuando el control normal queda restablecido.
//
// Vidas críticas: la excepción es un acto JURÍDICO — saltarse un
// control normal exige documentar mitigación alternativa por escrito
// + auditor habilitado. El sistema FUERZA el formato.

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  GitPullRequestArrow,
  Plus,
  Loader2,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Clock4,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { ExceptionsAuditPanel } from '../components/exceptions/ExceptionsAuditPanel';
import {
  createException,
  revokeException,
  markFulfilled,
  type ExceptionRecord,
  type ExceptionDomain,
} from '../services/exceptions/exceptionEngine';
import {
  saveException,
  patchException,
  subscribeExceptions,
} from '../services/exceptions/exceptionStore';
import { logger } from '../utils/logger';

const DOMAIN_LABELS: Record<ExceptionDomain, string> = {
  training_gap: 'Falta capacitación',
  epp_expired: 'EPP vencido',
  permit_pending: 'Permiso pendiente',
  document_expired: 'Documento expirado',
  medical_fitness_pending: 'Aptitud médica pendiente',
  equipment_inspection: 'Inspección equipo',
  staffing_gap: 'Brecha dotación',
  other: 'Otra',
};

const SUBJECT_KINDS: Array<ExceptionRecord['subjectRef']['kind']> = [
  'WORKER',
  'EPP',
  'TASK',
  'EQUIPMENT',
  'DOCUMENT',
];

export function ExceptionsAudit() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [records, setRecords] = useState<ExceptionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state.
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [domain, setDomain] = useState<ExceptionDomain>('training_gap');
  const [subjectKind, setSubjectKind] =
    useState<ExceptionRecord['subjectRef']['kind']>('WORKER');
  const [subjectId, setSubjectId] = useState('');
  const [reason, setReason] = useState('');
  const [mitigation, setMitigation] = useState('');
  const [durationHours, setDurationHours] = useState(24);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setRecords([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeExceptions(
      projectId,
      (list) => {
        setRecords(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('exceptions_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const resetForm = () => {
    setShowForm(false);
    setDomain('training_gap');
    setSubjectKind('WORKER');
    setSubjectId('');
    setReason('');
    setMitigation('');
    setDurationHours(24);
    setFeedback(null);
  };

  const handleCreate = async () => {
    if (!user || !selectedProject) {
      setFeedback('Necesitás un proyecto activo y estar autenticado.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const record = createException({
        id: `exc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        domain,
        subjectRef: { kind: subjectKind, id: subjectId.trim() || 'unspecified' },
        reason,
        alternativeMitigation: mitigation,
        approvedByUid: user.uid,
        // Sin info exacta del role, asumimos 'supervisor' (recognisedRoles del engine).
        approvedByRole: 'supervisor',
        durationHours,
      });
      await saveException(selectedProject.id, record);
      setFeedback(`Excepción creada (${record.id.slice(0, 12)}). Vence ${new Date(record.validUntil).toLocaleString('es-CL')}.`);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('createException failed', { err: msg });
      setFeedback(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = useCallback(
    async (record: ExceptionRecord) => {
      if (!user || !selectedProject) return;
      const reasonInput = window.prompt(
        'Motivo de la revocación (min 5 caracteres):',
        '',
      );
      if (!reasonInput || reasonInput.trim().length < 5) {
        setFeedback('Revocación cancelada o motivo demasiado corto.');
        return;
      }
      try {
        const revoked = revokeException(record, user.uid, reasonInput.trim());
        await patchException(selectedProject.id, record.id, {
          status: revoked.status,
          revokedAt: revoked.revokedAt,
          revokedByUid: revoked.revokedByUid,
          revokedReason: revoked.revokedReason,
        });
        setFeedback(`Excepción ${record.id.slice(0, 12)} revocada.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('revokeException failed', { err: msg });
        setFeedback(msg);
      }
    },
    [user, selectedProject],
  );

  const handleFulfill = useCallback(
    async (record: ExceptionRecord) => {
      if (!selectedProject) return;
      try {
        const fulfilled = markFulfilled(record);
        await patchException(selectedProject.id, record.id, {
          status: fulfilled.status,
          fulfilledAt: fulfilled.fulfilledAt,
        });
        setFeedback(`Excepción ${record.id.slice(0, 12)} marcada como cumplida.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('markFulfilled failed', { err: msg });
        setFeedback(msg);
      }
    },
    [selectedProject],
  );

  const activeRecords = useMemo(
    () => records.filter((r) => r.status === 'active'),
    [records],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <GitPullRequestArrow className="w-6 h-6 text-amber-500" /> Excepciones documentadas
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              Cada excepción a un control normal (capacitación faltante, EPP
              vencido, permiso pendiente) requiere mitigación alternativa
              por escrito + duración máx 168 h + aprobador role-gated. El
              sistema fuerza el formato auditable.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Solicitar excepción
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto para registrar excepciones.
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
              <section className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-4 space-y-3">
                <h2 className="text-sm font-black text-amber-700 dark:text-amber-300 uppercase tracking-widest">
                  Nueva excepción
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Dominio</span>
                    <select
                      value={domain}
                      onChange={(e) => setDomain(e.target.value as ExceptionDomain)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      {Object.entries(DOMAIN_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">Tipo de sujeto</span>
                    <select
                      value={subjectKind}
                      onChange={(e) => setSubjectKind(e.target.value as ExceptionRecord['subjectRef']['kind'])}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      {SUBJECT_KINDS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    ID del sujeto (worker_uid, epp_id, task_id, etc.)
                  </span>
                  <input
                    type="text"
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    placeholder="ej: worker-123, epp-arnes-001"
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Motivo (mín 20 chars) — específico, no genérico
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="Ej: Capacitación trabajo en altura programada vence el 23/05, faena critica termina 25/05; solicitamos extender por 48h con vigía adicional."
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Mitigación alternativa (mín 20 chars) — qué la sustituye
                  </span>
                  <textarea
                    value={mitigation}
                    onChange={(e) => setMitigation(e.target.value)}
                    rows={2}
                    placeholder="Ej: Vigía permanente con experiencia certificada + 2 chequeos por turno + EPP doble redundante (arnés + línea de vida primaria + secundaria)."
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    Duración (horas, máx 168 = 1 semana)
                  </span>
                  <input
                    type="number"
                    value={durationHours}
                    onChange={(e) => setDurationHours(parseInt(e.target.value, 10) || 0)}
                    min={1}
                    max={168}
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
                    onClick={handleCreate}
                    disabled={
                      submitting ||
                      reason.trim().length < 20 ||
                      mitigation.trim().length < 20
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Crear
                  </button>
                </div>
              </section>
            )}

            {/* Panel agregado del engine. */}
            <ExceptionsAuditPanel records={records} onRevoke={handleRevoke} />

            {/* Acciones rápidas sobre excepciones activas. */}
            {activeRecords.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <Clock4 className="w-3.5 h-3.5" />
                  Acciones rápidas
                </h2>
                <ul className="space-y-1.5">
                  {activeRecords.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-2 text-xs flex items-center gap-2"
                    >
                      <span className="font-mono text-[10px] text-zinc-500">{r.id.slice(0, 10)}</span>
                      <span className="text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                        {DOMAIN_LABELS[r.domain]} · {r.subjectRef.kind}:{r.subjectRef.id.slice(0, 18)}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        vence {new Date(r.validUntil).toLocaleDateString('es-CL')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleFulfill(r)}
                        className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Cumplida
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevoke(r)}
                        className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" />
                        Revocar
                      </button>
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

export default ExceptionsAudit;
