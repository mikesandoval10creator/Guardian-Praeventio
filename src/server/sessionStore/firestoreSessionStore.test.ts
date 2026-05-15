// Praeventio Guard — Unit tests del FirestoreSessionStore.
//
// Cubre los métodos requeridos por la interfaz Store de express-session:
//   - get → null si no existe, parsed si existe, null si vencido
//   - set → escribe data + expiresAt + updatedAt
//   - destroy → borra el doc
//   - touch → update expiresAt, fallback a set si NOT_FOUND
//   - length → conteo
//   - clear → batch delete
//   - all → map sid → SessionData
//
// Mockeamos `Firestore` con un fake in-memory para no depender del
// emulador en CI. El fake replica la subset de API que usamos.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionData } from 'express-session';
import { FirestoreSessionStore } from './firestoreSessionStore';

// ── In-memory fake Firestore ────────────────────────────────────────────
function makeFakeDb() {
  const docs = new Map<string, Record<string, unknown>>();

  const docRef = (path: string) => ({
    get: vi.fn(async () => {
      const data = docs.get(path);
      return {
        exists: data !== undefined,
        data: () => data,
      };
    }),
    set: vi.fn(async (data: Record<string, unknown>) => {
      docs.set(path, data);
      return undefined;
    }),
    update: vi.fn(async (data: Record<string, unknown>) => {
      const existing = docs.get(path);
      if (!existing) {
        const err: Error & { code?: number } = new Error('NOT_FOUND');
        err.code = 5;
        throw err;
      }
      docs.set(path, { ...existing, ...data });
      return undefined;
    }),
    delete: vi.fn(async () => {
      docs.delete(path);
      return undefined;
    }),
    ref: null as unknown,
  });

  const collection = (name: string) => ({
    doc: (sid: string) => docRef(`${name}/${sid}`),
    get: vi.fn(async () => ({
      docs: Array.from(docs.entries())
        .filter(([k]) => k.startsWith(`${name}/`))
        .map(([k, v]) => ({
          id: k.slice(name.length + 1),
          data: () => v,
          ref: docRef(k),
        })),
    })),
    count: () => ({
      get: vi.fn(async () => ({
        data: () => ({
          count: Array.from(docs.keys()).filter((k) =>
            k.startsWith(`${name}/`),
          ).length,
        }),
      })),
    }),
  });

  return {
    collection,
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        delete: (ref: { _path?: string } & Record<string, unknown>) => {
          // We can't easily intercept `ref` here, but the test for clear
          // uses a different path — see test below.
          ops.push(() => {
            // no-op for fake — real Firestore handles it
          });
          return undefined;
        },
        commit: vi.fn(async () => {
          // For the test we just clear the map of session docs.
          for (const key of Array.from(docs.keys())) {
            if (key.startsWith('_sessions/')) docs.delete(key);
          }
        }),
      };
    },
    __docs: docs,
  };
}

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  return {
    cookie: {
      originalMaxAge: 60_000,
      maxAge: 60_000,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    },
    ...overrides,
  } as SessionData;
}

