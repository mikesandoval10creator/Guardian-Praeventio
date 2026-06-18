// Praeventio Guard — Hazmat Inventory page.
//
// Mounts HazmatStorageManager with real data from useHazmatInventory hook.
// Provides CRUD for hazmat substances with DS 43/2016 compliance.

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { HazmatStorageManager } from '../components/hazmat/HazmatStorageManager';
import {
  addHazmatSubstance,
  updateHazmatSubstance,
  deleteHazmatSubstance,
  listHazmatInventory,
} from '../hooks/useHazmatInventory';
import type { HazmatItem } from '../services/hazmat/hazmatInventory';
import { logger } from '../utils/logger';

export function HazmatInventoryPage() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [inventory, setInventory] = useState<HazmatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setInventory([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { items } = await listHazmatInventory(projectId, { inventory: [] });
      setInventory(items);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error cargando inventario';
      setError(msg);
      logger.error('hazmat.inventory.load.failed', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleChange = useCallback(
    async (next: HazmatItem[]) => {
      if (!projectId) return;
      try {
        // Determine what changed by comparing with current inventory
        const added = next.filter((n) => !inventory.some((i) => i.id === n.id));
        const removed = inventory.filter((i) => !next.some((n) => n.id === i.id));
        const updated = next.filter((n) => {
          const old = inventory.find((i) => i.id === n.id);
          return old && JSON.stringify(old) !== JSON.stringify(n);
        });

        for (const item of added) {
          await addHazmatSubstance(projectId, { item, inventory });
        }
        for (const item of updated) {
          await updateHazmatSubstance(projectId, { item, inventory });
        }
        for (const item of removed) {
          await deleteHazmatSubstance(projectId, { itemId: item.id, inventory });
        }

        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error actualizando inventario';
        setError(msg);
        logger.error('hazmat.inventory.update.failed', err);
      }
    },
    [projectId, inventory, refresh],
  );

  if (!selectedProject) {
    return (
      <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto" data-testid="hazmat-inventory-page-empty">
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <FlaskConical className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('hazmatInventory.page.title', 'Inventario HAZMAT')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t('hazmatInventory.page.selectProject', 'Selecciona un proyecto para gestionar el inventario de sustancias peligrosas.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4" data-testid="hazmat-inventory-page">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <FlaskConical className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('hazmatInventory.page.title', 'Inventario HAZMAT')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t('hazmatInventory.page.subtitle', 'DS 43/2016 — Control de sustancias peligrosas con validación de compatibilidad.')}
          </p>
        </div>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400" data-testid="hazmat-inventory-offline-chip">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token" data-testid="hazmat-inventory-loading">
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400" data-testid="hazmat-inventory-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && (
        <HazmatStorageManager
          items={inventory}
          onChange={handleChange}
          readOnly={!isOnline}
        />
      )}
    </div>
  );
}

export default HazmatInventoryPage;
