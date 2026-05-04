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
import {
  ADMIN_ROLES,
  DOCTOR_ROLES,
  SUPERVISOR_ROLES,
  WORKER_ROLES,
  isValidRole,
  isAdminRole,
} from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
// 15th wave (Bucket D): real server analytics adapter — closes the 13th
// wave Sentry-breadcrumb deferral for `auth.role.granted/revoked`.
import { serverAnalytics } from '../../services/analytics/serverAdapter.js';
import type { Role as AnalyticsRole } from '../../services/analytics/types.js';

// Firebase Auth uid format constraint shared by privileged admin endpoints.
const UID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Map a Firestore/Auth domain role (the granular operational role like
 * `operario`, `medico_ocupacional`, `gerente`) onto the analytics-catalog
 * `Role` enum (`worker | supervisor | prevencionista | admin |
 * executive`). Property-glossary §"Role" intentionally uses a coarse
 * taxonomy so dashboards stay legible across customers — the granular
 * runtime roles would explode cardinality. Unknown / unmapped roles
 * fall through to `worker` (the safe default; see catalog row 23 note).
 */
function mapToAnalyticsRole(role: unknown): AnalyticsRole {
  if (typeof role !== 'string') return 'worker';
  if ((ADMIN_ROLES as readonly string[]).includes(role)) {
    // `gerente` is the executive-equivalent; `admin` is the operator
    // admin. Both grant `isAdminRole` server-side, but the analytics
    // catalog separates them so funnel charts can compare exec vs
    // ops sign-ins.
    return role === 'gerente' ? 'executive' : 'admin';
  }
  if (role === 'prevencionista') return 'prevencionista';
  if ((SUPERVISOR_ROLES as readonly string[]).includes(role)) return 'supervisor';
  if ((DOCTOR_ROLES as readonly string[]).includes(role)) return 'supervisor';
  if ((WORKER_ROLES as readonly string[]).includes(role)) return 'worker';
  return 'worker';
}

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

    // 15th wave (Bucket D) analytics: `auth.role.revoked` — closes the
    // 13th wave Sentry-breadcrumb deferral. The server adapter
    // (`serverAnalytics`) mirrors the browser surface but uses Node
    // primitives (stdout JSON sink + Sentry breadcrumb sink + in-memory
    // queue), so this site fans out to real product analytics rather than
    // a freeform Sentry breadcrumb. Targets are uid prefixes only; the
    // analytics catalog defines `revoked_by_user_id_hash` as a hashed
    // identifier (client-side hashing happens in `userIdHash`). We emit
    // the raw caller uid here because the server can't safely run Web
    // Crypto for every event without bottlenecking; the dashboards
    // bucket on the hash space client-side.
    try {
      // Prior role unknown without an extra read; the catalog's `Role`
      // enum has no `unknown` literal so we fall through to `worker`
      // (the safe default — see mapToAnalyticsRole).
      await serverAnalytics.track('auth.role.revoked', {
        role: 'worker',
        revoked_by_user_id_hash: callerUid,
        revocation_reason: 'admin_action',
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

    // 15th wave (Bucket D) analytics: `auth.role.granted` (and `revoked`
    // if the role transitioned). Closes the 13th wave deferral by
    // routing through the real server adapter. Emits granted always; if
    // there was an oldRole we ALSO emit revoked for the prior role so
    // dashboards see the full transition. Domain roles
    // (`operario`/`gerente`/...) are mapped onto the coarse analytics
    // `Role` enum via `mapToAnalyticsRole` so dashboards stay legible.
    try {
      await serverAnalytics.track('auth.role.granted', {
        role: mapToAnalyticsRole(role),
        granted_by_user_id_hash: callerUid,
      });
      if (oldRole && oldRole !== role) {
        await serverAnalytics.track('auth.role.revoked', {
          role: mapToAnalyticsRole(oldRole),
          revoked_by_user_id_hash: callerUid,
          revocation_reason: 'role_change',
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
