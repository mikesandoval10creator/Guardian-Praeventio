// Praeventio Guard — Unit tests del FirestoreRateLimitStore.
//
// Cubre:
//   - init() configura windowMs
//   - increment() en ventana nueva → totalHits = 1
//   - increment() en ventana activa → totalHits crece
//   - increment() después de venció → resetea a 1
//   - decrement() reduce el contador (no por debajo de 0)
//   - resetKey() borra el doc
//   - resetAll() borra todos
//   - fail-soft: error de Firestore → permite el request (no tumba app)
//
// Fake Firestore in-memory para no depender del emulador.

import { describe, it, expect, beforeEach } from 'vitest';
import { FirestoreRateLimitStore } from './firestoreRateLimitStore';

function makeFakeDb() {
  const docs = new Map<string, Record<string, unknown>>();

  const docRef = (path: string) => ({
    _path: path,
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
    }),
    set: async (data: Record<string, unknown>) => {
      docs.set(path, data);
    },
    update: async (data: Record<string, unknown>) => {
      const existing = docs.get(path) ?? {};
      docs.set(path, { ...existing, ...data });
    },
    delete: async () => {
      docs.delete(path);
    },
  });

  const collection = (name: string) => ({
    doc: (key: string) => docRef(`${name}/${key}`),
    get: async () => ({
      docs: Array.from(docs.entries())
        .filter(([k]) => k.startsWith(`${name}/`))
        .map(([k, v]) => ({
          id: k.slice(name.length + 1),
          data: () => v,
          ref: docRef(k),
        })),
    }),
  });

  // Fake runTransaction: ejecuta la función con un tx que delega a set/get/update.
  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: ReturnType<typeof docRef>) => Promise<{
        data: () => Record<string, unknown> | undefined;
      }>;
      set: (
        ref: ReturnType<typeof docRef>,
        data: Record<string, unknown>,
      ) => void;
      update: (
        ref: ReturnType<typeof docRef>,
        data: Record<string, unknown>,
      ) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    return fn({
      get: async (ref) => ({
        data: () => docs.get(ref._path),
      }),
      set: (ref, data) => {
        docs.set(ref._path, data);
      },
      update: (ref, data) => {
        const existing = docs.get(ref._path) ?? {};
        docs.set(ref._path, { ...existing, ...data });
      },
    });
  };

  const batch = () => {
    const pending: Array<() => void> = [];
    return {
      delete: (ref: ReturnType<typeof docRef>) => {
        pending.push(() => docs.delete(ref._path));
      },
      commit: async () => {
        for (const op of pending) op();
      },
    };
  };

  return { collection, runTransaction, batch, __docs: docs };
}

describe('FirestoreRateLimitStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let store: FirestoreRateLimitStore;

  beforeEach(() => {
    db = makeFakeDb();
    store = new FirestoreRateLimitStore({ db });
    store.init({ windowMs: 60_000 });
  });

  it('init() configura windowMs', async () => {
    const result = await store.increment('user-1');
    // resetTime debe estar ~60s en el futuro
    const delta = result.resetTime.getTime() - Date.now();
    expect(delta).toBeGreaterThan(55_000);
    expect(delta).toBeLessThan(65_000);
  });

  it('increment() en ventana nueva → totalHits = 1', async () => {
    const result = await store.increment('user-a');
    expect(result.totalHits).toBe(1);
  });

  it('increment() en ventana activa → totalHits crece', async () => {
    const r1 = await store.increment('user-b');
    const r2 = await store.increment('user-b');
    const r3 = await store.increment('user-b');
    expect(r1.totalHits).toBe(1);
    expect(r2.totalHits).toBe(2);
    expect(r3.totalHits).toBe(3);
    // resetTime no cambia dentro de la ventana
    expect(r2.resetTime.getTime()).toBe(r1.resetTime.getTime());
    expect(r3.resetTime.getTime()).toBe(r1.resetTime.getTime());
  });

  it('increment() después de vencida → resetea a 1', async () => {
    // forzar doc vencido
    db.__docs.set('_rate_limits/user-c', {
      count: 50,
      resetAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = await store.increment('user-c');
    expect(result.totalHits).toBe(1);
  });

  it('decrement() reduce el contador', async () => {
    await store.increment('user-d');
    await store.increment('user-d');
    await store.increment('user-d');
    await store.decrement('user-d');
    const result = await store.increment('user-d');
    // 3 increment → 3, -1 → 2, +1 → 3
    expect(result.totalHits).toBe(3);
  });

  it('decrement() no baja de 0', async () => {
    await store.decrement('user-e'); // doc no existe, no-op
    await store.decrement('user-e');
    const result = await store.increment('user-e');
    expect(result.totalHits).toBe(1);
  });

  it('resetKey() borra el doc', async () => {
    await store.increment('user-f');
    expect(db.__docs.has('_rate_limits/user-f')).toBe(true);
    await store.resetKey('user-f');
    expect(db.__docs.has('_rate_limits/user-f')).toBe(false);
  });

  it('resetAll() borra todos los contadores', async () => {
    await store.increment('user-g');
    await store.increment('user-h');
    await store.increment('user-i');
    expect(db.__docs.size).toBeGreaterThanOrEqual(3);
    await store.resetAll();
    expect(db.__docs.size).toBe(0);
  });

  it('prefix separa contadores independientes', async () => {
    const storeA = new FirestoreRateLimitStore({ db, prefix: 'api:' });
    const storeB = new FirestoreRateLimitStore({ db, prefix: 'csp:' });
    storeA.init({ windowMs: 60_000 });
    storeB.init({ windowMs: 60_000 });
    await storeA.increment('ip-1');
    await storeA.increment('ip-1');
    const a = await storeA.increment('ip-1'); // 3
    const b = await storeB.increment('ip-1'); // 1 — store separado
    expect(a.totalHits).toBe(3);
    expect(b.totalHits).toBe(1);
  });

  it('fail-soft: error de Firestore → permite el request (totalHits 1)', async () => {
    const failingDb = {
      runTransaction: async () => {
        throw new Error('Firestore down');
      },
      collection: () => ({
        doc: () => ({
          _path: 'fail/x',
          get: async () => ({ exists: false, data: () => undefined }),
          set: async () => {},
          update: async () => {},
          delete: async () => {},
        }),
      }),
    };
    const failingStore = new FirestoreRateLimitStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: failingDb as any,
    });
    failingStore.init({ windowMs: 60_000 });
    const result = await failingStore.increment('user-x');
    // Fail-soft: no tumba el request, devuelve 1 hit ficticio
    expect(result.totalHits).toBe(1);
    expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
  });
});
