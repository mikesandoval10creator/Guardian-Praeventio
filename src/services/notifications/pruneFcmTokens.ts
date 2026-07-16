// Praeventio Guard — prune definitively-dead FCM tokens.
//
// The FCM adapter returns `invalidTokens` (tokens FCM reported as permanently
// dead: unregistered / malformed). Registration only ever `arrayUnion`s tokens,
// so without this consumer `users/{uid}.fcmTokens` grows unbounded with stale
// entries — inflating write cost, the failure rate, and eventually pushing a
// fan-out over the FCM 500-token cap. This removes each dead token from every
// user doc that still carries it.
//
// Best-effort by contract: a prune failure must NEVER break the notification
// path, so callers can `void` this or await it inside a try/catch. Idempotent —
// arrayRemove of an absent token is a no-op.

import admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';

/**
 * Removes each token in `invalidTokens` from every `users/{uid}.fcmTokens`
 * array that contains it. Returns the number of (user, token) removals applied.
 */
export async function pruneFcmTokens(
  db: admin.firestore.Firestore,
  invalidTokens: string[],
): Promise<number> {
  if (!Array.isArray(invalidTokens) || invalidTokens.length === 0) return 0;
  const unique = Array.from(
    new Set(invalidTokens.filter((t) => typeof t === 'string' && t.length > 0)),
  );
  let removed = 0;
  for (const token of unique) {
    try {
      const snap = await db
        .collection('users')
        .where('fcmTokens', 'array-contains', token)
        .get();
      for (const doc of snap.docs) {
        await doc.ref.update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
        });
        removed += 1;
      }
    } catch (err) {
      // Observability, never a throw — pruning is opportunistic cleanup.
      logger.warn?.('fcm.prune.token_failed', { message: (err as Error)?.message });
    }
  }
  return removed;
}
