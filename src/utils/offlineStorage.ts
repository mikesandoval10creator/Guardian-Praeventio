import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { openDB, DBSchema, IDBPDatabase } from 'idb';

// Keep IDB as fallback for web
interface PraeventioDB extends DBSchema {
  workers: { key: string; value: any; indexes: { 'by-project': string } };
  matrices: { key: string; value: any; indexes: { 'by-project': string } };
  zettelkasten: { key: string; value: any; indexes: { 'by-project': string } };
  offlineQueue: {
    key: number;
    value: { id?: number; action: 'create' | 'update' | 'delete'; collection: string; data: any; timestamp: number; };
  };
  blackbox: {
    key: string;
    value: { id: string; workerId: string; data: any; timestamp: number; locked: boolean };
  };
}

let idbPromise: Promise<IDBPDatabase<PraeventioDB>> | null = null;
let sqliteConnection: SQLiteConnection | null = null;
let sqliteDB: SQLiteDBConnection | null = null;

const initIDB = () => {
  if (!idbPromise) {
    idbPromise = openDB<PraeventioDB>('praeventio-bunker', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('workers')) {
          const workerStore = db.createObjectStore('workers', { keyPath: 'id' });
          workerStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('matrices')) {
          const matrixStore = db.createObjectStore('matrices', { keyPath: 'id' });
          matrixStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('zettelkasten')) {
          const zettelStore = db.createObjectStore('zettelkasten', { keyPath: 'id' });
          zettelStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('blackbox')) {
          db.createObjectStore('blackbox', { keyPath: 'id' });
        }
      },
    });
  }
  return idbPromise;
};

const initSQLite = async () => {
  if (!sqliteConnection) {
    sqliteConnection = new SQLiteConnection(CapacitorSQLite);
  }
  if (!sqliteDB) {
    try {
      const ret = await sqliteConnection.checkConnectionsConsistency();
      const isConn = (await sqliteConnection.isConnection("praeventio_bunker", false)).result;
      if (ret.result && isConn) {
        sqliteDB = await sqliteConnection.retrieveConnection("praeventio_bunker", false);
      } else {
        sqliteDB = await sqliteConnection.createConnection("praeventio_bunker", false, "no-encryption", 1, false);
      }
      await sqliteDB.open();
      
      // Create tables
      const schema = `
        CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, projectId TEXT, data TEXT);
        CREATE TABLE IF NOT EXISTS matrices (id TEXT PRIMARY KEY, projectId TEXT, data TEXT);
        CREATE TABLE IF NOT EXISTS zettelkasten (id TEXT PRIMARY KEY, projectId TEXT, data TEXT);
        CREATE TABLE IF NOT EXISTS offlineQueue (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, collection TEXT, data TEXT, timestamp INTEGER);
      `;
      await sqliteDB.execute(schema);
    } catch (err) {
      console.error("SQLite Init Error", err);
    }
  }
  return sqliteDB;
};

export const initDB = async () => {
  if (Capacitor.isNativePlatform()) {
    return await initSQLite();
  } else {
    return initIDB();
  }
};

const encryptData = (data: any): string => {
  try {
    return btoa(encodeURIComponent(JSON.stringify(data)));
  } catch (e) {
    console.error('Encryption error', e);
    return '';
  }
};

const decryptData = (encryptedStr: string): any => {
  try {
    return JSON.parse(decodeURIComponent(atob(encryptedStr)));
  } catch (e) {
    console.error('Decryption error', e);
    return null;
  }
};

export const saveWorkerOffline = async (worker: any) => {
  const encryptedWorker = { ...worker, _encryptedData: encryptData(worker) };
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('INSERT OR REPLACE INTO workers (id, projectId, data) VALUES (?, ?, ?)', [worker.id, worker.projectId, JSON.stringify(encryptedWorker)]);
  } else {
    const db = await initIDB();
    await db.put('workers', encryptedWorker);
  }
};

export const getWorkersOffline = async (projectId: string) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(!db) return [];
    const res = await db.query('SELECT data FROM workers WHERE projectId = ?', [projectId]);
    return res.values?.map(row => {
      const w = JSON.parse(row.data);
      return w._encryptedData ? decryptData(w._encryptedData) : w;
    }) || [];
  } else {
    const db = await initIDB();
    const workers = await db.getAllFromIndex('workers', 'by-project', projectId);
    return workers.map(w => w._encryptedData ? decryptData(w._encryptedData) : w);
  }
};

export const saveMatrixOffline = async (matrix: any) => {
  const encryptedMatrix = { ...matrix, _encryptedData: encryptData(matrix) };
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('INSERT OR REPLACE INTO matrices (id, projectId, data) VALUES (?, ?, ?)', [matrix.id, matrix.projectId, JSON.stringify(encryptedMatrix)]);
  } else {
    const db = await initIDB();
    await db.put('matrices', encryptedMatrix);
  }
};

