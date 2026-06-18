// Praeventio Guard — Waste Inventory page.
//
// Mounts WasteInventoryPanel with real data from useWasteInventory hook.
// Provides waste management functionality with environmental compliance.

import { useTranslation } from 'react-i18next';
import { Recycle, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WasteInventoryPanel } from '../components/environmental/WasteInventoryPanel';
import { useWasteInventory } from '../hooks/useWaste';

export function WasteInventoryPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = useWasteInventory(projectId);

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="waste-inventory-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Recycle className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('wasteInventory.page.title', 'Inventario de Residuos')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('wasteInventory.page.selectProject', 'Selecciona un proyecto para gestionar el inventario de residuos.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="waste-inventory-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center border border-emerald-500/20">
          <Recycle className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('wasteInventory.page.title', 'Inventario de Residuos')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('wasteInventory.page.subtitle', 'Gestión ambiental — inventario de residuos, manifiestos y permisos.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="waste-inventory-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token" data-testid="waste-inventory-loading">
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400" data-testid="waste-inventory-error" role="alert">
          {error.message}
        </div>
      )}

      {!loading && !error && data && (
        <WasteInventoryPanel
          wastes={data.wastes}
          pendingManifests={data.pendingManifests}
          permits={data.permits}
        />
      )}
    </div>
  );
}

export default WasteInventoryPage;
