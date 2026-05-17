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

import { useTranslation } from 'react-i18next';
import { Inbox as InboxIcon, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useInbox, useDataQuality } from '../hooks/useSprintK';
import { InboxPrevencionistaPanel } from '../components/inbox/InboxPrevencionistaPanel';
import { DataQualityCard } from '../components/dataQuality/DataQualityCard';
import { logger } from '../utils/logger';

export function Inbox() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = useInbox(projectId);
  // Sprint 40 Fase F.9: data quality scanner attached to the inbox per
  // plan ("tarjeta en F.8 Inbox: Mejora calidad de datos"). Runs in
  // parallel — own loading/error independent of the inbox feed.
  const { data: dataQuality } = useDataQuality(projectId);

  const handleAction = (
    item: { id: string; kind: string },
    actionKind: string,
  ): void => {
    // Server-side mutation endpoints (POST /api/sprint-k/.../inbox/dismiss,
    // POST .../assign, etc.) ship in the follow-up sub-PR. For now we
    // log the intent so the prevencionista's click is auditable in the
    // browser console; the UI still updates locally because the panel's
    // own dismiss state lives in component state until the mutation
    // round-trips.
    logger.info('inbox.action', {
      itemId: item.id,
      itemKind: item.kind,
      actionKind,
    });
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
                count: data?.summary?.total ?? 0,
                overdue: data?.summary?.overdueCount ?? 0,
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
            msg: error.message,
          })}
        </div>
      )}

      {!loading && !error && data && (
        <InboxPrevencionistaPanel
          items={data.items}
          summary={data.summary}
          onAction={handleAction}
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
