// Praeventio Guard — Record Deduplication page (Bloque D Rama 2).
//
// Thin wrapper (ReturnToWorkPage pattern): header + <DeduplicationPanel />
// over the pure-compute deduplication HTTP surface
// (src/server/routes/deduplication.ts via src/hooks/useDeduplication.ts).

import { useTranslation } from 'react-i18next';
import { Layers, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { DeduplicationPanel } from '../components/deduplication/DeduplicationPanel';

export function DeduplicationPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="deduplication-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Layers className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('deduplication.page.title', 'Deduplicación de Registros')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('deduplication.page.selectProject', 'Selecciona un proyecto para detectar registros duplicados.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="deduplication-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500/10 text-teal-500 flex items-center justify-center border border-teal-500/20">
          <Layers className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('deduplication.page.title', 'Deduplicación de Registros')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('deduplication.page.subtitle', 'Detecta registros duplicados (trabajadores, equipos, proyectos) y planifica su fusión.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="deduplication-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <DeduplicationPanel projectId={selectedProject.id} />
    </div>
  );
}

export default DeduplicationPage;
