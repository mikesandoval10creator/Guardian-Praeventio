// Praeventio Guard — Wire UI: <FirstResponderDispatchPanel />
//
// Sprint 52 §219: visualiza el plan de despacho cuando se reporta una
// emergencia + coverage gaps del sitio. El motor `firstResponderMap.ts`
// es puro — este componente solo renderiza el resultado y emite eventos.

import { useTranslation } from 'react-i18next';
import {
  Heart,
  Flame,
  Mountain,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldAlert,
  PhoneCall,
} from 'lucide-react';
import type {
  DispatchPlan,
  DispatchCandidate,
  IncidentKind,
  CoverageGap,
} from '../../services/firstResponderMap/firstResponderMap.js';

interface FirstResponderDispatchPanelProps {
  /** Plan recibido del motor `buildDispatchPlan()`. Si es null = sin incidente activo. */
  plan: DispatchPlan | null;
  /** Coverage gaps actuales del sitio (de `analyzeCoverage()`). */
  coverageGaps?: CoverageGap[];
  /** Lookup uid → nombre legible. */
  responderNameByUid?: Record<string, string>;
  /** Callback al activar el primary candidate (notificar / ack). */
  onDispatchPrimary?: (candidate: DispatchCandidate) => void;
  /** Callback al promover un backup como primary. */
  onPromoteBackup?: (candidate: DispatchCandidate) => void;
  /** Callback al llamar mutual externa (cuando no hay eligible). */
  onCallMutual?: () => void;
}

const KIND_ICON: Record<IncidentKind, typeof Heart> = {
  medical_emergency: Heart,
  cardiac_arrest: Heart,
  trauma_injury: AlertTriangle,
  fire: Flame,
  chemical_exposure: ShieldAlert,
  fall_from_height: Mountain,
  confined_space_rescue: Mountain,
  electrical_injury: Heart,
  mass_casualty: AlertTriangle,
};

const KIND_LABEL: Record<IncidentKind, string> = {
  medical_emergency: 'Emergencia médica',
  cardiac_arrest: 'Paro cardíaco',
  trauma_injury: 'Trauma',
  fire: 'Incendio',
  chemical_exposure: 'Exposición química',
  fall_from_height: 'Caída en altura',
  confined_space_rescue: 'Rescate confinado',
  electrical_injury: 'Lesión eléctrica',
  mass_casualty: 'Múltiples víctimas',
};

