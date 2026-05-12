// Praeventio Guard — Sprint 39: Auto-expire de work_permits vencidos.
//
// Mismo patrón que runExceptionAutoExpire: el motor puro
// (workPermitEngine.deriveStatus) maneja la transición lógica, pero
// los docs persisten su status original hasta que un cron los
// materializa.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';

export interface WorkPermitAutoExpireDeps {
  db: admin.firestore.Firestore;
  now?: () => Date;
  /** Default 'work_permits' (legacy); tenant-scoped:
   *  `tenants/{tid}/projects/{pid}/work_permits`. */
  collectionPath?: string;
  notifyExpired?: (
    docId: string,
    doc: { workerUid?: string; kind?: string; validUntil?: string },
  ) => Promise<void>;
}

export interface WorkPermitAutoExpireResult {
  scanned: number;
  expired: number;
  errors: number;
  startedAtIso: string;
  finishedAtIso: string;
}

export async function runWorkPermitAutoExpire(
  deps: WorkPermitAutoExpireDeps,
): Promise<WorkPermitAutoExpireResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const result: WorkPermitAutoExpireResult = {
    scanned: 0,
    expired: 0,
    errors: 0,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: '',
  };

  const collection = deps.collectionPath ?? 'work_permits';
  const nowIso = now().toISOString();

  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await deps.db
      .collection(collection)
      .where('status', '==', 'active')
      .where('validUntil', '<', nowIso)
      .get();
  } catch (e) {
    logger.warn?.('work_permit_expire.scan_failed', { collection, err: String(e) });
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
            expiredBy: 'cron.runWorkPermitAutoExpire',
          },
          { merge: true },
        );
      result.expired += 1;

      if (deps.notifyExpired) {
        try {
          const data = doc.data() as { workerUid?: string; kind?: string; validUntil?: string };
          await deps.notifyExpired(doc.id, data);
        } catch (e) {
          logger.warn?.('work_permit_expire.notify_failed', { id: doc.id, err: String(e) });
        }
      }
    } catch (e) {
      logger.warn?.('work_permit_expire.write_failed', { id: doc.id, err: String(e) });
      result.errors += 1;
    }
  }

  result.finishedAtIso = now().toISOString();
  return result;
}
