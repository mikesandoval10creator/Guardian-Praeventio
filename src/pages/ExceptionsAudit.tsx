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
import { useTranslation } from 'react-i18next';
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
  subscribeActiveExceptions,
} from '../services/exceptions/exceptionStore';
import { logger } from '../utils/logger';

const SUBJECT_KINDS: Array<ExceptionRecord['subjectRef']['kind']> = [
  'WORKER',
  'EPP',
  'TASK',
  'EQUIPMENT',
  'DOCUMENT',
];

// Plan 2026-05-24 §Fase B.6 batch2 — i18n sweep.
export function ExceptionsAudit() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const DOMAIN_LABELS: Record<ExceptionDomain, string> = {
    training_gap: t('exceptions_page.domain.training_gap', 'Falta capacitación'),
    epp_expired: t('exceptions_page.domain.epp_expired', 'EPP vencido'),
    permit_pending: t('exceptions_page.domain.permit_pending', 'Permiso pendiente'),
    document_expired: t('exceptions_page.domain.document_expired', 'Documento expirado'),
    medical_fitness_pending: t('exceptions_page.domain.medical_fitness_pending', 'Aptitud médica pendiente'),
    equipment_inspection: t('exceptions_page.domain.equipment_inspection', 'Inspección equipo'),
    staffing_gap: t('exceptions_page.domain.staffing_gap', 'Brecha dotación'),
    other: t('exceptions_page.domain.other', 'Otra'),
  };

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
    // Plan §B.5 (2026-05-23): subscribeActiveExceptions aplica
    // where('status', '==', 'active') server-side. Antes el page filtraba
    // client-side (records.filter status === 'active'). Para proyectos
    // con muchas excepciones revoked/fulfilled históricas, esto reduce
    // reads ~80% — solo bajan las activas que importan al supervisor.
    const unsub = subscribeActiveExceptions(
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
      setFeedback(t('exceptions_page.feedback.need_project', 'Necesitás un proyecto activo y estar autenticado.'));
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
      setFeedback(
        t('exceptions_page.feedback.created', {
          defaultValue: 'Excepción creada ({{id}}). Vence {{date}}.',
          id: record.id.slice(0, 12),
          date: new Date(record.validUntil).toLocaleString('es-CL'),
        }),
      );
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
        t('exceptions_page.revoke.prompt', 'Motivo de la revocación (min 5 caracteres):'),
        '',
      );
      if (!reasonInput || reasonInput.trim().length < 5) {
        setFeedback(t('exceptions_page.feedback.revoke_cancelled', 'Revocación cancelada o motivo demasiado corto.'));
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
        setFeedback(
          t('exceptions_page.feedback.revoked', {
            defaultValue: 'Excepción {{id}} revocada.',
            id: record.id.slice(0, 12),
          }),
        );
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
        setFeedback(
          t('exceptions_page.feedback.fulfilled', {
            defaultValue: 'Excepción {{id}} marcada como cumplida.',
            id: record.id.slice(0, 12),
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('markFulfilled failed', { err: msg });
        setFeedback(msg);
      }
    },
    [selectedProject],
  );

  // Server-side filter ya excluye revoked/fulfilled — `records` solo
  // contiene status='active'. Filtro defensivo client-side por safety.
  const activeRecords = records;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary-token tracking-tight flex items-center gap-2">
              <GitPullRequestArrow className="w-6 h-6 text-amber-500" /> {t('exceptions_page.title', 'Excepciones documentadas')}
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              {t(
                'exceptions_page.subtitle',
                'Cada excepción a un control normal (capacitación faltante, EPP vencido, permiso pendiente) requiere mitigación alternativa por escrito + duración máx 168 h + aprobador role-gated. El sistema fuerza el formato auditable.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('exceptions_page.cta_request', 'Solicitar excepción')}
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-default-token bg-elevated p-6 text-center text-sm text-zinc-500">
            {t('exceptions_page.empty.select_project', 'Seleccioná un proyecto para registrar excepciones.')}
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
                  {t('exceptions_page.form.heading', 'Nueva excepción')}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-secondary-token">{t('exceptions_page.form.field_domain', 'Dominio')}</span>
                    <select
                      value={domain}
                      onChange={(e) => setDomain(e.target.value as ExceptionDomain)}
                      className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                    >
                      {Object.entries(DOMAIN_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-secondary-token">{t('exceptions_page.form.field_subject_kind', 'Tipo de sujeto')}</span>
                    <select
                      value={subjectKind}
                      onChange={(e) => setSubjectKind(e.target.value as ExceptionRecord['subjectRef']['kind'])}
                      className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                    >
                      {SUBJECT_KINDS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('exceptions_page.form.field_subject_id', 'ID del sujeto (worker_uid, epp_id, task_id, etc.)')}
                  </span>
                  <input
                    type="text"
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    placeholder={t('exceptions_page.form.subject_id_placeholder', 'ej: worker-123, epp-arnes-001')}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('exceptions_page.form.field_reason', 'Motivo (mín 20 chars) — específico, no genérico')}
                  </span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder={t(
                      'exceptions_page.form.reason_placeholder',
                      'Ej: Capacitación trabajo en altura programada vence el 23/05, faena critica termina 25/05; solicitamos extender por 48h con vigía adicional.',
                    )}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('exceptions_page.form.field_mitigation', 'Mitigación alternativa (mín 20 chars) — qué la sustituye')}
                  </span>
                  <textarea
                    value={mitigation}
                    onChange={(e) => setMitigation(e.target.value)}
                    rows={2}
                    placeholder={t(
                      'exceptions_page.form.mitigation_placeholder',
                      'Ej: Vigía permanente con experiencia certificada + 2 chequeos por turno + EPP doble redundante (arnés + línea de vida primaria + secundaria).',
                    )}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-secondary-token">
                    {t('exceptions_page.form.field_duration', 'Duración (horas, máx 168 = 1 semana)')}
                  </span>
                  <input
                    type="number"
                    value={durationHours}
                    onChange={(e) => setDurationHours(parseInt(e.target.value, 10) || 0)}
                    min={1}
                    max={168}
                    className="w-full rounded-lg border border-default-token bg-surface px-2 py-1.5 text-primary-token"
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-secondary-token hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    {t('common.cancel', 'Cancelar')}
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
                    {t('exceptions_page.form.submit', 'Crear')}
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
                  {t('exceptions_page.quick_actions.heading', 'Acciones rápidas')}
                </h2>
                <ul className="space-y-1.5">
                  {activeRecords.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-lg border border-default-token bg-elevated p-2 text-xs flex items-center gap-2"
                    >
                      <span className="font-mono text-[10px] text-zinc-500">{r.id.slice(0, 10)}</span>
                      <span className="text-secondary-token flex-1 truncate">
                        {DOMAIN_LABELS[r.domain]} · {r.subjectRef.kind}:{r.subjectRef.id.slice(0, 18)}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {t('exceptions_page.quick_actions.expires', {
                          defaultValue: 'vence {{date}}',
                          date: new Date(r.validUntil).toLocaleDateString('es-CL'),
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleFulfill(r)}
                        className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {t('exceptions_page.quick_actions.fulfill', 'Cumplida')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevoke(r)}
                        className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" />
                        {t('exceptions_page.quick_actions.revoke', 'Revocar')}
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
