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
  /** Firestore Admin instance. */
  db: Firestore;
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
  private readonly db: Firestore;
  private readonly collectionName: string;
  private readonly prefix: string;
  private windowMs: number = 60_000; // default 1 min, override desde init()

  /** Express-rate-limit verifica esta property para detectar stores async. */
  readonly localKeys = false;

  constructor(opts: FirestoreRateLimitStoreOptions) {
    this.db = opts.db;
    this.collectionName = opts.collectionName ?? '_rate_limits';
    this.prefix = opts.prefix ?? '';
  }

  /**
   * Express-rate-limit llama init() al montar el middleware, pasándole
   * las opciones del limiter (incluyendo windowMs). Lo guardamos para
   * calcular resetAt correctamente.
   */
  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  private ref(key: string) {
    return this.db
      .collection(this.collectionName)
      .doc(`${this.prefix}${key}`);
  }

  /**
   * Incrementa el contador atomically. Si la ventana venció, resetea
   * a 1 con un nuevo resetAt. Usa Firestore transaction para evitar
   * race conditions entre pods.
   */
  async increment(key: string): Promise<IncrementResponse> {
    try {
      const ref = this.ref(key);
      const now = Date.now();
      const result = await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() as
          | { count?: number; resetAt?: string }
          | undefined;

        let count: number;
        let resetAt: string;

        if (
          !data ||
          !data.resetAt ||
          new Date(data.resetAt).getTime() < now
        ) {
          // Nueva ventana — empezar en 1
          count = 1;
          resetAt = new Date(now + this.windowMs).toISOString();
        } else {
          // Ventana activa — incrementar
          count = (data.count ?? 0) + 1;
          resetAt = data.resetAt;
        }

        tx.set(ref, {
          count,
          resetAt,
          updatedAt: new Date(now).toISOString(),
        });

        return { count, resetAt };
      });

      return {
        totalHits: result.count,
        resetTime: new Date(result.resetAt),
      };
    } catch (err) {
      // Fail-soft: en error Firestore, dejar pasar el request (1 hit ficticio).
      // Mejor que tumbar la app si la DB se cae temporalmente.
      // eslint-disable-next-line no-console
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
          updatedAt: new Date().toISOString(),
        });
      });
    } catch (err) {
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
  opts?: Omit<FirestoreRateLimitStoreOptions, 'db'>,
): FirestoreRateLimitStore {
  return new FirestoreRateLimitStore({ db, ...opts });
}
