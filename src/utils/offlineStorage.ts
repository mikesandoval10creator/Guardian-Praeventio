import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface PraeventioDB extends DBSchema {
  workers: {
    key: string;
    value: any;
    indexes: { 'by-project': string };
  };
  matrices: {
    key: string;
    value: any;
    indexes: { 'by-project': string };
  };
  offlineQueue: {
    key: number;
    value: {
      id?: number;
      action: 'create' | 'update' | 'delete';
      collection: string;
      data: any;
      timestamp: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<PraeventioDB>> | null = null;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<PraeventioDB>('praeventio-bunker', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('workers')) {
          const workerStore = db.createObjectStore('workers', { keyPath: 'id' });
          workerStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('matrices')) {
          const matrixStore = db.createObjectStore('matrices', { keyPath: 'id' });
          matrixStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('offlineQueue')) {
          db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
};

// Basic encryption/obfuscation wrapper for local storage (MVP level)
// In a real production environment, use Web Crypto API with secure key management
const encryptData = (data: any): string => {
  try {
    const jsonStr = JSON.stringify(data);
    // Simple base64 encoding for MVP obfuscation
    return btoa(encodeURIComponent(jsonStr));
  } catch (e) {
    console.error('Encryption error', e);
    return '';
  }
};

const decryptData = (encryptedStr: string): any => {
  try {
    const jsonStr = decodeURIComponent(atob(encryptedStr));
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Decryption error', e);
    return null;
  }
};

export const saveWorkerOffline = async (worker: any) => {
  const db = await initDB();
  const encryptedWorker = { ...worker, _encryptedData: encryptData(worker) };
  await db.put('workers', encryptedWorker);
};

export const getWorkersOffline = async (projectId: string) => {
  const db = await initDB();
  const workers = await db.getAllFromIndex('workers', 'by-project', projectId);
  return workers.map(w => w._encryptedData ? decryptData(w._encryptedData) : w);
};

export const saveMatrixOffline = async (matrix: any) => {
  const db = await initDB();
  const encryptedMatrix = { ...matrix, _encryptedData: encryptData(matrix) };
  await db.put('matrices', encryptedMatrix);
};

export const getMatricesOffline = async (projectId: string) => {
  const db = await initDB();
  const matrices = await db.getAllFromIndex('matrices', 'by-project', projectId);
  return matrices.map(m => m._encryptedData ? decryptData(m._encryptedData) : m);
};

export const addToOfflineQueue = async (action: 'create' | 'update' | 'delete', collection: string, data: any) => {
  const db = await initDB();
  await db.add('offlineQueue', {
    action,
    collection,
    data,
    timestamp: Date.now()
  });
};

export const getOfflineQueue = async () => {
  const db = await initDB();
  return await db.getAll('offlineQueue');
};

export const clearOfflineQueueItem = async (id: number) => {
  const db = await initDB();
  await db.delete('offlineQueue', id);
};
