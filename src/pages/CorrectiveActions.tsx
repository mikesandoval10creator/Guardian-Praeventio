// Praeventio Guard — Fase F.4 page wrapper.
//
// Centro de Acciones Correctivas (PDCA). Esta página cierra la última
// pieza del flujo F.4 que ya tenía service + adapter + endpoint +
// componente + hook implementados, pero no estaba accesible desde la
// navegación: el ciclo Plan-Do-Check-Act del SGSST (ISO 45001 §10.2)
// quedaba inerte aunque el motor estuviera listo.
//
// Esta página:
//   1. Lee acciones abiertas vía `useCorrectiveActions` (Sprint K hook).
//   2. Promueve `CorrectiveAction` (legacy weakActionDetector shape) a
//      `CorrectiveActionRecord` (F.4 shape) con defaults conservadores
//      para los campos PDCA-only que la legacy no tiene (source/dueDate/
//      responsibleUid/evidenceRequired/effectivenessReviewAt).
//   3. Renderiza `CorrectiveActionsCenterPanel` con la lista promovida.
//
// La promoción es backward-compat: registros antiguos siguen visibles,
// y los nuevos (creados vía `createCorrectiveAction`) tienen todos los
// campos PDCA poblados desde el origen y pasan through sin cambios.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useCorrectiveActions } from '../hooks/useSprintK';
import { CorrectiveActionsCenterPanel } from '../components/correctiveActions/CorrectiveActionsCenterPanel';
import type { CorrectiveAction } from '../services/correctiveActions/weakActionDetector';
import type {
  CorrectiveActionRecord,
  CorrectiveActionSource,
  EffectivenessReviewEntry,
} from '../services/correctiveActions/correctiveActionsCenter';
import { logger } from '../utils/logger';

/**
 * Promote a legacy `CorrectiveAction` from `weakActionDetector` to the
 * F.4 extended `CorrectiveActionRecord` shape. Fields the legacy
 * payload doesn't carry get conservative defaults that keep PDCA
 * progress assessment honest:
 *   - `source: 'audit'` — neutral provenance until the writer specifies
 *   - `sourceNodeId: action.id` — self-reference (we know nothing better)
 *   - `responsibleUid: 'unassigned'` — flagged for re-assignment in UI
 *   - `dueDate: today + 30d` — conservative window so PDCA doesn't
 *     immediately classify it overdue
 *   - `evidenceRequired: false` — only escalated to true on close
 *   - `effectivenessReviewAt: null` — populated when status flips to closed
 *   - `isSystemic: action.isSystemic`
 *
 * Records that already arrived in the new shape (their adapter already
 * stored extended fields) pass through unchanged because the spread
 * after the defaults overrides them.
 */
function promote(action: CorrectiveAction): CorrectiveActionRecord {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const fallbackDue = new Date(Date.now() + thirtyDaysMs).toISOString();
  // A doc that already conforms to CorrectiveActionRecord (i.e. the
  // adapter stored the extended fields) carries the extra keys; cast
  // through `unknown` to access them safely without TS narrowing.
  const extra = action as unknown as Partial<CorrectiveActionRecord>;
  // Codex P2 round 3 (PR #309): the panel renders "Programar review"
  // for closed/verified actions, but `scheduleEffectivenessReview()`
  // returns null when `closedAt` is missing. Legacy actions don't
  // carry that timestamp. Synthesize a conservative fallback using
  // the closure-trigger timestamp when status is closed/verified so
  // the CTA actually schedules instead of being a silent no-op. We
  // use `now` because the legacy schema has no closure timestamp at
  // all — better to bias slightly recent (the F.11 cron picks up
  // newly-closed actions on its next pass).
  const synthClosedAt =
    action.status === 'closed' || action.status === 'verified'
      ? new Date().toISOString()
      : null;
  return {
    id: action.id,
    source: (extra.source ?? 'audit') as CorrectiveActionSource,
    sourceNodeId: extra.sourceNodeId ?? action.id,
    responsibleUid: extra.responsibleUid ?? 'unassigned',
    dueDate: extra.dueDate ?? fallbackDue,
    status: action.status,
    description: action.description,
    level: action.level,
    evidenceRequired: extra.evidenceRequired ?? false,
    effectivenessReviewAt: extra.effectivenessReviewAt ?? null,
    closedAt: extra.closedAt ?? synthClosedAt,
    isSystemic: action.isSystemic,
  };
}