const SEVERITY_CLASS: Record<CoverageGap['severity'], string> = {
  critical: 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300',
  warning: 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300',
  info: 'bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300',
};

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function FirstResponderDispatchPanel({
  plan,
  coverageGaps = [],
  responderNameByUid = {},
  onDispatchPrimary,
  onPromoteBackup,
  onCallMutual,
}: FirstResponderDispatchPanelProps) {
  const { t } = useTranslation();

  // No incident → just show coverage status.
  if (!plan) {
    return (
      <section
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4"
        data-testid="first-responder-panel-idle"
        aria-label={t('firstResponder.idleAria', 'Cobertura de respondedores') as string}
      >
        <header className="flex items-center gap-2 mb-3">
          <Heart className="w-5 h-5 text-emerald-600" aria-hidden="true" />
          <h2 className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
            {t('firstResponder.idleTitle', 'Sin emergencias activas')}
          </h2>
        </header>
        {coverageGaps.length === 0 ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            {t('firstResponder.coverageFull', 'Cobertura completa — paramédico + brigada + rescate + SIF on-duty')}
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="first-responder-coverage-gaps">
            {coverageGaps.map((g, i) => (
              <li
                key={i}
                data-testid={`coverage-gap-${g.kind}`}
                className={`rounded-md border px-2 py-1.5 text-xs ${SEVERITY_CLASS[g.severity]}`}
              >
                {g.detail}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const Icon = KIND_ICON[plan.incidentKind];

  return (
    <section
      className="rounded-2xl border-2 border-rose-500/40 bg-rose-500/5 p-4 shadow-mode"
      data-testid="first-responder-panel"
      aria-label={t('firstResponder.activeAria', 'Plan de despacho activo') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5 text-rose-600" aria-hidden="true" />
        <h2 className="text-sm font-black text-rose-700 dark:text-rose-300 uppercase tracking-wide">
          {t('firstResponder.activeTitle', 'Despacho de Respondedores')} —{' '}
          {KIND_LABEL[plan.incidentKind]}
        </h2>
      </header>

      {plan.noEligibleResponder && (
        <div
          className="rounded-lg border-2 border-rose-500/60 bg-rose-500/10 p-3 mb-3"
          data-testid="first-responder-no-eligible"
        >
          <p className="text-sm font-bold text-rose-700 dark:text-rose-300 mb-2">
            {t('firstResponder.noEligible', 'Sin respondedores aptos en sitio')}
          </p>
          <ul className="text-xs space-y-0.5 mb-3 opacity-90">
            {plan.recommendations.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
          {onCallMutual && (
            <button
              type="button"
              onClick={onCallMutual}
              data-testid="first-responder-call-mutual"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 text-white text-xs font-bold hover:brightness-110"
            >
              <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
              {t('firstResponder.callMutual', 'Llamar mutual externa')}
            </button>
          )}
        </div>
      )}

      {plan.primary && (
        <article
          data-testid="first-responder-primary"
          className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/10 p-3 mb-3"
        >
          <p className="text-[10px] uppercase tracking-wide font-bold text-emerald-700 dark:text-emerald-300 mb-1">
            {t('firstResponder.primaryLabel', 'Primary')}
          </p>
          <CandidateRow
            candidate={plan.primary}
            responderNameByUid={responderNameByUid}
            onAction={
              onDispatchPrimary
                ? () => onDispatchPrimary(plan.primary!)
                : undefined
            }
            actionLabel={t('firstResponder.notify', 'Notificar') as string}
            actionTestId="first-responder-notify-primary"
          />
        </article>
      )}

      {plan.backups.length > 0 && (
        <div data-testid="first-responder-backups">
          <p className="text-[10px] uppercase tracking-wide font-bold text-stone-600 dark:text-stone-400 mb-2">
            {t('firstResponder.backupsLabel', 'Backups')} ({plan.backups.length})
          </p>
          <ul className="space-y-2">
            {plan.backups.map((c) => (
              <li
                key={c.responderUid}
                data-testid={`first-responder-backup-${c.responderUid}`}
                className="rounded-md border border-stone-500/30 bg-white/40 dark:bg-black/20 p-2"
              >
                <CandidateRow
                  candidate={c}
                  responderNameByUid={responderNameByUid}
                  onAction={onPromoteBackup ? () => onPromoteBackup(c) : undefined}
                  actionLabel={t('firstResponder.promote', 'Asignar') as string}
                  actionTestId={`first-responder-promote-${c.responderUid}`}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Internal: single candidate row
// ────────────────────────────────────────────────────────────────────────

interface CandidateRowProps {
  candidate: DispatchCandidate;
  responderNameByUid: Record<string, string>;
  onAction?: () => void;
  actionLabel: string;
  actionTestId: string;
}

function CandidateRow({
  candidate,
  responderNameByUid,
  onAction,
  actionLabel,
  actionTestId,
}: CandidateRowProps) {
  const name = responderNameByUid[candidate.responderUid] ?? candidate.responderUid;
  const showAction = candidate.available && onAction;
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight">{name}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] opacity-80 mt-0.5">
          <span className="inline-flex items-center gap-0.5">
            <ShieldAlert className="w-3 h-3" aria-hidden="true" />
            {candidate.matchedRole}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <MapPin className="w-3 h-3" aria-hidden="true" />
            {formatDistance(candidate.distanceMeters)}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Clock className="w-3 h-3" aria-hidden="true" />
            ETA {formatEta(candidate.estimatedArrivalSeconds)}
          </span>
          <span className="font-mono text-[10px] opacity-70">
            score {Math.round(candidate.matchScore)}
          </span>
        </div>
        {!candidate.available && candidate.reasonIfRejected && (
          <p
            className="text-[10px] mt-1 italic text-rose-700 dark:text-rose-300"
            data-testid={`candidate-rejected-${candidate.responderUid}`}
          >
            {candidate.reasonIfRejected}
          </p>
        )}
      </div>
      {showAction && (
        <button
          type="button"
          onClick={onAction}
          data-testid={actionTestId}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold hover:brightness-110 shrink-0"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
