// Praeventio Guard — Sprint 39: Auto-expire de excepciones.
//
// El exceptionEngine.ts deriva estado a partir de validUntil pero
// NO modifica los docs en Firestore. Este cron mira /exceptions
// (o /tenants/{tid}/projects/{pid}/exceptions) y "materializa" el
// estado expirado escribiendo status='expired' en los docs
// status='active' cuyo validUntil ya pasó.
//
// Importante para que las queries de UI puedan filtrar
// WHERE status == 'active' sin re-derivar siempre.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';

export interface ExceptionAutoExpireDeps {
  db: admin.firestore.Firestore;
  /** Override clock para tests. */
  now?: () => Date;
  /** Collection path. Default 'exceptions' (legacy global). Tenant-scoped
   *  override = `tenants/${tid}/projects/${pid}/exceptions`. */
  collectionPath?: string;
  /** Hook opcional para notificar al subject cuando se expira. */
  notifyExpired?: (docId: string, doc: { subjectRef?: unknown; validUntil?: string }) => Promise<void>;
}

export interface ExceptionAutoExpireResult {
  scanned: number;
  expired: number;
  errors: number;
  startedAtIso: string;
  finishedAtIso: string;
}

export async function runExceptionAutoExpire(
  deps: ExceptionAutoExpireDeps,
): Promise<ExceptionAutoExpireResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const result: ExceptionAutoExpireResult = {
    scanned: 0,
    expired: 0,
    errors: 0,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: '',
  };

  const collection = deps.collectionPath ?? 'exceptions';
  const nowIso = now().toISOString();

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await deps.db
      .collection(collection)
      .where('status', '==', 'active')
      .where('validUntil', '<', nowIso)
      .get();
  } catch (e) {
    logger.warn?.('exception_expire.scan_failed', { collection, err: String(e) });
    result.errors += 1;
    result.finishedAtIso = now().toISOString();
    return result;
  }

  result.scanned = snap.size;

  for (const doc of snap.docs) {
    try {
      await deps.db
        .collection(collection)
        .doc(doc.id)
        .set(
          {
            status: 'expired',
            expiredAt: nowIso,
            expiredBy: 'cron.runExceptionAutoExpire',
          },
          { merge: true },
        );
      result.expired += 1;

      if (deps.notifyExpired) {
        try {
          const data = doc.data() as { subjectRef?: unknown; validUntil?: string };
          await deps.notifyExpired(doc.id, data);
        } catch (e) {
          logger.warn?.('exception_expire.notify_failed', { id: doc.id, err: String(e) });
        }
      }
    } catch (e) {
      logger.warn?.('exception_expire.write_failed', { id: doc.id, err: String(e) });
      result.errors += 1;
    }
  }

  result.finishedAtIso = now().toISOString();
  return result;
}