export function CorrectiveActions() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  // Codex P2 round 1 + 3 (PR #309): fetch every F.4 status (open +
  // in_progress + closed + verified + reopened), not just 'open'. The
  // panel computes Plan-Do-Check-Act phase counts, closure rate, status
  // filters, and the schedule-effectiveness-review CTA from the FULL
  // `actions` prop. Round 1 added closed+verified; round 3 noted the
  // panel's own status filter also supports `in_progress` and
  // `reopened`, so any F.4 record in those Do/reopened states was
  // invisible to the dashboard.
  const openResp = useCorrectiveActions(projectId, { status: 'open' });
  const inProgressResp = useCorrectiveActions(projectId, { status: 'in_progress' as const });
  const closedResp = useCorrectiveActions(projectId, { status: 'closed' });
  const verifiedResp = useCorrectiveActions(projectId, { status: 'verified' });
  const reopenedResp = useCorrectiveActions(projectId, { status: 'reopened' as const });

  const loading =
    openResp.loading ||
    inProgressResp.loading ||
    closedResp.loading ||
    verifiedResp.loading ||
    reopenedResp.loading;
  const error =
    openResp.error ||
    inProgressResp.error ||
    closedResp.error ||
    verifiedResp.error ||
    reopenedResp.error;

  const records: CorrectiveActionRecord[] = useMemo(() => {
    const open = (openResp.data?.actions ?? []) as CorrectiveAction[];
    const inProgress = (inProgressResp.data?.actions ?? []) as CorrectiveAction[];
    const closed = (closedResp.data?.actions ?? []) as CorrectiveAction[];
    const verified = (verifiedResp.data?.actions ?? []) as CorrectiveAction[];
    const reopened = (reopenedResp.data?.actions ?? []) as CorrectiveAction[];
    return [...open, ...inProgress, ...closed, ...verified, ...reopened].map(
      promote,
    );
  }, [openResp.data, inProgressResp.data, closedResp.data, verifiedResp.data, reopenedResp.data]);

  const handleScheduleReview = (entry: EffectivenessReviewEntry) => {
    // Wire to a Cloud Function in a follow-up; for now we just log so
    // the prevencionista sees the trigger fired (the F.11 cron picks
    // it up from the action record once the closedAt + effectivenessReviewAt
    // fields propagate from the close mutation, which is a separate
    // PR — F.4 here is the read-only dashboard slice).
    logger.info('caCenter.scheduleReview', {
      actionId: entry.actionId,
      reviewAt: entry.reviewAt,
    });
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="corrective-actions-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ListChecks className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('caCenter.page.title', 'Centro de Acciones Correctivas')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'caCenter.page.selectProject',
              'Selecciona un proyecto para ver las acciones correctivas abiertas.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="corrective-actions-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <ListChecks className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('caCenter.page.title', 'Centro de Acciones Correctivas')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'caCenter.page.subtitle',
              'Ciclo PDCA — ISO 45001 §10.2 + Ley 16.744. {{count}} acciones cargadas.',
              { count: records.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="corrective-actions-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="corrective-actions-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="corrective-actions-error"
          role="alert"
        >
          {t('caCenter.page.error', 'No se pudieron cargar las acciones: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && (
        <CorrectiveActionsCenterPanel
          actions={records}
          onScheduleReview={handleScheduleReview}
        />
      )}
    </div>
  );
}

export default CorrectiveActions;
