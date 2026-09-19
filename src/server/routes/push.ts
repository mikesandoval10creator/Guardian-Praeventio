// Praeventio Guard — Round 17 R3.
//
// FCM push token registration & lifecycle. Closes the R15/R16 mobile loop:
// the Capacitor push plugin acquires a device token at runtime, then calls
// this endpoint so the server can `arrayUnion` it onto `users/{uid}` for
// targeted notifications (Modo Crisis, alertas de seguridad, recordatorios
// de cumplimiento; el DS 44/2024 reemplaza a los ex DS 54 y ex DS 40,
// derogados 01-02-2025).
//
// Mounted at `/api/push` in server.ts. Final paths preserved verbatim:
//   • POST /api/push/register-token
//   • POST /api/push/unregister-token
//
// Behavior contract (covered by I3 supertest harness — see
// src/__tests__/server/push.test.ts):
//   • 401 when no Bearer / malformed (handled by verifyAuth)
//   • 400 invalid token (empty, non-string, >512 chars)
//   • 400 invalid platform (must be 'ios' | 'android' | 'web')
//   • 200 + arrayUnion write to users/{uid}.fcmTokens + audit_logs row
//   • 200 + arrayRemove write to users/{uid}.fcmTokens + audit_logs row
//   • 500 on Firestore failure
//
// Critical security rule: the audit row records `{ platform }` ONLY. The
// raw FCM token is a credential and MUST NOT land in audit_logs because:
//   1) audit_logs is append-only by firestore.rules — leaking a token there
//      gives anyone with read-audit privileges the ability to push to that
//      device until the token rotates.
//   2) Compliance audits (Ley 16.744) routinely export audit trails — the
//      principle is "log decisions and who/when, not credentials".
//
// P0 safety rationale for /unregister-token (Audit-2026-08-31):
// Without an unregister endpoint, fcmTokens[] on users/{uid} grows forever
// across logout, account-switch and device-wipe events. Two distinct P0
// hazards follow:
//   1. Cross-tenant push leakage: when a user A logs out and user B signs
//      in on the same device, A's emergency fan-outs still reach the device
//      because B's user doc only contains B's tokens — A's tokens remain
//      bound to the same physical device, and the cache in
//      src/server/routes/emergency.ts continues to hand them out for up to
//      5 minutes (USER_TOKEN_CACHE_TTL_MS).
//   2. Post-logout push retention: even on a single-user device, after the
//      user logs out, emergency pushes keep arriving to a session that no
//      longer exists — a privacy + compliance hazard for Ley 16.744 audit
//      trails.
//
// /unregister-token is the symmetric primitive that closes both: it
// `arrayRemove`s the token from users/{uid}.fcmTokens and drops the in-
// process caches in emergency.ts and projectTokens.ts so the next fan-out
// reads the canonical state. Idempotent: removing a token that was never
// registered returns 200 with no audit row (avoids spurious traffic from
// clients retrying).

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { __clearUserTokenCache } from './emergency.js';
import { __clearProjectTokenCache } from '../services/projectTokens.js';

const VALID_PLATFORMS = new Set<string>(['ios', 'android', 'web']);

const router = Router();

router.post('/register-token', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail: string | null = req.user!.email ?? null;
  const { token, platform } = req.body ?? {};

  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  if (typeof platform !== 'string' || !VALID_PLATFORMS.has(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  try {
    await admin
      .firestore()
      .collection('users')
      .doc(callerUid)
      .set(
        {
          fcmTokens: admin.firestore.FieldValue.arrayUnion(token),
          lastTokenRegisteredAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    // Audit trail — see audit_logs schema notes in server.ts. We deliberately
    // log `{ platform }` and NOT the token (see header comment).
    await admin.firestore().collection('audit_logs').add({
      action: 'push.token.registered',
      module: 'push',
      details: { platform },
      userId: callerUid,
      userEmail: callerEmail,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    return res.json({ ok: true });
  } catch (error: any) {
    logger.error('push_register_token_failed', {
      uid: callerUid,
      platform,
      message: error?.message,
    });
    captureRouteError(error, 'push.register_token', { uid: callerUid, platform });
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// Companion to /register-token — symmetric primitive that closes the P0
// hazards documented in the file header (cross-tenant push leakage on
// logout / account-switch). Mirrors register-token's auth and validation
// contract. Idempotent: removing a token not present in fcmTokens[] is
// a 200 no-op with no audit row.
router.post('/unregister-token', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail: string | null = req.user!.email ?? null;
  const { token, platform } = req.body ?? {};

  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  if (typeof platform !== 'string' || !VALID_PLATFORMS.has(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }

  const userRef = admin.firestore().collection('users').doc(callerUid);

  try {
    // Read-then-write vs arrayRemove: we want idempotency (no audit row
    // when the token wasn't registered) AND we need to drop the in-process
    // caches only when we actually changed state. A naive arrayRemove would
    // write a delete event to audit_logs even for never-registered tokens,
    // which would flood the audit table from clients retrying unregister.
    const snap = await userRef.get();
    const existing: string[] = Array.isArray((snap.data() as { fcmTokens?: unknown } | undefined)?.fcmTokens)
      ? ((snap.data() as { fcmTokens?: unknown }).fcmTokens as unknown[]).filter(
          (t): t is string => typeof t === 'string' && t.length > 0,
        )
      : [];
    if (!existing.includes(token)) {
      // Idempotent: token wasn't registered. No state change, no audit row,
      // no cache invalidation needed.
      return res.json({ ok: true });
    }

    await userRef.set(
      {
        fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
        lastTokenUnregisteredAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Audit row — same security rule as register-token: `{ platform }` only,
    // NEVER the raw FCM token (see header comment).
    await admin.firestore().collection('audit_logs').add({
      action: 'push.token.unregistered',
      module: 'push',
      details: { platform },
      userId: callerUid,
      userEmail: callerEmail,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    // Drop the in-process TTL caches that route/emergency.ts and
    // services/projectTokens.ts maintain. Without this, a fan-out within
    // USER_TOKEN_CACHE_TTL_MS (5 min) would still see the unregistered
    // token and push to a device the user has explicitly revoked.
    __clearUserTokenCache();
    __clearProjectTokenCache();

    return res.json({ ok: true });
  } catch (error: any) {
    logger.error('push_unregister_token_failed', {
      uid: callerUid,
      platform,
      message: error?.message,
    });
    captureRouteError(error, 'push.unregister_token', { uid: callerUid, platform });
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

export default router;
