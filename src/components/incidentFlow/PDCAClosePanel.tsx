// Praeventio Guard — Bloque 4.3 UI #5: <PDCAClosePanel />
//
// Admin overview de cuanto del flujo PDCA ha cerrado para un incidente:
//   - Que pasos se completaron (Plan / Do / Check / Act).
//   - % de trabajadores que completaron la capacitacion (closurePercent).
//   - Que tan profunda fue la cadena ZK creada.
//
// Cuando el closurePercent supera un umbral configurable (default 80%), el
// admin puede cerrar formalmente la investigacion — accion no visible en
// este componente (vive en `InvestigationPanel`) pero el panel muestra el
// boton de cierre cuando isClosed=false y closurePercent ≥ 80.

import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  CircleCheck,
  CircleDashed,
  GaugeCircle,
} from 'lucide-react';
import { useIncidentFlowStatus, type PdcaStatus } from '../../hooks/useIncidentFlow';
import { humanErrorMessage } from '../../lib/humanError';


interface PDCAClosePanelProps {
  projectId: string;
  incidentId: string;
  /** Closure threshold to enable the "close investigation" CTA. */
  closeThresholdPercent?: number;
  onCloseInvestigationRequested?: (status: PdcaStatus) => void;
}

interface PdcaStep {
  id: keyof PdcaStatus | 'closed';
  labelKey: string;
  labelDefault: string;
  phase: PdcaStatus['phase'];
  predicate: (s: PdcaStatus) => boolean;
}

const STEPS: PdcaStep[] = [
  {
    id: 'hasReport',
    labelKey: 'incidentFlow.pdca.step.report',
    labelDefault: 'Reporte recibido',
    phase: 'plan',
    predicate: (s) => s.hasReport,
  },
  {
    id: 'hasOpening',
    labelKey: 'incidentFlow.pdca.step.open',
    labelDefault: 'Investigacion abierta',
    phase: 'plan',
    predicate: (s) => s.hasOpening,
  },
  {
    id: 'hasRootCause',
    labelKey: 'incidentFlow.pdca.step.root',
    labelDefault: 'Causa raiz identificada',
    phase: 'do',
    predicate: (s) => s.hasRootCause,
  },
  {
    id: 'hasLesson',
    labelKey: 'incidentFlow.pdca.step.lesson',
    labelDefault: 'Leccion publicada',
    phase: 'check',
    predicate: (s) => s.hasLesson,
  },
  {
    id: 'assignedWorkerCount',
    labelKey: 'incidentFlow.pdca.step.assigned',
    labelDefault: 'Microcapacitaciones asignadas',
    phase: 'act',
    predicate: (s) => s.assignedWorkerCount > 0,
  },
  {
    id: 'completedWorkerCount',
    labelKey: 'incidentFlow.pdca.step.completed',
    labelDefault: 'Microcapacitaciones completadas',
    phase: 'act',
    predicate: (s) => s.completedWorkerCount > 0,
  },
  {
    id: 'closed',
    labelKey: 'incidentFlow.pdca.step.closed',
    labelDefault: 'Investigacion cerrada (PDCA completo)',
    phase: 'closed',
    predicate: (s) => s.isClosed,
  },
];

const PHASE_TONE: Record<PdcaStatus['phase'], string> = {
  idle: 'text-secondary-token',
  plan: 'text-teal-700 dark:text-teal-300',
  do: 'text-sky-700 dark:text-sky-300',
  check: 'text-amber-700 dark:text-amber-300',
  act: 'text-fuchsia-700 dark:text-fuchsia-300',
  closed: 'text-emerald-700 dark:text-emerald-300',
};

export function PDCAClosePanel({
  projectId,
  incidentId,
  closeThresholdPercent = 80,
  onCloseInvestigationRequested,
}: PDCAClosePanelProps) {
  const { t } = useTranslation();
  const { data, loading, error } = useIncidentFlowStatus(projectId, incidentId);

  if (loading) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
        data-testid="pdca-panel-loading"
      >
        <p className="text-xs text-secondary-token">
          {t('incidentFlow.pdca.loading', 'Cargando estado PDCA...')}
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="rounded-2xl border border-rose-500/30 bg-surface p-4 shadow-mode"
        data-testid="pdca-panel-error"
        role="alert"
      >
        <p className="text-xs text-rose-700 dark:text-rose-300">
          {humanErrorMessage(error.message)}
        </p>
      </section>
    );
  }

  if (!data) return null;
  const { status, nodeCount } = data;
  const canClose =
    !status.isClosed && status.closurePercent >= closeThresholdPercent;

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="pdca-panel"
      aria-label={t('incidentFlow.pdca.aria', 'Panel de cierre PDCA') as string}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-teal-600 dark:text-teal-300" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide text-primary-token">
            {t('incidentFlow.pdca.title', 'Cierre PDCA del incidente')}
          </h2>
        </div>
        <span
          className={`text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-elevated ${PHASE_TONE[status.phase]}`}
          data-testid="pdca-phase"
        >
          {status.phase}
        </span>
      </header>

      <div
        className="rounded-lg bg-surface-elevated p-3 flex items-center gap-3"
        data-testid="pdca-closure-meter"
      >
        <GaugeCircle className="w-8 h-8 text-teal-600 dark:text-teal-300" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-[10px] uppercase font-bold tracking-wide text-secondary-token">
            {t('incidentFlow.pdca.closureLabel', 'Cierre del ciclo')}
          </p>
          <p className="text-lg font-black tabular-nums">
            <span data-testid="pdca-closure-percent">{status.closurePercent}</span>%
          </p>
          <p className="text-[10px] text-secondary-token">
            {status.completedWorkerCount} {t('incidentFlow.pdca.of', 'de')} {status.assignedWorkerCount} {t('incidentFlow.pdca.workers', 'trabajadores')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase font-bold tracking-wide text-secondary-token">
            {t('incidentFlow.pdca.nodesLabel', 'Nodos ZK')}
          </p>
          <p className="text-lg font-black tabular-nums">{nodeCount}</p>
        </div>
      </div>

      <ol className="space-y-1.5" data-testid="pdca-step-list">
        {STEPS.map((step) => {
          const done = step.predicate(status);
          const Icon = done ? CircleCheck : CircleDashed;
          return (
            <li
              key={String(step.id)}
              className="flex items-center gap-2 text-xs"
              data-testid={`pdca-step-${String(step.id)}`}
            >
              <Icon
                className={`w-4 h-4 ${
                  done
                    ? 'text-emerald-600 dark:text-emerald-300'
                    : 'text-secondary-token opacity-60'
                }`}
                aria-hidden="true"
              />
              <span className={done ? 'text-primary-token' : 'text-secondary-token'}>
                {t(step.labelKey, step.labelDefault)}
              </span>
            </li>
          );
        })}
      </ol>

      {canClose && onCloseInvestigationRequested && (
        <button
          type="button"
          data-testid="pdca-close-investigation"
          onClick={() => onCloseInvestigationRequested(status)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <CircleCheck className="w-3.5 h-3.5" aria-hidden="true" />
          {t('incidentFlow.pdca.closeCta', 'Cerrar investigacion (PDCA Act → Close)')}
        </button>
      )}
      {!canClose && !status.isClosed && status.assignedWorkerCount > 0 && (
        <p
          className="text-[10px] text-secondary-token text-center"
          data-testid="pdca-threshold-helper"
        >
          {t(
            'incidentFlow.pdca.thresholdHelper',
            'Cierre disponible al alcanzar {{percent}}% de capacitaciones completadas.',
            { percent: closeThresholdPercent },
          )}
        </p>
      )}
    </section>
  );
}
