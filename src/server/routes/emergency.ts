// Praeventio Guard — security item 0.2: extract /api/emergency/notify-brigada
// from server.ts into a dedicated router with three security controls that
// were absent in the inline prototype:
//
//   1. assertProjectMemberFromBody() — verifies the authenticated uid is a
//      member of the projectId in the request body, preventing cross-tenant
//      FCM spam: a worker on project A cannot trigger brigade notifications
//      for project B.
//
//   2. BRIGADE_ROLES gate — only supervisor/gerente/prevencionista/admin may
//      call this endpoint. A worker or visualizador who somehow has a valid
//      token cannot flood FCM or trigger false emergency activations.
//
//   3. brigadeLimiter — 5 notifications per uid per minute caps FCM cost
//      abuse (each multicast send has a per-message cost; an unmetered
//      endpoint is a direct cost vector).
//
// Mounted at `/api/emergency` in server.ts. Final path preserved:
//   • POST /api/emergency/notify-brigada
//
// The role is read from req.user (set by verifyAuth from the Firebase ID
// token's custom claims). The prototype read it from the Firestore member
// document; we continue to support that shape in the FCM token loop below.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { assertProjectMemberFromBody } from '../middleware/assertProjectMemberMiddleware.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../../utils/logger.js';

// 5 brigade notifications per uid per minute — prevents FCM cost abuse.
// Keyed on the authenticated uid (set by verifyAuth) so a single compromised
// token cannot burn through the org's FCM budget. Falls back to IP then
// 'anonymous' purely as a defensive default; under normal flow verifyAuth
// would have rejected the request before this limiter runs.
const brigadeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req: any) => req.user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many brigade notifications — try again in 1 minute' },
});

const BRIGADE_ROLES = ['supervisor', 'gerente', 'prevencionista', 'admin'] as const;

const router = Router();

router.post(
  '/notify-brigada',
  verifyAuth,
  assertProjectMemberFromBody(), // prevents cross-tenant FCM spam
  brigadeLimiter,
  async (req: any, res: any) => {
    const { projectId, emergencyType, message } = req.body as {
      projectId?: string;
      emergencyType?: string;
      message?: string;
    };

    if (!projectId || !emergencyType) {
      return res.status(400).json({ error: 'projectId and emergencyType are required' });
    }

    // Gate by role: only supervisor/gerente/prevencionista/admin may trigger a
    // brigade notification. The role is stamped into the Firebase ID token as a
    // custom claim by /api/admin/set-role; req.user is the decoded token.
    const callerRole: string | undefined = req.user?.role;
    if (!callerRole || !(BRIGADE_ROLES as readonly string[]).includes(callerRole)) {
      return res.status(403).json({ error: 'Insufficient role to trigger brigade notification' });
    }

    try {
      const db = admin.firestore();
      const membersSnap = await db
        .collection('projects')
        .doc(projectId)
        .collection('members')
        .get();

      const tokens: string[] = [];
      for (const memberDoc of membersSnap.docs) {
        const data = memberDoc.data();
        if (BRIGADE_ROLES.includes(data.role) && data.fcmToken) {
          tokens.push(data.fcmToken);
        }
      }

      if (tokens.length === 0) {
        return res.json({ ok: true, notified: 0, message: 'No supervisor tokens found' });
      }

      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: `🚨 Emergencia: ${emergencyType}`,
          body: message ?? `Activación de brigada requerida en proyecto ${projectId}`,
        },
        data: { projectId, emergencyType, timestamp: new Date().toISOString() },
        android: { priority: 'high' },
        apns: { payload: { aps: { 'content-available': 1 } } },
      });

      return res.json({ ok: true, notified: tokens.length });
    } catch (err) {
      logger.error(
        'notify-brigada error',
        err instanceof Error ? err : new Error(String(err)),
      );
      return res.status(500).json({ error: 'Failed to notify brigade' });
    }
  },
);

export { router as emergencyRouter };
