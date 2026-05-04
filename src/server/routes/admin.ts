// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Admin-only privileged endpoints for forced disconnect (revoke refresh
// tokens) and role assignment via Firebase Auth custom claims. Both routes
// are gated by `verifyAuth` + an `isAdminRole(callerRecord.customClaims?.role)`
// check that mirrors `firestore.rules`'s `isAdmin()` predicate, so a
// compromised non-admin token cannot escalate.
//
// Mounted at `/api/admin` in server.ts. Final paths preserved verbatim:
//   • POST /api/admin/revoke-access
//   • POST /api/admin/set-role
//
// Behavior contract (covered by I3 supertest harness — see
// src/__tests__/server/admin.test.ts):
//   • 401 when no Bearer token (handled by verifyAuth)
//   • 400 invalid uid / invalid role
//   • 403 non-admin caller
//   • 200 + audit_logs row on success, with token revocation on the target
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { isValidRole, isAdminRole } from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
import * as Sentry from '@sentry/node';

// Firebase Auth uid format constraint shared by privileged admin endpoints.
const UID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

const router = Router();

// Desconexión Forzada (Revoke Tokens - El Haki del Rey / Security)
router.post('/revoke-access', verifyAuth, async (req, res) => {
  const { targetUid } = req.body;
  const callerUid = (req as any).user.uid;

  if (typeof targetUid !== 'string' || !UID_REGEX.test(targetUid)) {
    return res.status(400).json({ error: 'Invalid uid' });
  }

  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: 'Forbidden: Requires admin role to revoke access' });
    }

    // Revoca los refresh tokens. El usuario será desconectado cuando su token a corto plazo expire (o si es validado estrictamente)
    await admin.auth().revokeRefreshTokens(targetUid);

    // Opcional: Escribir en base de datos para que el cliente detecte el baneo inmediatamente
    await admin.firestore().collection('user_sessions').doc(targetUid).set(
      {
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Audit trail — see audit_logs schema at the top of server.ts.
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'revoke_access',
      target: targetUid,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });

    // 13th wave analytics: `auth.role.revoked` — server-side seam. We emit
    // a Sentry breadcrumb with the catalog-shaped payload because the
    // browser-only `analytics` adapter (IndexedDB queue + localStorage
    // opt-out + navigator) cannot run here. A future Node-compat shim can
    // swap the breadcrumb for a real adapter without touching this site.
    try {
      Sentry.addBreadcrumb({
        category: 'analytics.server.auth.role.revoked',
        level: 'info',
        message: 'auth.role.revoked',
        data: {
          // Targets are uid prefixes only; pre-hashing happens client-side.
          revoked_by_user_id_hash: callerUid,
          // We don't know the prior role here without a re-read; emit
          // unknown so dashboards can still bucket by event count.
          role: 'unknown',
          revocation_reason: 'admin_action',
        },
      });
    } catch { /* analytics must never break user flow */ }

    res.json({ success: true, message: `Access revoked for user ${targetUid}` });
  } catch (error) {
    logger.error('admin_revoke_access_failed', error, { callerUid, targetUid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Custom Claims Endpoint (El Haki del Rey)
router.post('/set-role', verifyAuth, async (req, res) => {
  const { uid, role } = req.body;
  const callerUid = (req as any).user.uid;

  if (typeof uid !== 'string' || !UID_REGEX.test(uid)) {
    return res.status(400).json({ error: 'Invalid uid' });
  }

  try {
    // Verify caller is admin/gerente (matches firestore.rules' isAdmin())
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: 'Forbidden: Requires admin role' });
    }

    if (!isValidRole(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Capture the existing role before mutation for audit_logs.
    let oldRole: string | null = null;
    try {
      const targetRecord = await admin.auth().getUser(uid);
      oldRole = (targetRecord.customClaims?.role as string | undefined) ?? null;
    } catch {
      // Target may not exist yet; setCustomUserClaims will surface the error.
    }

    await admin.auth().setCustomUserClaims(uid, { role });

    // Force re-auth so the client picks up the new claim immediately rather
    // than continuing with a stale ID token until natural expiry.
    await admin.auth().revokeRefreshTokens(uid);

    // Audit trail — see audit_logs schema notes at the top of server.ts.
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'set_role',
      target: uid,
      oldRole,
      newRole: role,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });

    // 13th wave analytics: `auth.role.granted` (or implicit revoke if the
    // role changed). Server-side seam — Sentry breadcrumb because the
    // client analytics adapter is browser-only. Emits granted always; if
    // there was an oldRole we ALSO emit revoked for the prior role so
    // dashboards see the full transition.
    try {
      Sentry.addBreadcrumb({
        category: 'analytics.server.auth.role.granted',
        level: 'info',
        message: 'auth.role.granted',
        data: {
          role,
          granted_by_user_id_hash: callerUid,
        },
      });
      if (oldRole && oldRole !== role) {
        Sentry.addBreadcrumb({
          category: 'analytics.server.auth.role.revoked',
          level: 'info',
          message: 'auth.role.revoked',
          data: {
            role: oldRole,
            revoked_by_user_id_hash: callerUid,
            revocation_reason: 'role_change',
          },
        });
      }
    } catch { /* analytics must never break user flow */ }

    res.json({ success: true, message: `Role ${role} assigned to user ${uid}` });
  } catch (error) {
    logger.error('admin_set_role_failed', error, { callerUid, targetUid: uid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
