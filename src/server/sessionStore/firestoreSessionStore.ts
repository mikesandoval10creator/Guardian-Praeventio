// Praeventio Guard — Firestore-backed session store para express-session.
//
// Audit report (2026-05-15) flagged que el servidor usa
// `express-session` SIN store persistente → MemoryStore por default.
// En producción multi-instancia (Cloud Run replicas), eso significa que
// el state OAuth Google se pierde entre request y callback si caen en
// pods distintos. Resultado: login OAuth falla con `state mismatch`.
//
// Esta clase reemplaza MemoryStore con un Store backed by Firestore:
//
//   collection `_sessions/{sid}` = {
//     data: serialized SessionData (cookie + custom fields),
//     expiresAt: ISO timestamp (TTL hint)
//   }
//
// Firestore TTL policy debe configurarse server-side sobre el campo
// `expiresAt` para auto-borrar docs vencidos (`gcloud firestore
// ttl-policies create`). Mientras tanto, el `destroy()` y la
// purga periódica del `runMaintenance.ts` cron limpian a mano.
//
// Diseño:
//   - Pure adapter sobre admin.firestore() — no asume Capacitor ni
//     browser globals. Server-only.
//   - Compatible con la interfaz Store de express-session@1
//   - Fail-soft: si Firestore tira error en get/set, NO crashea el
//     request; loggea warn + degrada (sesión inválida → re-login).
//   - Honra `req.session.cookie.maxAge` para calcular expiresAt.

import { Store, type SessionData } from 'express-session';
import type { Firestore } from 'firebase-admin/firestore';

// Codex P2 fix (PR #264, 2026-05-15): Firestore TTL policies SOLO evalúan
// campos de tipo Timestamp — los strings ISO se ignoran, así que sesiones
// nunca leídas no se borrarían automáticamente. Solución: escribir JS Date
// (Firebase Admin SDK auto-convierte Date → Timestamp en wire). Al leer,
// Firestore devuelve Timestamp con `.toDate()` o `.toMillis()` disponibles.
/**
 * Devuelve el timestamp en ms desde un campo expiresAt heredado:
 *   - Date (lo que escribimos hoy)
 *   - Firestore Timestamp { toMillis() } (lo que Firestore Admin devuelve)
 *   - string ISO (legacy de versiones anteriores del store)
 *   - número (epoch ms)
 */
