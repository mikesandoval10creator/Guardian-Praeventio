// Praeventio Guard — Wire UI #67: <WorkPermitCard />
//
// Renderiza un permiso de trabajo con estado actual, vigencia,
// pre-condiciones, checklist y acción de cancelar/cumplir.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileSignature, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import {
  deriveStatus,
  type WorkPermit,
  type WorkPermitStatus,
} from '../../services/workPermits/workPermitEngine.js';

interface WorkPermitCardProps {
  permit: WorkPermit;
  now?: Date;
  onCancel?: (permit: WorkPermit) => void;
  onFulfill?: (permit: WorkPermit) => void;
}

const STATUS_TONE: Record<WorkPermitStatus, { color: string; badge: string }> = {
  draft: { color: 'text-slate-500', badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
  pending_approval: {
    color: 'text-amber-500',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  active: {
    color: 'text-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  expired: {
    color: 'text-rose-500',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
  cancelled: {
    color: 'text-slate-500',
    badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  },
  fulfilled: {
    color: 'text-teal-500',
    badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  },
};

export function WorkPermitCard({ permit, now, onCancel, onFulfill }: WorkPermitCardProps) {
  const { t } = useTranslation();
  const status = useMemo(() => deriveStatus(permit, now), [permit, now]);
  const tone = STATUS_TONE[status];

  const allPreconditions =
    permit.preconditions.workerHasTraining &&
    permit.preconditions.workerHasEpp &&
    permit.preconditions.workerMedicallyFit;

  const checklistOk = permit.preconditions.checklist.items.every((i) => i.checked);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`permit-card-${permit.id}`}
      aria-label={t('permits.aria', 'Permiso de trabajo') as string}
    >
      <header className="flex items-center gap-2">
        <FileSignature className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t(`permits.kind.${permit.kind}`, permit.kind)}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`permit-status-${permit.id}`}
        >
          {status.toUpperCase()}
        </span>
      </header>

      <p className="text-xs text-secondary-token line-clamp-2">{permit.taskDescription}</p>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token">{t('permits.worker', 'Worker')}</p>
          <p className="font-bold truncate">{permit.workerUid}</p>
        </div>
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token">{t('permits.approver', 'Aprobador')}</p>
          <p className="font-bold truncate">{permit.approverUid}</p>
        </div>
        <div className="bg-surface-elevated rounded p-1.5 col-span-2">
          <p className="uppercase text-secondary-token">{t('permits.validity', 'Vigencia')}</p>
          <p className="font-bold tabular-nums text-[11px]">
            {permit.validFrom.slice(0, 16).replace('T', ' ')} →{' '}
            {permit.validUntil.slice(0, 16).replace('T', ' ')}
          </p>
        </div>
      </div>

      <div data-testid={`permit-preconditions-${permit.id}`} className="space-y-1">
        <h3 className="text-[10px] uppercase font-bold text-secondary-token">
          {t('permits.preconditions', 'Pre-condiciones')}
        </h3>
        <ul className="space-y-0.5">
          <PreconditionRow
            ok={permit.preconditions.workerHasTraining}
            label={t('permits.training', 'Training vigente')}
            testId={`permit-pre-training-${permit.id}`}
          />
          <PreconditionRow
            ok={permit.preconditions.workerHasEpp}
            label={t('permits.epp', 'EPP entregado')}
            testId={`permit-pre-epp-${permit.id}`}
          />
          <PreconditionRow
            ok={permit.preconditions.workerMedicallyFit}
            label={t('permits.medical', 'Aptitud médica')}
            testId={`permit-pre-medical-${permit.id}`}
          />
          <PreconditionRow
            ok={checklistOk}
            label={t('permits.checklist', 'Checklist previo')}
            testId={`permit-pre-checklist-${permit.id}`}
          />
        </ul>
      </div>

      {!allPreconditions && (
        <div
          className="flex items-start gap-2 text-[11px] bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded"
          data-testid={`permit-warning-${permit.id}`}
        >
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t('permits.missingPrecondition', 'Faltan pre-condiciones: permiso no puede emitirse.')}
          </span>
        </div>
      )}

      {(onCancel || onFulfill) && status === 'active' && (
        <div className="flex gap-2">
          {onFulfill && (
            <button
              type="button"
              onClick={() => onFulfill(permit)}
              data-testid={`permit-fulfill-${permit.id}`}
              className="flex-1 px-3 py-1 rounded bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600"
            >
              {t('permits.fulfill', 'Cerrar como cumplido')}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={() => onCancel(permit)}
              data-testid={`permit-cancel-${permit.id}`}
              className="px-3 py-1 rounded bg-surface-elevated text-rose-600 text-xs font-bold"
            >
              {t('permits.cancel', 'Cancelar')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PreconditionRow({
  ok,
  label,
  testId,
}: {
  ok: boolean;
  label: string;
  testId: string;
}) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <li
      data-testid={testId}
      className={`flex items-center gap-2 text-[11px] ${
        ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
      }`}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </li>
  );
}