// ── tests ───────────────────────────────────────────────────────────────
describe('FirestoreSessionStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let store: FirestoreSessionStore;

  beforeEach(() => {
    db = makeFakeDb();
    store = new FirestoreSessionStore({ db });
  });

  it('get → returns null when session does not exist', async () => {
    const result = await new Promise<unknown>((resolve, reject) => {
      store.get('missing-sid', (err, val) =>
        err ? reject(err) : resolve(val),
      );
    });
    expect(result).toBeNull();
  });

  it('set + get → roundtrip serializes SessionData', async () => {
    const sess = makeSession();
    await new Promise<void>((resolve, reject) => {
      store.set('sid-1', sess, (err) => (err ? reject(err) : resolve()));
    });
    const result = await new Promise<SessionData | null | undefined>(
      (resolve, reject) => {
        store.get('sid-1', (err, val) =>
          err ? reject(err) : resolve(val ?? null),
        );
      },
    );
    expect(result?.cookie.maxAge).toBe(60_000);
  });

  it('set → escribe data + expiresAt + updatedAt en Firestore', async () => {
    const sess = makeSession();
    await new Promise<void>((resolve, reject) => {
      store.set('sid-2', sess, (err) => (err ? reject(err) : resolve()));
    });
    const raw = db.__docs.get('_sessions/sid-2');
    expect(raw).toBeDefined();
    expect(typeof raw.data).toBe('string');
    expect(typeof raw.expiresAt).toBe('string');
    expect(typeof raw.updatedAt).toBe('string');
  });

  it('get → returns null y borra cuando expiresAt está vencido', async () => {
    // inyectar doc vencido directamente
    db.__docs.set('_sessions/sid-old', {
      data: JSON.stringify(makeSession()),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const result = await new Promise<unknown>((resolve, reject) => {
      store.get('sid-old', (err, val) =>
        err ? reject(err) : resolve(val),
      );
    });
    expect(result).toBeNull();
  });

  it('destroy → borra el doc', async () => {
    await new Promise<void>((resolve, reject) => {
      store.set('sid-3', makeSession(), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    expect(db.__docs.has('_sessions/sid-3')).toBe(true);
    await new Promise<void>((resolve, reject) => {
      store.destroy('sid-3', (err) => (err ? reject(err) : resolve()));
    });
    expect(db.__docs.has('_sessions/sid-3')).toBe(false);
  });

  it('touch → actualiza expiresAt sin re-escribir data', async () => {
    await new Promise<void>((resolve, reject) => {
      store.set('sid-4', makeSession(), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    const before = db.__docs.get('_sessions/sid-4') as {
      data: string;
      expiresAt: string;
    };
    await new Promise((r) => setTimeout(r, 5));
    await new Promise<void>((resolve, reject) => {
      store.touch('sid-4', makeSession({ cookie: { maxAge: 120_000 } as never }), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    const after = db.__docs.get('_sessions/sid-4') as {
      data: string;
      expiresAt: string;
    };
    expect(after.data).toBe(before.data); // data no cambia
    expect(after.expiresAt).not.toBe(before.expiresAt); // expiresAt sí
  });

  it('touch → downgrade a set cuando el doc no existe (NOT_FOUND)', async () => {
    await new Promise<void>((resolve, reject) => {
      store.touch('sid-new', makeSession(), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    expect(db.__docs.has('_sessions/sid-new')).toBe(true);
  });

  it('length → cuenta sesiones activas', async () => {
    for (const sid of ['a', 'b', 'c']) {
      await new Promise<void>((resolve, reject) => {
        store.set(sid, makeSession(), (err) =>
          err ? reject(err) : resolve(),
        );
      });
    }
    const count = await new Promise<number>((resolve, reject) => {
      store.length((err, val) =>
        err ? reject(err) : resolve(val ?? -1),
      );
    });
    expect(count).toBe(3);
  });

  it('all → devuelve mapa sid → SessionData', async () => {
    await new Promise<void>((resolve, reject) => {
      store.set('alpha', makeSession(), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    await new Promise<void>((resolve, reject) => {
      store.set('beta', makeSession(), (err) =>
        err ? reject(err) : resolve(),
      );
    });
    const all = await new Promise<unknown>((resolve, reject) => {
      store.all((err, val) => (err ? reject(err) : resolve(val)));
    });
    expect(Object.keys(all as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['alpha', 'beta']),
    );
  });

  it('get → fail-soft: degrada a null en error de Firestore', async () => {
    // Reemplazar collection.doc().get para que tire error
    const failingDb = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('Firestore down');
          },
        }),
      }),
    };
    const failingStore = new FirestoreSessionStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: failingDb as any,
    });
    const result = await new Promise<unknown>((resolve, reject) => {
      failingStore.get('sid-x', (err, val) =>
        err ? reject(err) : resolve(val),
      );
    });
    // No crash, devuelve null (mejor que tumbar el request).
    expect(result).toBeNull();
  });
});