function expiresMs(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'object' && raw !== null && 'toMillis' in raw) {
    try {
      return (raw as { toMillis(): number }).toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

export interface FirestoreSessionStoreOptions {
  /** Firestore Admin instance. */
  db: Firestore;
  /** Collection name. Default `_sessions`. */
  collectionName?: string;
  /** TTL fallback en ms si la session no tiene cookie.maxAge.
   *  Default 24h. */
  defaultTtlMs?: number;
}

type Callback<T = void> = (err: unknown, value?: T) => void;

/**
 * Express-session Store implementado sobre Firestore Admin SDK.
 *
 * Implementa los métodos mínimos requeridos:
 *   - get(sid, cb)
 *   - set(sid, sess, cb)
 *   - destroy(sid, cb)
 *
 * Implementa los opcionales útiles:
 *   - touch(sid, sess, cb) — extiende TTL sin re-escribir todo el payload
 *   - length(cb) — count de sesiones activas (para métricas)
 *   - clear(cb) — borra todas las sesiones (admin only — peligroso)
 *   - all(cb) — list todas las sesiones (admin only)
 */
export class FirestoreSessionStore extends Store {
  private readonly db: Firestore;
  private readonly collectionName: string;
  private readonly defaultTtlMs: number;

  constructor(opts: FirestoreSessionStoreOptions) {
    super();
    this.db = opts.db;
    this.collectionName = opts.collectionName ?? '_sessions';
    this.defaultTtlMs = opts.defaultTtlMs ?? 24 * 60 * 60 * 1000;
  }

  private ref(sid: string) {
    return this.db.collection(this.collectionName).doc(sid);
  }

  /**
   * Devuelve el timestamp como **Date** (no ISO string) — Firestore Admin
   * SDK lo auto-convierte a Timestamp en wire, lo que permite que la
   * Firestore TTL policy lo evalúe y borre docs vencidos automáticamente.
   */
  private computeExpiresAt(sess: SessionData): Date {
    const cookie = sess.cookie;
    let ms: number | null = null;
    if (cookie?.expires) {
      const expires = cookie.expires as Date | string;
      const d = expires instanceof Date ? expires : new Date(expires);
      if (!Number.isNaN(d.getTime())) ms = d.getTime();
    }
    if (ms === null && typeof cookie?.maxAge === 'number') {
      ms = Date.now() + cookie.maxAge;
    }
    if (ms === null) ms = Date.now() + this.defaultTtlMs;
    return new Date(ms);
  }

  // ── get ─────────────────────────────────────────────────────────────
  get(sid: string, callback: Callback<SessionData | null>): void {
    this.ref(sid)
      .get()
      .then((snap) => {
        if (!snap.exists) return callback(null, null);
        const raw = snap.data() as
          | { data?: string; expiresAt?: unknown }
          | undefined;
        if (!raw?.data) return callback(null, null);
        // TTL check defensivo (Firestore TTL puede tardar en correr).
        // `expiresAt` puede llegar como Timestamp/Date/string según source.
        const expMs = expiresMs(raw.expiresAt);
        if (expMs !== null && expMs < Date.now()) {
          // Vencido — fire-and-forget cleanup, devolver null
          this.ref(sid)
            .delete()
            .catch(() => {});
          return callback(null, null);
        }
        try {
          const parsed = JSON.parse(raw.data) as SessionData;
          callback(null, parsed);
        } catch (err) {
          callback(err);
        }
      })
      .catch((err) => {

        console.warn('[FirestoreSessionStore.get] failed:', err);
        // Degradar a "no session" en lugar de tumbar el request.
        callback(null, null);
      });
  }

  // ── set ─────────────────────────────────────────────────────────────
  set(sid: string, sess: SessionData, callback?: Callback): void {
    const serialized = JSON.stringify(sess);
    const expiresAt = this.computeExpiresAt(sess);
    this.ref(sid)
      .set({ data: serialized, expiresAt, updatedAt: new Date() })
      .then(() => callback?.(null))
      .catch((err) => {

        console.warn('[FirestoreSessionStore.set] failed:', err);
        callback?.(err);
      });
  }

  // ── destroy ─────────────────────────────────────────────────────────
  destroy(sid: string, callback?: Callback): void {
    this.ref(sid)
      .delete()
      .then(() => callback?.(null))
      .catch((err) => {

        console.warn('[FirestoreSessionStore.destroy] failed:', err);
        callback?.(err);
      });
  }

  // ── touch ───────────────────────────────────────────────────────────
  // Extiende TTL sin re-escribir el payload completo.
  override touch(sid: string, sess: SessionData, callback?: Callback): void {
    const expiresAt = this.computeExpiresAt(sess);
    this.ref(sid)
      .update({ expiresAt })
      .then(() => callback?.(null))
      .catch((err) => {
        // Si el doc no existe, downgrade a set completo.
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: number }).code === 5 // NOT_FOUND
        ) {
          this.set(sid, sess, callback);
          return;
        }

        console.warn('[FirestoreSessionStore.touch] failed:', err);
        callback?.(err);
      });
  }

  // ── length ──────────────────────────────────────────────────────────
  override length(callback: Callback<number>): void {
    this.db
      .collection(this.collectionName)
      .count()
      .get()
      .then((snap) => callback(null, snap.data().count))
      .catch((err) => callback(err));
  }

  // ── clear ───────────────────────────────────────────────────────────
  // Borra TODAS las sesiones — solo expone para tests/admin.
  // En producción, usar Firestore TTL policy sobre `expiresAt`.
  override clear(callback?: Callback): void {
    (async () => {
      try {
        const snap = await this.db.collection(this.collectionName).get();
        const batch = this.db.batch();
        for (const doc of snap.docs) batch.delete(doc.ref);
        await batch.commit();
        callback?.(null);
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  // ── all ─────────────────────────────────────────────────────────────
  override all(
    callback: Callback<SessionData[] | { [sid: string]: SessionData } | null>,
  ): void {
    this.db
      .collection(this.collectionName)
      .get()
      .then((snap) => {
        const out: { [sid: string]: SessionData } = {};
        for (const doc of snap.docs) {
          const raw = doc.data() as { data?: string } | undefined;
          if (raw?.data) {
            try {
              out[doc.id] = JSON.parse(raw.data) as SessionData;
            } catch {
              /* skip corrupted */
            }
          }
        }
        callback(null, out);
      })
      .catch((err) => callback(err));
  }
}

/**
 * Factory helper — el caller importa esto y lo pasa a `session({store})`.
 * En el setup del server:
 *
 *   import admin from 'firebase-admin';
 *   import session from 'express-session';
 *   import { makeFirestoreSessionStore } from './sessionStore/firestoreSessionStore';
 *
 *   app.use(session({
 *     store: makeFirestoreSessionStore(admin.firestore()),
 *     ...
 *   }));
 *
 * Si Firebase Admin no está inicializado (dev sin credenciales),
 * el caller debe omitir el store — el MemoryStore default es OK para
 * single-process dev.
 */
export function makeFirestoreSessionStore(
  db: Firestore,
  opts?: Omit<FirestoreSessionStoreOptions, 'db'>,
): FirestoreSessionStore {
  return new FirestoreSessionStore({ db, ...opts });
}
