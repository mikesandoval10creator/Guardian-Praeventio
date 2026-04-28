import { useState, useEffect } from 'react';
import { getPendingActions, SyncAction } from '../utils/pwa-offline';
import { logger } from '../utils/logger';

export function usePendingActions(collectionPrefix?: string) {
  const [pendingActions, setPendingActions] = useState<SyncAction[]>([]);

  useEffect(() => {
    const loadActions = async () => {
      try {
        const actions = await getPendingActions();
        if (collectionPrefix) {
          setPendingActions(actions.filter(a => a.collection.startsWith(collectionPrefix)));
        } else {
          setPendingActions(actions);
        }
      } catch (error) {
        logger.error('Error loading pending actions:', error);
      }
    };

    loadActions();

    const handleUpdate = () => {
      loadActions();
    };

    window.addEventListener('sync-actions-updated', handleUpdate);
    return () => window.removeEventListener('sync-actions-updated', handleUpdate);
  }, [collectionPrefix]);

  return pendingActions;
}
