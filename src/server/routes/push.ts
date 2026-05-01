// Praeventio Guard — Round 17 R3.
//
// FCM push token registration. Closes the R15/R16 mobile loop: the
// Capacitor push plugin acquires a device token at runtime, then calls
// this endpoint so the server can `arrayUnion` it onto `users/{uid}` for
// targeted notifications (Modo Crisis, alertas de seguridad, recordatorios
// de cumplimiento DS 54/40).
//
// Mounted at `/api/push` in server.ts. Final paths preserved verbatim:
//   • POST /api/push/register-token
//
// Behavior contract (covered by I3 supertest harness — see
// src/__tests__/server/push.test.ts):
//   • 401 when no Bearer / malformed (handled by verifyAuth)
//   • 400 invalid token (empty, non-string, >512 chars)
//   • 400 invalid platform (must be 'ios' | 'android' | 'web')
//   • 200 + arrayUnion write to users/{uid}.fcmTokens + audit_logs row
//   • 500 on Firestore failure
//
// Critical security rule: the audit row records `{ platform }` ONLY. The
// raw FCM token is a credential and MUST NOT land in audit_logs because:
//   1) audit_logs is append-only by firestore.rules — leaking a token there
//      gives anyone with read-audit privileges the ability to push to that
//      device until the token rotates.
//   2) Compliance audits (Ley 16.744) routinely export audit trails — the
//      principle is "log decisions and who/when, not credentials".

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';

const VALID_PLATFORMS = new Set<string>(['ios', 'android', 'web']);

const router = Router();

router.post('/register-token', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;
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

    res.json({ ok: true });
  } catch (error: any) {
    logger.error('push_register_token_failed', {
      uid: callerUid,
      platform,
      message: error?.message,
    });
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

export default router;