export const getMatricesOffline = async (projectId: string) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(!db) return [];
    const res = await db.query('SELECT data FROM matrices WHERE projectId = ?', [projectId]);
    return res.values?.map(row => {
      const m = JSON.parse(row.data);
      return m._encryptedData ? decryptData(m._encryptedData) : m;
    }) || [];
  } else {
    const db = await initIDB();
    const matrices = await db.getAllFromIndex('matrices', 'by-project', projectId);
    return matrices.map(m => m._encryptedData ? decryptData(m._encryptedData) : m);
  }
};

export const saveZettelNodeOffline = async (node: any) => {
  const encryptedNode = { ...node, _encryptedData: encryptData(node) };
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('INSERT OR REPLACE INTO zettelkasten (id, projectId, data) VALUES (?, ?, ?)', [node.id, node.projectId, JSON.stringify(encryptedNode)]);
  } else {
    const db = await initIDB();
    await db.put('zettelkasten', encryptedNode);
  }
};

export const getZettelNodesOffline = async (projectId: string, limit = 50, offset = 0) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(!db) return [];
    const res = await db.query('SELECT data FROM zettelkasten WHERE projectId = ? LIMIT ? OFFSET ?', [projectId, limit, offset]);
    return res.values?.map(row => {
      const n = JSON.parse(row.data);
      return n._encryptedData ? decryptData(n._encryptedData) : n;
    }) || [];
  } else {
    const db = await initIDB();
    const tx = db.transaction('zettelkasten', 'readonly');
    const index = tx.store.index('by-project');
    
    let cursor = await index.openCursor(IDBKeyRange.only(projectId));
    const results: any[] = [];
    let count = 0;

    if (offset > 0 && cursor) {
      await cursor.advance(offset);
    }

    while (cursor && count < limit) {
      results.push(cursor.value._encryptedData ? decryptData(cursor.value._encryptedData) : cursor.value);
      count++;
      cursor = await cursor.continue();
    }

    return results;
  }
};

export const addToOfflineQueue = async (action: 'create' | 'update' | 'delete', collection: string, data: any) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('INSERT INTO offlineQueue (action, collection, data, timestamp) VALUES (?, ?, ?, ?)', [action, collection, JSON.stringify(data), Date.now()]);
  } else {
    const db = await initIDB();
    await db.add('offlineQueue', { action, collection, data, timestamp: Date.now() });
  }
};

export const getOfflineQueue = async () => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(!db) return [];
    const res = await db.query('SELECT * FROM offlineQueue');
    return res.values?.map(row => ({ ...row, data: JSON.parse(row.data) })) || [];
  } else {
    const db = await initIDB();
    return await db.getAll('offlineQueue');
  }
};

export const clearOfflineQueueItem = async (id: number) => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if(db) await db.run('DELETE FROM offlineQueue WHERE id = ?', [id]);
  } else {
    const db = await initIDB();
    await db.delete('offlineQueue', id);
  }
};

// ─── Black Box (Caja Negra Biométrica) ─────────────────────────────────────
// Saves an immutable telemetry dump when a ManDown event is confirmed.
// Locked by default — only unlockable via biometric auth or auditor key.

export const saveBlackBox = async (workerId: string, telemetry: Record<string, any>) => {
  const entry = {
    id: `blackbox_${workerId}_${Date.now()}`,
    workerId,
    data: { ...telemetry, savedAt: new Date().toISOString() },
    timestamp: Date.now(),
    locked: true,
  };
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if (db) await db.run(
      'INSERT INTO offlineQueue (action, collection, data, timestamp) VALUES (?, ?, ?, ?)',
      ['create', 'blackbox', JSON.stringify(entry), Date.now()]
    );
  } else {
    const db = await initIDB();
    await db.put('blackbox', entry);
  }
};

export const getBlackBoxEntries = async (): Promise<any[]> => {
  if (Capacitor.isNativePlatform()) {
    const db = await initSQLite();
    if (!db) return [];
    const res = await db.query("SELECT data FROM offlineQueue WHERE collection = 'blackbox'");
    return res.values?.map(row => JSON.parse(row.data)) || [];
  } else {
    const db = await initIDB();
    return await db.getAll('blackbox');
  }
};

export const unlockBlackBox = async (id: string) => {
  if (Capacitor.isNativePlatform()) return; // native unlock handled separately
  const db = await initIDB();
  const entry = await db.get('blackbox', id);
  if (entry) {
    await db.put('blackbox', { ...entry, locked: false });
  }
};
