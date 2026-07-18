// Praeventio Guard — Fase F.8 page wrapper.
//
// Bandeja del Prevencionista: vista única de pendientes hoy. Consume
// el endpoint `/api/sprint-k/:projectId/inbox` (servidor agrega de
// corrective_actions + sif_precursors_pending + más feeds que se
// suman en sub-PRs siguientes) y renderiza
// `InboxPrevencionistaPanel`.
//
// El componente del panel ya implementa empty/loading/dismiss UI; este
// wrapper solo orquesta proyecto + hook + estados de borde (offline,
// no project, error).

import { useEffect, useMemo, useState } from 'react';
import { humanErrorMessage } from '../lib/humanError';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Inbox as InboxIcon, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useInbox } from '../hooks/useInbox';
import { useDataQuality } from '../hooks/useDataQuality';
import { InboxPrevencionistaPanel } from '../components/inbox/InboxPrevencionistaPanel';
import { DataQualityCard } from '../components/dataQuality/DataQualityCard';
import {
  summarizeInbox,
  type InboxItem,
} from '../services/inbox/inboxAggregator';
import { logger } from '../utils/logger';

/**
 * Resolve an inbox item's source ref to a SPA route path. Lets the
 * "Ver detalle" / "Ir a investigación" / "Marcar realizada" actions
 * deep-link the user to the actual record instead of being silent
 * no-ops (Codex P2 PR #309).
 */
function routeForItem(item: InboxItem): string {
  // SIF precursors have a dedicated review page (OLA 1): /sif renders the
  // pending-executive-review list with the review + notify-mandante CTAs.
  if (item.kind === 'sif_precursor_pending') {
    return '/sif';
  }
  if (item.kind === 'corrective_action_open') {
    return '/corrective-actions';
  }
  if (item.kind === 'incident_pending_review') {
    return '/hub/risks';
  }
  if (item.kind === 'document_pending_approval') {
    return '/hub/compliance';
  }
  if (item.kind === 'epp_pending_validation') {
    return '/hub/operations';
  }
  if (item.kind === 'worker_pending_onboarding') {
    return '/cuadrillas';
  }
  // Fallback: the operations hub catches the unmapped kinds so the
  // user lands somewhere coherent instead of staying on the inbox.
  return '/hub/operations';
}

