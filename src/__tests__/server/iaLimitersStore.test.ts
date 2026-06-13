// Praeventio Guard — audit ia-limiters-store.
//
// `geminiLimiter`, `b2dFreeLimiter` y `geminiGlobalDailyLimiter` controlan el
// gasto de IA. Antes usaban el MemoryStore default de express-rate-limit, que
// es PER-PROCESO: con N réplicas en Cloud Run el presupuesto efectivo se
// multiplica por N (el cap global "1000/día" se vuelve "1000 × N").
//
// El fix inyecta un store Firestore (transaccional, compartido entre pods) con
// prefijo propio por limiter vía `makeIaRateLimitStore()`. Este test pinea ese
// cableado SIN levantar el emulador: ejercita el factory REAL
// (`makeIaRateLimitStore` → `makeLazyFirestoreRateLimitStore` →
// `FirestoreRateLimitStore`), monta un limiter REAL de express-rate-limit con
// ese store, y verifica con un espía que el `increment()` del store inyectado
// es el camino que express-rate-limit consulta por request — no el MemoryStore.
//
// Por qué un limiter fresco y no los singletons de producción: los singletons
// se construyen al evaluar el módulo, ANTES de que el test pueda alterar el
// entorno, así que ya capturaron su store. Construir un limiter fresco con el
// MISMO factory de producción ejercita el código real de inyección de store.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

import { makeIaRateLimitStore } from '../../server/middleware/limiters.js';
import { FirestoreRateLimitStore } from '../../server/rateLimit/firestoreRateLimitStore.js';

// In-memory fake Firestore — mismo shape que firestoreRateLimitStore.test.ts.
function makeFakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const docRef = (path: string) => ({ _path: path });
  const collection = (name: string) => ({
    doc: (key: string) => docRef(`${name}/${key}`),
  });
  const runTransaction = async <T>(
    fn: (tx: {
      get: (ref: { _path: string }) => Promise<{ data: () => Record<string, unknown> | undefined }>;
      set: (ref: { _path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>,
  ): Promise<T> =>
    fn({
      get: async (ref) => ({ data: () => docs.get(ref._path) }),
      set: (ref, data) => {
        docs.set(ref._path, data);
      },
    });
  return { collection, runTransaction, __docs: docs };
}

function buildApp(limiter: express.RequestHandler, uid: string): Express {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { user?: { uid: string } }).user = { uid };
    next();
  });
  app.use(limiter);
  app.get('/probe', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('IA limiters — Firestore store injection (audit ia-limiters-store)', () => {
  const prevEnv = process.env.PRAEVENTIO_FORCE_IA_FS_STORE;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.PRAEVENTIO_FORCE_IA_FS_STORE = prevEnv;
    process.env.NODE_ENV = prevNodeEnv;
    vi.restoreAllMocks();
  });

  it('returns undefined (MemoryStore fallback) when Admin is not expected (dev)', () => {
    process.env.PRAEVENTIO_FORCE_IA_FS_STORE = '';
    process.env.NODE_ENV = 'test';
    // En dev single-process NO queremos un store Firestore perezoso (fallaría
    // soft en cada request y el limiter nunca dispararía); MemoryStore es lo
    // correcto. El factory lo señaliza devolviendo undefined.
    expect(makeIaRateLimitStore('gemini-uid:')).toBeUndefined();
  });

  it('builds a Firestore-backed store when Admin is expected (prod / forced)', () => {
    process.env.PRAEVENTIO_FORCE_IA_FS_STORE = '1';
    const store = makeIaRateLimitStore('gemini-global:');
    expect(store).toBeInstanceOf(FirestoreRateLimitStore);
  });

  it('the injected store.increment is the code path express-rate-limit consults', async () => {
    process.env.PRAEVENTIO_FORCE_IA_FS_STORE = '1';
    const store = makeIaRateLimitStore('gemini-uid:') as unknown as FirestoreRateLimitStore;
    expect(store).toBeInstanceOf(FirestoreRateLimitStore);

    // Resolver perezoso: el handle real de Firestore se obtiene en el primer
    // increment(). Inyectamos un fake DB ahí para no tocar el emulador.
    const fakeDb = makeFakeDb();
    // @ts-expect-error — sobreescribimos el resolver privado para el test.
    store.getDb = () => fakeDb;

    const incrementSpy = vi.spyOn(store, 'increment');

    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 30,
      store: store as unknown as import('express-rate-limit').Store,
      standardHeaders: true,
      legacyHeaders: false,
    });

    const app = buildApp(limiter, 'spy-uid');
    const res = await request(app).get('/probe');

    expect(res.status).toBe(200);
    // express-rate-limit consultó NUESTRO store (no MemoryStore) en el request.
    expect(incrementSpy).toHaveBeenCalledTimes(1);
    // Y el contador quedó persistido bajo el prefijo del limiter en el fake DB.
    const keys = [...fakeDb.__docs.keys()];
    expect(keys.some((k) => k.includes(encodeURIComponent('gemini-uid:')))).toBe(true);
  });

  it('the injected store enforces the cap (shared counter trips at max)', async () => {
    process.env.PRAEVENTIO_FORCE_IA_FS_STORE = '1';
    const store = makeIaRateLimitStore('cap-test:') as unknown as FirestoreRateLimitStore;
    const fakeDb = makeFakeDb();
    // @ts-expect-error — resolver privado.
    store.getDb = () => fakeDb;

    const limiter = rateLimit({
      windowMs: 60_000,
      max: 2,
      store: store as unknown as import('express-rate-limit').Store,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'capped' },
    });
    const app = buildApp(limiter, 'cap-uid');

    expect((await request(app).get('/probe')).status).toBe(200);
    expect((await request(app).get('/probe')).status).toBe(200);
    // 3rd request trips the cap — proves the injected store's count is what
    // express-rate-limit reads (a no-op store would never 429).
    expect((await request(app).get('/probe')).status).toBe(429);
  });
});
