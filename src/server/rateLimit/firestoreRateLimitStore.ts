// Praeventio Guard — Firestore-backed rate limit store para express-rate-limit.
//
// Audit (2026-05-15) flagged que `express-rate-limit` usa MemoryStore default,
// que NO sirve en Cloud Run multi-replica: cada pod tiene su propio contador,
// así que un atacante distribuido sobre N pods obtiene N× el límite real.
//
// Esta clase implementa la interfaz `Store` de express-rate-limit@8 sobre
// Firestore Admin. Colección `_rate_limits/{key}` = {
//   count: number,
//   resetAt: ISO timestamp,
//   updatedAt: ISO timestamp
// }
//
// Firestore TTL policy debe correr sobre `resetAt` para que docs vencidos
// se borren server-side (no necesitamos reaper manual — Firestore TTL es
// suficiente).
//
// Diseño:
//   - Atomicidad: usa transaction() para increment + check, no read-modify-write
//   - Fail-soft: si Firestore tira error, el request PASA (deny-on-error
//     tumbaría la app entera si la DB se cae). Es trade-off de availability.
//   - Compatible con express-rate-limit v7 y v8 (la interfaz no cambió).
//   - `windowMs` se setea desde el limiter al crear el store via init().

import type { Firestore } from 'firebase-admin/firestore';

export interface FirestoreRateLimitStoreOptions {
  /**
   * Firestore Admin instance. Pásalo cuando el handle ya está disponible al
   * construir el store (caso de los limiters montados desde `server.ts`, que
   * corre DESPUÉS de `admin.initializeApp()`).
   *
   * Para limiters construidos en module-load (p.ej. `src/server/middleware/
   * limiters.ts`, importado vía routers ANTES de que `server.ts` inicialice
   * Admin) usa `getDb` en su lugar — resuelve el handle perezosamente, en el
   * primer `increment()`, cuando Admin ya está listo. Da exactamente uno de
   * los dos: `db` o `getDb`.
   */
  db?: Firestore;
  /**
   * Resolver perezoso del handle Firestore. Se invoca (y memoiza) en el primer
   * acceso real a la DB, no al construir el store. Necesario cuando el limiter
   * se crea antes de `admin.initializeApp()` por orden de imports ESM.
   */
  getDb?: () => Firestore;
  /** Collection name. Default `_rate_limits`. */
  collectionName?: string;
  /** Prefix para evitar colisiones si se montan varios limiters. */
  prefix?: string;
}

/**
 * Resultado de un increment — formato esperado por express-rate-limit.
 */
export interface IncrementResponse {
  /** Total de hits en la ventana actual. */
  totalHits: number;
  /** Cuándo expira la ventana (Date para v7+). */
  resetTime: Date;
}

/**
 * Store de express-rate-limit backed by Firestore.
 *
 * Implementa los métodos requeridos por la interfaz Store v7+:
 *   - init(options) — recibe windowMs del limiter
 *   - increment(key) — incrementa contador y devuelve totalHits + resetTime
 *   - decrement(key) — decrementa (cuando skipFailedRequests/skipSuccessfulRequests)
 *   - resetKey(key) — borra contador específico
 *   - resetAll() — borra todos los contadores (admin only)
 */
export class FirestoreRateLimitStore {
  /** Handle eager (si se pasó `db`) o memoizado tras resolver `getDb`. */
  private dbHandle: Firestore | undefined;
  private readonly getDb: (() => Firestore) | undefined;
  private readonly collectionName: string;
  private readonly prefix: string;
  private windowMs: number = 60_000; // default 1 min, override desde init()

  /** Express-rate-limit verifica esta property para detectar stores async. */
  readonly localKeys = false;

  constructor(opts: FirestoreRateLimitStoreOptions) {
    if (!opts.db && !opts.getDb) {
      throw new Error(
        'FirestoreRateLimitStore: pasa `db` (handle eager) o `getDb` (resolver perezoso).',
      );
    }
    this.dbHandle = opts.db;
    this.getDb = opts.getDb;
    this.collectionName = opts.collectionName ?? '_rate_limits';
    this.prefix = opts.prefix ?? '';
  }

  /**
   * Resuelve (y memoiza) el handle Firestore. Para el caso `getDb`, el handle
   * NO existe al construir el store —se resuelve aquí, en el primer acceso
   * real, cuando `admin.initializeApp()` ya corrió. Una vez resuelto se cachea.
   */
  private get db(): Firestore {
    if (!this.dbHandle) {
      if (!this.getDb) {
        throw new Error('FirestoreRateLimitStore: no Firestore handle available.');
      }
      this.dbHandle = this.getDb();
    }
    return this.dbHandle;
  }

  /**
   * Express-rate-limit llama init() al montar el middleware, pasándole
   * las opciones del limiter (incluyendo windowMs). Lo guardamos para
   * calcular resetAt correctamente.
   */
  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  /**
   * Codex P1 fix (PR #264, 2026-05-15): Firestore doc IDs no aceptan `/`
   * (lo interpreta como path separator → nested doc → throw). Las keys
   * de rate-limiter pueden contener slash:
   *   - IPv6 + ipKeyGenerator() produce CIDR como "2001:db8::/64" → tiene `/`
   *   - Multi-tenant keys como "tid/uid" también
   * Sin encoding, `.doc(key)` con slash crearía un nested path, throwearía,
   * y el fail-soft devolvería totalHits:1 → IPv6 clients nunca se throttle.
   * encodeURIComponent garantiza un doc ID válido para cualquier key.
   */
  private encodeKey(key: string): string {
    return encodeURIComponent(`${this.prefix}${key}`);
  }

  private ref(key: string) {
    return this.db.collection(this.collectionName).doc(this.encodeKey(key));
  }

