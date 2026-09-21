// Praeventio Guard \u2014 FCM device-token lifecycle for the user doc.
//
// `users/{uid}.fcmTokens[]` accumulates a token every time a device registers
// while signed in. Registration never removes them; only the dedicated
// `DELETE /api/push/unregister` endpoint can drop a single one (which the
// client may never call before signing out).
//
// The only consumer that COULD purge the whole array is the logout path
// (`POST /api/oauth/unlink`), and until [Audit-2026-08-31] it did not.
// That left a real device-disassociation gap: a logged-out uid kept
// receiving pushes on whichever device still held a valid FCM token, and
// the array grew unbounded across logout/login cycles.
//
// This module is the single source of truth for "wipe this user's FCM
// registrations". All logout/account-switch callers MUST route through
// `clearUserFcmTokens` so the contract is testable and audited in one place.
//
// Idempotent: wiping a uid that has no tokens is a no-op (does NOT throw
// a "user not found" error). Best-effort, but propagates failures so the
// logout audit row reflects the outcome.

import { logger } from '../../utils/logger.js';

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

export interface ClearUserFcmTokensResult {
  /** Number of tokens removed. */
  removed: number;
}

/**
 * Removes every entry in `users/{uid}.fcmTokens[]`.
 *
 * Behaviour:
 *   - If the user doc does not exist \u2192 returns `{ removed: 0 }`.
 *   - If `fcmTokens` is empty/absent \u2192 returns `{ removed: 0 }`.
 *   - Otherwise \u2192 sets `fcmTokens: []` atomically via FieldValue.delete()
 *     and stamps `lastTokenUnregisteredAt = serverTimestamp()` so an audit
 *     consumer can correlate the logout with the wipe.
 *
 * Throws on real Firestore failures (network, permission). The caller is
 * expected to wrap in try/catch when the wipe is observability-only and
 * must not break the user-facing logout flow.
 */
export async function clearUserFcmTokens(
  uid: string,
  db: Firestore = getFirestore(),
): Promise<ClearUserFcmTokensResult> {
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new Error('clearUserFcmTokens requires a non-empty uid');
  }
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    return { removed: 0 };
  }
  const data = snap.data() as { fcmTokens?: unknown } | undefined;
  const tokens = Array.isArray(data?.fcmTokens)
    ? (data!.fcmTokens as unknown[]).filter(
        (t): t is string => typeof t === 'string' && t.length > 0,
      )
    : [];
  if (tokens.length === 0) {
    return { removed: 0 };
  }
  await userRef.update({
    fcmTokens: FieldValue.delete(),
    lastTokenUnregisteredAt: FieldValue.serverTimestamp(),
  });
  logger.info?.('fcm.cleared_for_user', { uid, removed: tokens.length });
  return { removed: tokens.length };
}