export function Inbox() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = useInbox(projectId);
  // Sprint 40 Fase F.9: data quality scanner attached to the inbox per
  // plan ("tarjeta en F.8 Inbox: Mejora calidad de datos"). Runs in
  // parallel — own loading/error independent of the inbox feed.
  const { data: dataQuality } = useDataQuality(projectId);

  // Codex P2 (PR #309): the panel doesn't track local dismissals on
  // its own — onAction is just a callback. Without parent state the
  // "Posponer 24h" / "Marcar realizada" buttons appeared to be no-ops
  // until refresh. Track a Set of locally-dismissed item ids so the
  // panel filter (`!i.dismissedAt`) hides them as soon as the user
  // clicks. Server-side mutations are a follow-up sub-PR; this lets
  // the prevencionista clear their inbox view honestly today.
  const [locallyDismissed, setLocallyDismissed] = useState<Set<string>>(
    () => new Set(),
  );

  // Codex P2 round 2 (PR #309): the deterministic InboxItem.id
  // (`ca_<source>_<sourceNodeId>_<slug>`) is project-agnostic, so
  // switching projects without resetting `locallyDismissed` would
  // hide an item in project B if it happened to share an id with one
  // dismissed in project A. Clear the Set whenever projectId changes.
  useEffect(() => {
    setLocallyDismissed(new Set());
  }, [projectId]);

  const itemsWithDismissals: InboxItem[] = useMemo(() => {
    if (!data?.items) return [];
    if (locallyDismissed.size === 0) return data.items;
    const nowIso = new Date().toISOString();
    return data.items.map((it) =>
      locallyDismissed.has(it.id) ? { ...it, dismissedAt: nowIso } : it,
    );
  }, [data?.items, locallyDismissed]);

  // Codex P2 round 2 (PR #309): recompute summary from the visible
  // (dismissed-aware) items, not the raw server response. Without this
  // the panel would show "5 urgentes" while no urgent items render —
  // contradicting itself after the prevencionista works through their
  // queue.
  const visibleSummary = useMemo(() => {
    if (!data?.summary) return null;
    if (locallyDismissed.size === 0) return data.summary;
    const visible = itemsWithDismissals.filter((it) => !it.dismissedAt);
    return summarizeInbox(visible, new Date().toISOString());
  }, [data?.summary, itemsWithDismissals, locallyDismissed]);

  const handleAction = (
    item: { id: string; kind: string },
    actionKind: string,
  ): void => {
    // For dismiss-equivalent actions (approve / reject / mark_done /
    // postpone), hide the item from this session immediately so the
    // click isn't a UX no-op. Server-side mutation endpoints (POST
    // /api/sprint-k/.../inbox/{action}) ship in the follow-up sub-PR;
    // until then we log so the click is auditable in the browser
    // console.
    const dismissActions = new Set([
      'approve',
      'reject',
      'mark_done',
      'postpone',
    ]);
    // Codex P2 round 2 (PR #309): `open_detail` and `assign` are also
    // exposed as quick actions by the panel (e.g. "Revisión ejecutiva",
    // "Ir a investigación", "Escalar gerencia"). The user expects them
    // to navigate to the underlying record, NOT just log silently.
    const navigateActions = new Set(['open_detail', 'assign']);

    if (dismissActions.has(actionKind)) {
      setLocallyDismissed((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    }
    if (navigateActions.has(actionKind)) {
      const path = routeForItem(item as InboxItem);
      navigate(path);
    }
    logger.info('inbox.action', {
      itemId: item.id,
      itemKind: item.kind,
      actionKind,
      localDismiss: dismissActions.has(actionKind),
      navigateTo: navigateActions.has(actionKind) ? routeForItem(item as InboxItem) : undefined,
    });
  };

  // Codex P2 (PR #309): the panel always shows a "Ver detalle" button.
  // Without onOpenDetail wired the button was silent. Now navigate to
  // the closest SPA route for the item's kind (mapping above).
  const handleOpenDetail = (item: InboxItem): void => {
    const path = routeForItem(item);
    logger.info('inbox.openDetail', { itemId: item.id, itemKind: item.kind, path });
    navigate(path);
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="inbox-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <InboxIcon
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('inbox.page.title', 'Bandeja del Prevencionista')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'inbox.page.selectProject',
              'Selecciona un proyecto para ver tus pendientes de hoy.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="inbox-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <InboxIcon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('inbox.page.title', 'Bandeja del Prevencionista')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'inbox.page.subtitle',
              'Pendientes ordenados por urgencia · {{count}} ítems · {{overdue}} vencidos',
              {
                count: (visibleSummary ?? data?.summary)?.total ?? 0,
                overdue: (visibleSummary ?? data?.summary)?.overdueCount ?? 0,
              },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="inbox-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="inbox-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="inbox-error"
          role="alert"
        >
          {t('inbox.page.error', 'No se pudo cargar la bandeja: {{msg}}', {
            msg: humanErrorMessage(error),
          })}
        </div>
      )}

      {!loading && !error && data && (
        <InboxPrevencionistaPanel
          items={itemsWithDismissals}
          summary={visibleSummary ?? data.summary}
          onAction={handleAction}
          onOpenDetail={handleOpenDetail}
        />
      )}

      {/* Data Quality card (F.9). Independent of inbox load — render
          when the data-quality endpoint returns its own result. */}
      {dataQuality && (
        <DataQualityCard
          report={dataQuality.report}
          topGaps={dataQuality.topGaps}
        />
      )}
    </div>
  );
}

export default Inbox;
