// Praeventio Guard — Sprint 39 Fase B.2.
//
// User lifecycle helpers. Currently exposes a single helper:
// `deactivateUser(uid)` which:
//
//   1. Revokes all current refresh tokens via `admin.auth().revokeRefreshTokens`.
//      This bumps `tokensValidAfterTime` on the user record. Combined with
//      the `verifyIdToken(token, true)` call in `verifyAuth.ts`, every
//      previously-issued ID token is rejected on its next API request
//      (within seconds, no need to wait the 1h natural expiry).
//
//   2. Sets the custom claim `role: 'inactive'` + `revokedAt: <epoch ms>`
//      so any client-side guard (e.g. Firestore rules `request.auth.token.role`)
//      also sees the deactivation immediately on the next ID-token refresh.
//
// Closes:
//   - IMPLEMENTATION_ROADMAP §0.6 (riesgo activo: ex-empleados con acceso
//     hasta la expiración del token actual, hasta 1h por defecto).
//
// Why a separate service module?
//   - `verifyAuth.ts` is request-scoped middleware. Token revocation is
//     event-driven (triggered by HR firing a worker, admin deactivation,
//     or a security incident handler). Keeping the helper independent
//     lets it be called from background triggers, admin endpoints, or
//     ad-hoc ops scripts without dragging in middleware concerns.
//   - Testable in isolation: the helper takes the admin module as a DI
//     param so unit tests can inject a fake.

import type admin from 'firebase-admin';

export interface DeactivateUserResult {
  uid: string;
  revokedAt: number;
  /** True if the user existed and was modified; false if not found. */
  applied: boolean;
}

export interface DeactivateUserOptions {
  /**
   * Optional reason for audit logging (passed to logger.warn). Not stored
   * in custom claims — claims are user-visible via ID token, so we keep
   * them minimal.
   */
  reason?: string;
}

/**
 * Deactivate a user immediately: revoke refresh tokens + tag custom claims.
 *
 * The caller is responsible for any additional Firestore bookkeeping
 * (marking `users/{uid}.status = 'inactive'`, sending farewell emails,
 * etc.). This helper is intentionally narrow — it does only what no other
 * code path can replicate (token-level revocation).
 */
export async function deactivateUser(
  authAdmin: typeof admin.auth,
  uid: string,
  opts: DeactivateUserOptions = {},
): Promise<DeactivateUserResult> {
  if (!uid || typeof uid !== 'string') {
    throw new TypeError('deactivateUser: uid is required and must be a string');
  }

  const revokedAt = Date.now();

  // Step 1: revoke refresh tokens. This is the actual security gate —
  // bumps tokensValidAfterTime on the user record, which the
  // `verifyIdToken(token, true)` call in verifyAuth checks.
  await authAdmin().revokeRefreshTokens(uid);

  // Step 2: tag custom claims so downstream guards (Firestore rules,
  // server-side role checks) see the deactivation. The next ID-token
  // refresh by the client picks these up automatically.
  //
  // We deliberately do NOT preserve prior claims here — the user is
  // being deactivated; their prior role is irrelevant for any further
  // authorization decision. If a re-activation flow needs the old role,
  // it should be persisted to Firestore (audit_logs / user_history)
  // BEFORE calling this helper.
  await authAdmin().setCustomUserClaims(uid, {
    role: 'inactive',
    revokedAt,
  });

  return { uid, revokedAt, applied: true };
}
