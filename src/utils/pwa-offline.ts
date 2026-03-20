import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'praeventio-offline';
const STORE_NAME = 'pending-sync';

export interface SyncAction {
  id?: number;
  type: 'create' | 'update' | 'delete';
  collection: string;
  data: any;
  timestamp: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export const saveForSync = async (action: Omit<SyncAction, 'timestamp'>) => {
  const db = await getDB();
  const syncAction: SyncAction = {
    ...action,
    timestamp: Date.now(),
  };
  return db.add(STORE_NAME, syncAction);
};

export const getPendingActions = async (): Promise<SyncAction[]> => {
  const db = await getDB();
  return db.getAll(STORE_NAME);
};

export const removeSyncedAction = async (id: number) => {
  const db = await getDB();
  return db.delete(STORE_NAME, id);
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
    }
  }
};
