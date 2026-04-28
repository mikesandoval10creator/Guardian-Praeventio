import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'praeventio-offline';
const STORE_NAME = 'pending-sync';
const CACHE_STORE_NAME = 'ai-cache';
const BUNKER_STORE_NAME = 'bunker-knowledge';

export interface SyncAction {
  id?: number;
  docId?: string;
  type: 'create' | 'update' | 'delete' | 'upload';
  collection: string;
  data: any;
  file?: File;
  timestamp: number;
  localUpdatedAt: string; // ISO timestamp of when the action was queued offline
}

let idbPromise: Promise<IDBPDatabase> | null = null;
let sqliteConnection: SQLiteConnection | null = null;
let sqliteDB: SQLiteDBConnection | null = null;

function getIDB() {
  if (!idbPromise) {
    idbPromise = openDB(DB_NAME, 3, {
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
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains(BUNKER_STORE_NAME)) {
            db.createObjectStore(BUNKER_STORE_NAME, { keyPath: 'id' });
          }
        }
      },
    });
  }
  return idbPromise;
}

const initSQLite = async () => {
  if (!sqliteConnection) {
    sqliteConnection = new SQLiteConnection(CapacitorSQLite);
  }
  if (!sqliteDB) {
    try {
      const ret = await sqliteConnection.checkConnectionsConsistency();
      const isConn = (await sqliteConnection.isConnection("praeventio_offline", false)).result;
      if (ret.result && isConn) {
        sqliteDB = await sqliteConnection.retrieveConnection("praeventio_offline", false);
      } else {
        sqliteDB = await sqliteConnection.createConnection("praeventio_offline", false, "no-encryption", 1, false);
      }
      await sqliteDB.open();
      
      // Note: pending_sync now carries a `localUpdatedAt` column so the native
      // (Capacitor SQLite) branch can preserve the same conflict-detection
      // shape as the IndexedDB branch. Without this, the offline conflict
      // banner cannot compare originalUpdatedAt and a peer's edits get
      // silently overwritten on Android/iOS.
      const schema = `
        CREATE TABLE IF NOT EXISTS pending_sync (id INTEGER PRIMARY KEY AUTOINCREMENT, docId TEXT, type TEXT, collection TEXT, data TEXT, timestamp INTEGER, localUpdatedAt INTEGER);
        CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, data TEXT, timestamp INTEGER);
        CREATE TABLE IF NOT EXISTS bunker_knowledge (id TEXT PRIMARY KEY, data TEXT, timestamp INTEGER);
      `;
      await sqliteDB.execute(schema);

      // Migration: existing native users have a pending_sync table without the
      // localUpdatedAt column. ALTER TABLE will throw "duplicate column name"
      // if the column already exists (new install or already-migrated). We
      // swallow that specific failure — any other error is logged but does
      // not abort init, since pending_sync still works at the basic level.
      try {
        await sqliteDB.execute('ALTER TABLE pending_sync ADD COLUMN localUpdatedAt INTEGER');
      } catch (migrationErr) {
        // Expected on subsequent launches once the column exists.
        // Cannot reliably distinguish "duplicate column" from other ALTER
        // failures across SQLite drivers, so we log at debug level and move on.
        // The CREATE TABLE above guarantees the column exists for fresh installs.
        console.debug('SQLite migration (localUpdatedAt) skipped', migrationErr);
      }
    } catch (err) {
      console.error("SQLite Init Error", err);
    }
  }
  return sqliteDB;
};

export const cacheAIResponse = async (key: string, data: any) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('INSERT OR REPLACE INTO ai_cache (key, data, timestamp) VALUES (?, ?, ?)', [key, JSON.stringify(data), Date.now()]);
  } else {
    const db = await getIDB();
    return db.put(CACHE_STORE_NAME, { key, data, timestamp: Date.now() });
  }
};

export const getCachedAIResponse = async (key: string) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(!db) return null;
    const res = await db.query('SELECT data FROM ai_cache WHERE key = ?', [key]);
    return res.values && res.values.length > 0 ? JSON.parse(res.values[0].data) : null;
  } else {
    const db = await getIDB();
    const result = await db.get(CACHE_STORE_NAME, key);
    return result ? result.data : null;
  }
};

export const saveBunkerKnowledge = async (id: string, data: any) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('INSERT OR REPLACE INTO bunker_knowledge (id, data, timestamp) VALUES (?, ?, ?)', [id, JSON.stringify(data), Date.now()]);
  } else {
    const db = await getIDB();
    return db.put(BUNKER_STORE_NAME, { id, data, timestamp: Date.now() });
  }
};

export const getBunkerKnowledge = async (id: string) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(!db) return null;
    const res = await db.query('SELECT data FROM bunker_knowledge WHERE id = ?', [id]);
    return res.values && res.values.length > 0 ? JSON.parse(res.values[0].data) : null;
  } else {
    const db = await getIDB();
    const result = await db.get(BUNKER_STORE_NAME, id);
    return result ? result.data : null;
  }
};

export const saveForSync = async (action: Omit<SyncAction, 'timestamp' | 'localUpdatedAt'>) => {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const syncAction: SyncAction = {
    ...action,
    timestamp: nowMs,
    localUpdatedAt: now,
    data: { ...action.data, localUpdatedAt: now },
  };
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if (db) {
      // Persist the merged data (which already contains localUpdatedAt) AND
      // the column copy so the conflict-detection code path on read-out has a
      // reliable source even if `data` was ever stored without it.
      await db.run(
        'INSERT INTO pending_sync (docId, type, collection, data, timestamp, localUpdatedAt) VALUES (?, ?, ?, ?, ?, ?)',
        [action.docId, action.type, action.collection, JSON.stringify(syncAction.data), syncAction.timestamp, nowMs]
      );
    }
    window.dispatchEvent(new CustomEvent('sync-actions-updated'));
  } else {
    const db = await getIDB();
    const result = await db.add(STORE_NAME, syncAction);
    window.dispatchEvent(new CustomEvent('sync-actions-updated'));
    return result;
  }
};

export const getPendingActions = async (): Promise<SyncAction[]> => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(!db) return [];
    const res = await db.query('SELECT * FROM pending_sync');
    return res.values?.map(row => {
      const parsedData = JSON.parse(row.data);
      // Re-attach localUpdatedAt onto the data payload so OfflineSyncManager's
      // conflict detection sees the same shape as the IndexedDB branch.
      // Prefer whatever was already inside `data` (string ISO); fall back to
      // the SQLite column (epoch ms -> ISO) for rows written before migration.
      const localUpdatedAtIso = parsedData?.localUpdatedAt
        ?? (typeof row.localUpdatedAt === 'number' ? new Date(row.localUpdatedAt).toISOString() : undefined);
      return {
        ...row,
        data: localUpdatedAtIso ? { ...parsedData, localUpdatedAt: localUpdatedAtIso } : parsedData,
        localUpdatedAt: localUpdatedAtIso ?? '',
      };
    }) || [];
  } else {
    const db = await getIDB();
    return db.getAll(STORE_NAME);
  }
};

export const removeSyncedAction = async (id: number) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('DELETE FROM pending_sync WHERE id = ?', [id]);
    window.dispatchEvent(new CustomEvent('sync-actions-updated'));
  } else {
    const db = await getIDB();
    const result = await db.delete(STORE_NAME, id);
    window.dispatchEvent(new CustomEvent('sync-actions-updated'));
    return result;
  }
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