  /**
   * Convierte un campo `resetAt` heredado (Date | Timestamp | string | number)
   * a ms desde epoch. Mantiene backward compat con docs antiguos que
   * tenían ISO strings.
   */
  private toMillis(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    }
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw === 'object' && 'toMillis' in raw) {
      try {
        return (raw as { toMillis(): number }).toMillis();
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Incrementa el contador atomically. Si la ventana venció, resetea
   * a 1 con un nuevo resetAt. Usa Firestore transaction para evitar
   * race conditions entre pods.
   */
  /**
   * Codex P2 fix (PR #264, 2026-05-15): Firestore TTL solo evalúa campos
   * Timestamp; ISO string se ignora. Conversión: JS Date → Firestore
   * Admin SDK auto-convierte a Timestamp en wire. Backward compat para
   * docs antiguos que llegaron como string vía `expiresMs` helper.
   */
  async increment(key: string): Promise<IncrementResponse> {
    try {
      const ref = this.ref(key);
      const now = Date.now();
      const result = await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as
          | { count?: number; resetAt?: unknown }
          | undefined;

        let count: number;
        let resetAtMs: number;

        const prevResetMs = data ? this.toMillis(data.resetAt) : null;
        if (!data || prevResetMs === null || prevResetMs < now) {
          // Nueva ventana — empezar en 1
          count = 1;
          resetAtMs = now + this.windowMs;
        } else {
          // Ventana activa — incrementar
          count = (data.count ?? 0) + 1;
          resetAtMs = prevResetMs;
        }

        tx.set(ref, {
          count,
          // JS Date → Firestore Timestamp en wire → TTL policy lo evalúa
          resetAt: new Date(resetAtMs),
          updatedAt: new Date(now),
        });

        return { count, resetAtMs };
      });

      return {
        totalHits: result.count,
        resetTime: new Date(result.resetAtMs),
      };
    } catch (err) {
      // Fail-soft: en error Firestore, dejar pasar el request (1 hit ficticio).
      // Mejor que tumbar la app si la DB se cae temporalmente.

      console.warn(
        '[FirestoreRateLimitStore.increment] failed, allowing request:',
        err,
      );
      return {
        totalHits: 1,
        resetTime: new Date(Date.now() + this.windowMs),
      };
    }
  }

  /**
   * Decrementa el contador (usado por express-rate-limit cuando
   * skipSuccessfulRequests/skipFailedRequests está activo).
   */
  async decrement(key: string): Promise<void> {
    try {
      const ref = this.ref(key);
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as { count?: number } | undefined;
        if (!data || (data.count ?? 0) <= 0) return;
        tx.update(ref, {
          count: (data.count ?? 0) - 1,
          updatedAt: new Date(),
        });
      });
    } catch (err) {

      console.warn('[FirestoreRateLimitStore.decrement] failed:', err);
    }
  }

  /**
   * Resetea el contador de una key específica (admin / testing).
   */
  async resetKey(key: string): Promise<void> {
    try {
      await this.ref(key).delete();
    } catch (err) {

      console.warn('[FirestoreRateLimitStore.resetKey] failed:', err);
    }
  }

  /**
   * Resetea TODOS los contadores. Solo para admin/tests.
   */
  async resetAll(): Promise<void> {
    try {
      const snap = await this.db.collection(this.collectionName).get();
      const batch = this.db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
    } catch (err) {

      console.warn('[FirestoreRateLimitStore.resetAll] failed:', err);
    }
  }
}

/**
 * Factory helper — el caller importa esto y lo pasa a `rateLimit({store})`.
 *
 *   import rateLimit from 'express-rate-limit';
 *   import admin from 'firebase-admin';
 *   import { makeFirestoreRateLimitStore } from './rateLimit/firestoreRateLimitStore';
 *
 *   const limiter = rateLimit({
 *     windowMs: 15 * 60 * 1000,
 *     max: 100,
 *     store: makeFirestoreRateLimitStore(admin.firestore(), { prefix: 'api:' }),
 *   });
 *
 * Si Firebase Admin NO está inicializado (dev sin credenciales), el caller
 * debe omitir `store` — la MemoryStore default es OK para single-process dev.
 */
export function makeFirestoreRateLimitStore(
  db: Firestore,
  opts?: Omit<FirestoreRateLimitStoreOptions, 'db' | 'getDb'>,
): FirestoreRateLimitStore {
  return new FirestoreRateLimitStore({ db, ...opts });
}

/**
 * Variante de `makeFirestoreRateLimitStore` para limiters construidos en
 * module-load, ANTES de que `admin.initializeApp()` corra.
 *
 * Caso de uso: `src/server/middleware/limiters.ts` exporta singletons creados
 * al evaluar el módulo. Los routers que los importan (gemini, b2d) son imports
 * estáticos en `server.ts`, así que su árbol de módulos se evalúa ANTES del
 * cuerpo top-level de `server.ts` —donde vive `admin.initializeApp()`. Pasar
 * `admin.firestore()` eager ahí devolvería un handle inválido (o `apps.length`
 * todavía 0). Este factory difiere la resolución del handle al primer
 * `increment()` (per-request), cuando Admin ya está inicializado.
 *
 *   const store = makeLazyFirestoreRateLimitStore(
 *     () => admin.firestore(),
 *     { prefix: 'gemini:' },
 *   );
 *   export const geminiLimiter = rateLimit({ ..., store });
 */
export function makeLazyFirestoreRateLimitStore(
  getDb: () => Firestore,
  opts?: Omit<FirestoreRateLimitStoreOptions, 'db' | 'getDb'>,
): FirestoreRateLimitStore {
  return new FirestoreRateLimitStore({ getDb, ...opts });
}
