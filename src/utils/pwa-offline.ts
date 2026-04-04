import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'praeventio-offline';
const STORE_NAME = 'pending-sync';
const CACHE_STORE_NAME = 'ai-cache';

export interface SyncAction {
  id?: number;
  type: 'create' | 'update' | 'delete' | 'upload';
  collection: string;
  data: any;
  file?: File;
  timestamp: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          }
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
            db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
          }
        }
      },
    });
  }
  return dbPromise;
}

export const cacheAIResponse = async (key: string, data: any) => {
  const db = await getDB();
  return db.put(CACHE_STORE_NAME, { key, data, timestamp: Date.now() });
};

export const getCachedAIResponse = async (key: string) => {
  const db = await getDB();
  const result = await db.get(CACHE_STORE_NAME, key);
  return result ? result.data : null;
};

export const saveForSync = async (action: Omit<SyncAction, 'timestamp'>) => {
  const db = await getDB();
  const syncAction: SyncAction = {
    ...action,
    timestamp: Date.now(),
  };
  const result = await db.add(STORE_NAME, syncAction);
  window.dispatchEvent(new CustomEvent('sync-actions-updated'));
  return result;
};

export const getPendingActions = async (): Promise<SyncAction[]> => {
  const db = await getDB();
  return db.getAll(STORE_NAME);
};

export const removeSyncedAction = async (id: number) => {
  const db = await getDB();
  const result = await db.delete(STORE_NAME, id);
  window.dispatchEvent(new CustomEvent('sync-actions-updated'));
  return result;
};

export const isOnline = () => navigator.onLine;

export const syncWithFirebase = async (callback: (action: SyncAction) => Promise<void>) => {
  if (!isOnline()) return;

  const actions = await getPendingActions();
  for (const action of actions) {
    try {
      await callback(action);
      if (action.id) await removeSyncedAction(action.id);
    } catch (err) {
      console.error('Failed to sync action:', action, err);
      window.dispatchEvent(new CustomEvent('sync-action-failed', { detail: { action, error: err } }));
    }
  }
};
