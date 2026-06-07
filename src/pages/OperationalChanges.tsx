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
import { useTranslation } from 'react-i18next';
import {
  GitCompare,
  Plus,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { OperationalChangeCard } from '../components/changeMgmt/OperationalChangeCard';
import { ChangeWorkflowActions } from '../components/changeMgmt/ChangeWorkflowActions';
import { ReasonModal } from '../components/changeMgmt/ReasonModal';
import {
  summarizeAcknowledgments,
  type OperationalChange,
  type ChangeKind,
  type ChangeImpact,
  type ApproverRole,
} from '../services/changeMgmt/operationalChangeService';
// B13 — reads stay on the live subscription; writes go through the AUDITED
// server endpoints (operationalChangeApi), never the client store.
import { subscribeChanges } from '../services/changeMgmt/operationalChangeStore';
import {
  declareChangeApi,
  acknowledgeChangeApi,
  submitChangeApi,
  decideChangeApi,
  activateChangeApi,
  verifyChangeApi,
  revertChangeApi,
} from '../services/changeMgmt/operationalChangeApi';
import { logger } from '../utils/logger';

// Modal action types — qué pantalla del modal mostrar.
type ModalAction =
  | { kind: 'approve'; change: OperationalChange }
  | { kind: 'reject'; change: OperationalChange }
  | { kind: 'revert'; change: OperationalChange }
  | { kind: 'verify'; change: OperationalChange };

// Plan 2026-05-24 §Fase B.6 batch3 — i18n sweep OperationalChanges (MOC).
export function OperationalChanges() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const KIND_LABELS: Record<ChangeKind, string> = {
    supervisor: t('operational_changes.kind.supervisor', 'Supervisor'),
    procedure: t('operational_changes.kind.procedure', 'Procedimiento'),
    equipment: t('operational_changes.kind.equipment', 'Equipo'),
    shift: t('operational_changes.kind.shift', 'Turno'),
    work_zone: t('operational_changes.kind.work_zone', 'Zona de trabajo'),
    mandatory_epp: t('operational_changes.kind.mandatory_epp', 'EPP obligatorio'),
    applicable_norm: t('operational_changes.kind.applicable_norm', 'Norma aplicable'),
    critical_control: t('operational_changes.kind.critical_control', 'Control crítico'),
    other: t('operational_changes.kind.other', 'Otro'),
  };

  const [changes, setChanges] = useState<OperationalChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [modalAction, setModalAction] = useState<ModalAction | null>(null);

  // Plan 2026-05-24 §MOC — Role del user para gates del workflow.
  // En producción se deriva de la membership del proyecto (roles
  // multi-tenant). Acá usamos un fallback simple: si el user es el
  // declaredByUid del change, es supervisor; sino, operador. Esto se
  // puede mejorar wireando useProjectMembership() cuando esté disponible.
  // Para HSE (prevencionista), el role viene del custom claim Firebase
  // si está disponible — checkeamos display name fallback como heurística
  // pragmática (no es prod-ready pero permite testing UX manual).
  const userRole: ApproverRole | 'operador' = useMemo(() => {
    if (!user) return 'operador';
    // Heurística temporal: en prod esto vendría de useProjectMembership()
    // o de un Firebase custom claim. El service hace el role-gate real.
    const claim = (user as unknown as { customClaims?: { role?: string } }).customClaims?.role;
    if (claim === 'prevencionista') return 'prevencionista';
    if (claim === 'supervisor') return 'supervisor';
    if (claim === 'gerente') return 'gerente';
    if (claim === 'admin') return 'admin';
    return 'operador';
  }, [user]);

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
      setFeedback(t('operational_changes.feedback.need_project', 'Necesitás un proyecto y autenticación válida.'));
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const affectedWorkerUids = affectedUidsRaw
        .split(/[,\n\s]+/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      const { change } = await declareChangeApi(selectedProject.id, {
        kind,
        whatChanged,
        previousValue,
        newValue,
        rationale,
        impact,
        affectedWorkerUids,
        declaredByRole: 'supervisor',
        effectiveFrom: new Date().toISOString(),
      });
      setFeedback(
        t('operational_changes.feedback.declared', {
          defaultValue: 'Cambio declarado ({{id}}). {{n}} workers deben confirmar lectura.',
          id: change.id.slice(0, 12),
          n: affectedWorkerUids.length,
        }),
      );
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
        await acknowledgeChangeApi(selectedProject.id, change.id);
        setFeedback(t('operational_changes.feedback.ack_ok', 'Lectura confirmada.'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [user, selectedProject],
  );

  // Plan 2026-05-24 §MOC + deuda P1 — los flujos de approve/reject/revert/
  // verify abren un modal validado en lugar de window.prompt(). El modal
  // captura razón con counter; al confirmar se ejecuta la transición
  // correspondiente.
  const handleModalConfirm = useCallback(
    async (reason: string, extra?: { effective: boolean }) => {
      if (!user || !selectedProject || !modalAction) return;
      const { change } = modalAction;
      try {
        if (modalAction.kind === 'approve') {
          await decideChangeApi(selectedProject.id, change.id, { decision: 'approved', comment: reason });
        } else if (modalAction.kind === 'reject') {
          await decideChangeApi(selectedProject.id, change.id, { decision: 'rejected', comment: reason });
        } else if (modalAction.kind === 'revert') {
          await revertChangeApi(selectedProject.id, change.id, { reason });
        } else if (modalAction.kind === 'verify') {
          await verifyChangeApi(selectedProject.id, change.id, {
            effective: extra?.effective ?? true,
            observations: reason,
          });
        }
        setFeedback(
          t(`operational_changes.feedback.action_ok.${modalAction.kind}`, {
            defaultValue: 'Acción registrada.',
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('moc modal action failed', { kind: modalAction.kind, err: msg });
        setFeedback(msg);
      } finally {
        setModalAction(null);
      }
    },
    [user, selectedProject, modalAction, t],
  );

  const handleSubmitForReview = useCallback(
    async (change: OperationalChange) => {
      if (!user || !selectedProject) return;
      try {
        await submitChangeApi(selectedProject.id, change.id);
        setFeedback(t('operational_changes.feedback.submitted', 'Cambio enviado a revisión.'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [user, selectedProject, t],
  );

  const handleActivate = useCallback(
    async (change: OperationalChange) => {
      if (!user || !selectedProject) return;
      try {
        await activateChangeApi(selectedProject.id, change.id);
        setFeedback(t('operational_changes.feedback.activated', 'Cambio activado — en vigor.'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFeedback(msg);
      }
    },
    [user, selectedProject, t],
  );

  // Plan 2026-05-24 §MOC — "activos" = no revertidos NI rechazados.
  // Pre-MOC: solo se chequeaba !revertedAt. Ahora también excluimos
  // 'rejected' que es el otro estado terminal del workflow.
  const activeChanges = useMemo(
    () => changes.filter((c) => !c.revertedAt && c.status !== 'rejected'),
    [changes],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <GitCompare className="w-6 h-6 text-violet-500" /> {t('operational_changes.title', 'Gestión de cambios (MOC)')}
            </h1>
            <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
              {t(
                'operational_changes.subtitle',
                'Cada cambio operacional (supervisor, procedimiento, EPP, equipo, control crítico, norma aplicable) queda registrado con justificación, impacto y lectura confirmada por los trabajadores afectados. ISO 45001 §8.1.3 — Management of Change.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            disabled={!selectedProject || !user}
            className="rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('operational_changes.cta_declare', 'Declarar cambio')}
          </button>
        </header>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            {t('operational_changes.empty.select_project', 'Seleccioná un proyecto.')}
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
                  {t('operational_changes.form.heading', 'Nuevo cambio')}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('operational_changes.form.field_kind', 'Tipo')}</span>
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
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('operational_changes.form.field_impact', 'Impacto')}</span>
                    <select
                      value={impact}
                      onChange={(e) => setImpact(e.target.value as ChangeImpact)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    >
                      <option value="low">{t('operational_changes.impact.low', 'Bajo')}</option>
                      <option value="medium">{t('operational_changes.impact.medium', 'Medio')}</option>
                      <option value="high">{t('operational_changes.impact.high', 'Alto')}</option>
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('operational_changes.form.field_what_changed', 'Qué cambió')}</span>
                  <input
                    type="text"
                    value={whatChanged}
                    onChange={(e) => setWhatChanged(e.target.value)}
                    placeholder={t('operational_changes.form.what_changed_placeholder', 'Ej: Procedimiento de izaje en zona norte')}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('operational_changes.form.field_before', 'Antes')}</span>
                    <input
                      type="text"
                      value={previousValue}
                      onChange={(e) => setPreviousValue(e.target.value)}
                      placeholder={t('operational_changes.form.before_placeholder', 'Valor previo')}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">{t('operational_changes.form.field_after', 'Después')}</span>
                    <input
                      type="text"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder={t('operational_changes.form.after_placeholder', 'Valor nuevo')}
                      className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    {t('operational_changes.form.field_rationale', 'Justificación (mín 20 chars)')}
                  </span>
                  <textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    rows={2}
                    placeholder={t('operational_changes.form.rationale_placeholder', 'Por qué fue necesario el cambio')}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">
                    {t('operational_changes.form.field_affected_uids', 'UIDs de trabajadores afectados (separados por coma o salto de línea)')}
                  </span>
                  <textarea
                    value={affectedUidsRaw}
                    onChange={(e) => setAffectedUidsRaw(e.target.value)}
                    rows={2}
                    placeholder={t('operational_changes.form.affected_uids_placeholder', 'worker-001, worker-002, worker-003')}
                    className="w-full rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-zinc-900 dark:text-white"
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
                  >
                    {t('common.cancel', 'Cancelar')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeclare}
                    disabled={submitting || rationale.trim().length < 20 || !whatChanged.trim()}
                    className="px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white flex items-center gap-2"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {t('operational_changes.form.submit', 'Declarar')}
                  </button>
                </div>
              </section>
            )}

            {changes.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
                {t('operational_changes.empty.no_changes', 'Sin cambios registrados.')}
              </div>
            ) : (
              <ul className="space-y-3">
                {changes.map((c) => {
                  const summary = summarizeAcknowledgments(c);
                  const hasAcked = !!user && c.acknowledgments.some((a) => a.workerUid === user.uid);
                  return (
                    <li key={c.id} className="space-y-2">
                      <OperationalChangeCard change={c} summary={summary} />
                      {user && (
                        <ChangeWorkflowActions
                          change={c}
                          userUid={user.uid}
                          userRole={userRole}
                          hasAcked={hasAcked}
                          onSubmitForReview={handleSubmitForReview}
                          onApprove={(ch) => setModalAction({ kind: 'approve', change: ch })}
                          onReject={(ch) => setModalAction({ kind: 'reject', change: ch })}
                          onActivate={handleActivate}
                          onVerify={(ch) => setModalAction({ kind: 'verify', change: ch })}
                          onAcknowledge={handleAcknowledge}
                          onRevert={(ch) => setModalAction({ kind: 'revert', change: ch })}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {activeChanges.length > 0 && (
              <div className="text-[10px] text-zinc-500 text-right">
                {t('operational_changes.footer.summary', {
                  defaultValue: '{{active}} cambios activos · {{reverted}} revertidos',
                  active: activeChanges.length,
                  reverted: changes.length - activeChanges.length,
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Plan 2026-05-24 §MOC — Modal de razón para approve/reject/revert/verify */}
      {modalAction && (
        <ReasonModal
          open={true}
          title={
            modalAction.kind === 'approve'
              ? t('operational_changes.modal.approve_title', 'Aprobar cambio')
              : modalAction.kind === 'reject'
                ? t('operational_changes.modal.reject_title', 'Rechazar cambio')
                : modalAction.kind === 'revert'
                  ? t('operational_changes.modal.revert_title', 'Revertir cambio')
                  : t('operational_changes.modal.verify_title', 'Verificar efectividad')
          }
          description={
            modalAction.kind === 'approve'
              ? t('operational_changes.modal.approve_desc', 'Comentario auditable: controles compensatorios, condiciones de aprobación, etc.')
              : modalAction.kind === 'reject'
                ? t('operational_changes.modal.reject_desc', 'Razón del rechazo. El cambio queda en estado terminal — para re-someter, hay que crear uno nuevo.')
                : modalAction.kind === 'revert'
                  ? t('operational_changes.modal.revert_desc', 'Motivo de la reversión — quedará registrado en el audit log (DS 76 + ISO 45001 §8.1.3).')
                  : t('operational_changes.modal.verify_desc', 'Observaciones post-implementación: ¿el cambio logró su objetivo? Si no, se registra como acción correctiva pendiente.')
          }
          minLength={modalAction.kind === 'verify' ? 30 : 15}
          confirmLabel={
            modalAction.kind === 'approve'
              ? t('common.approve', 'Aprobar')
              : modalAction.kind === 'reject'
                ? t('common.reject', 'Rechazar')
                : modalAction.kind === 'revert'
                  ? t('common.revert', 'Revertir')
                  : t('common.verify', 'Verificar')
          }
          confirmColor={
            modalAction.kind === 'approve'
              ? 'bg-emerald-600 hover:bg-emerald-500'
              : modalAction.kind === 'reject' || modalAction.kind === 'revert'
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-amber-600 hover:bg-amber-500'
          }
          showEffectiveField={modalAction.kind === 'verify'}
          onConfirm={handleModalConfirm}
          onCancel={() => setModalAction(null)}
        />
      )}
    </div>
  );
}

export default OperationalChanges;
