// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §MOC ISO 45001 §8.1.3.
//
// Renderiza los botones de transición de status de una OperationalChange
// según su estado actual + el rol del user logged-in. Decoupled del
// container page para que sea testeable y reutilizable.
//
// Estado → botones visibles:
//   draft           → "Enviar a revisión"  (creador)
//   pending_review  → "Aprobar" / "Rechazar"  (HSE / supervisor / gerente / admin)
//   approved        → "Activar" (si effectiveFrom <= now)  (supervisor / gerente / admin)
//   in_effect       → "Verificar efectividad"  (HSE) +
//                     "Confirmo lectura" (worker afectado sin ack) +
//                     "Revertir" (cualquier approver)
//   verified        → "Revertir"  (cualquier approver)
//   rejected | reverted → (terminal, sin acciones)

import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  XCircle,
  Send,
  Play,
  ClipboardCheck,
  Undo2,
} from 'lucide-react';
import type {
  ApproverRole,
  OperationalChange,
} from '../../services/changeMgmt/operationalChangeService';

export interface ChangeWorkflowActionsProps {
  change: OperationalChange;
  userUid: string;
  userRole: ApproverRole | 'operador';
  /** Si el user ya hizo ack en este change (worker pov). */
  hasAcked: boolean;
  onSubmitForReview: (change: OperationalChange) => void;
  onApprove: (change: OperationalChange) => void;
  onReject: (change: OperationalChange) => void;
  onActivate: (change: OperationalChange) => void;
  onVerify: (change: OperationalChange) => void;
  onAcknowledge: (change: OperationalChange) => void;
  onRevert: (change: OperationalChange) => void;
}

const APPROVER_ROLES: readonly ApproverRole[] = [
  'prevencionista',
  'supervisor',
  'gerente',
  'admin',
];

function isApprover(role: string): role is ApproverRole {
  return (APPROVER_ROLES as readonly string[]).includes(role);
}

export function ChangeWorkflowActions(props: ChangeWorkflowActionsProps) {
  const { t } = useTranslation();
  const { change, userUid, userRole, hasAcked } = props;
  const status = change.status ?? 'in_effect';

  // Status badge — siempre visible, no es una acción pero contextualiza.
  const STATUS_LABELS: Record<NonNullable<OperationalChange['status']>, { label: string; cls: string }> = {
    draft: {
      label: t('operational_changes.status.draft', 'Borrador'),
      cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
    },
    pending_review: {
      label: t('operational_changes.status.pending_review', 'En revisión'),
      cls: 'bg-amber-200 text-amber-800 dark:bg-amber-700/40 dark:text-amber-200',
    },
    approved: {
      label: t('operational_changes.status.approved', 'Aprobado'),
      cls: 'bg-sky-200 text-sky-800 dark:bg-sky-700/40 dark:text-sky-200',
    },
    rejected: {
      label: t('operational_changes.status.rejected', 'Rechazado'),
      cls: 'bg-rose-200 text-rose-800 dark:bg-rose-700/40 dark:text-rose-200',
    },
    in_effect: {
      label: t('operational_changes.status.in_effect', 'En vigor'),
      cls: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-700/40 dark:text-emerald-200',
    },
    verified: {
      label: t('operational_changes.status.verified', 'Verificado'),
      cls: 'bg-violet-200 text-violet-800 dark:bg-violet-700/40 dark:text-violet-200',
    },
    reverted: {
      label: t('operational_changes.status.reverted', 'Revertido'),
      cls: 'bg-zinc-300 text-zinc-700 dark:bg-zinc-600 dark:text-zinc-300',
    },
  };
  const statusInfo = STATUS_LABELS[status];

  // ─── Action gates ────────────────────────────────────────────────────────
  const isCreator = change.declaredByUid === userUid;
  const isWorkerAffected = change.affectedWorkerUids.includes(userUid);
  const userIsApprover = isApprover(userRole);

  const canSubmit = status === 'draft' && (isCreator || userIsApprover);

  // Approval: pending_review + user es approver + no aprobó ya en este change
  const alreadyDecided = (change.approvals ?? []).some((a) => a.approverUid === userUid);
  const canApprove = status === 'pending_review' && userIsApprover && !alreadyDecided;

  // Activate: approved + effectiveFrom <= now + user puede operar (sup/ger/admin)
  const canActivate =
    status === 'approved' &&
    new Date(change.effectiveFrom).getTime() <= Date.now() &&
    (userRole === 'supervisor' || userRole === 'gerente' || userRole === 'admin');

  // Verify: in_effect + user is HSE
  const canVerify = status === 'in_effect' && (userRole === 'prevencionista' || userRole === 'admin');

  // Acknowledge: in_effect or verified + worker afectado + sin ack
  const canAck =
    (status === 'in_effect' || status === 'verified') &&
    isWorkerAffected &&
    !hasAcked;

  // Revert: cualquier estado live (in_effect, verified, approved) + user approver
  const canRevert =
    (status === 'in_effect' || status === 'verified' || status === 'approved') &&
    userIsApprover;

  const noActions = !canSubmit && !canApprove && !canActivate && !canVerify && !canAck && !canRevert;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${statusInfo.cls}`}
        >
          {statusInfo.label}
        </span>
        {(change.approvals?.length ?? 0) > 0 && (
          <span className="text-[10px] text-zinc-500">
            {t('operational_changes.approvals_count', {
              defaultValue: '{{n}} decisiones',
              n: change.approvals?.length ?? 0,
            })}
          </span>
        )}
        {change.verification && (
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
              change.verification.effective
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
            }`}
          >
            {change.verification.effective
              ? t('operational_changes.verification.effective', 'Efectivo')
              : t('operational_changes.verification.corrective_action', 'Requiere acción correctiva')}
          </span>
        )}
      </div>
      {!noActions && (
        <div className="flex flex-wrap gap-2">
          {canSubmit && (
            <button
              type="button"
              onClick={() => props.onSubmitForReview(change)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {t('operational_changes.action.submit_review', 'Enviar a revisión')}
            </button>
          )}
          {canApprove && (
            <>
              <button
                type="button"
                onClick={() => props.onApprove(change)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t('operational_changes.action.approve', 'Aprobar')}
              </button>
              <button
                type="button"
                onClick={() => props.onReject(change)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5"
              >
                <XCircle className="w-3.5 h-3.5" />
                {t('operational_changes.action.reject', 'Rechazar')}
              </button>
            </>
          )}
          {canActivate && (
            <button
              type="button"
              onClick={() => props.onActivate(change)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-violet-600 hover:bg-violet-500 text-white flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              {t('operational_changes.action.activate', 'Activar')}
            </button>
          )}
          {canVerify && (
            <button
              type="button"
              onClick={() => props.onVerify(change)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1.5"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              {t('operational_changes.action.verify', 'Verificar efectividad')}
            </button>
          )}
          {canAck && (
            <button
              type="button"
              onClick={() => props.onAcknowledge(change)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('operational_changes.action.acknowledge', 'Confirmo lectura')}
            </button>
          )}
          {canRevert && (
            <button
              type="button"
              onClick={() => props.onRevert(change)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-300 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-rose-600 hover:text-white flex items-center gap-1.5"
            >
              <Undo2 className="w-3.5 h-3.5" />
              {t('operational_changes.action.revert', 'Revertir')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ChangeWorkflowActions;
