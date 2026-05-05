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
// Sprint 22 Bucket W.5: hourly write-through replica for critical
// Firestore collections (audit_logs + invoices) → Cloud Storage JSONL.
// Endpoint exists so Cloud Scheduler can drive the job hourly without
// owning a separate Cloud Run job; admin can also re-drive a missed hour
// manually from the operator dashboard.
import { replicateCriticalData } from '../jobs/firestoreCriticalReplicate.js';
// Sprint 22 Bucket Y — weekly digest job. Runs Mondays 09:00 Santiago via
// Cloud Scheduler hitting POST /api/admin/jobs/weekly-digest. Job pure-ish
// in jobs/weeklyDigest.ts; this endpoint is a thin admin-gated wrapper.
import { runWeeklyDigest } from '../jobs/weeklyDigest.js';
// Sprint 22 prod hardening (Bucket X) — admin-facing observability for
// per-tenant Gemini quotas and the upstream circuit breaker.
import {
  getUsage,
  resetQuota,
  topTenantsByUsage,
  todayUtc,
} from '../../services/observability/quotaTracker.js';
import { geminiCircuit } from '../middleware/geminiCircuit.js';

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

// Sprint 22 Bucket W.5 — hourly critical-data replicate.
//
// POST /api/admin/replicate-critical
//   Drives the audit_logs + invoices write-through to GCS for the last
//   hour. Idempotent: re-running for the same hour overwrites the same
//   JSONL file with the same contents. Intended call sites:
//     • Cloud Scheduler (hourly) → admin OIDC token → this endpoint
//     • Operator dashboard "re-drive missed hour" button
//
// Returns { ok, collections: [{ collection, docs, path, error? }], window }.
// Per-collection errors do NOT fail the request — DR_RUNBOOK §3 commits
// to "best-effort hourly replica"; a failure on one collection should
// never starve the other.
router.post('/replicate-critical', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;

  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Requires admin role to drive critical replicate' });
    }

    const result = await replicateCriticalData();

    // Audit trail — replicate runs are infrequent enough that we want one
    // row per invocation. Captures partial-success state in `result`.
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'replicate_critical',
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
      result,
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('admin_replicate_critical_failed', error, { callerUid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sprint 22 Bucket Y — weekly digest cron entry point.
// Cloud Scheduler hits this endpoint every Monday at 09:00 Santiago.
// Admin-gated so a stale token can't trigger an N-tenant email burst.
// Optional `projectIds` body field allows ad-hoc replays for ops:
//   POST /api/admin/jobs/weekly-digest { "projectIds": ["proj_1"] }
router.post('/jobs/weekly-digest', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Requires admin role to drive weekly digest' });
    }
    const body = (req.body ?? {}) as { projectIds?: unknown };
    const projectIds = Array.isArray(body.projectIds)
      ? body.projectIds.filter((id): id is string => typeof id === 'string').slice(0, 200)
      : undefined;
    const result = await runWeeklyDigest({ projectIds });
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'weekly_digest_run',
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
      result: {
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        projectsProcessed: result.projectsProcessed,
        projectsSent: result.projectsSent,
        totalEmailsSent: result.totalEmailsSent,
        totalEmailErrors: result.totalEmailErrors,
      },
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('admin_weekly_digest_failed', error, { callerUid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sprint 22 prod hardening (Bucket X) — admin observability for the
// Gemini quota/circuit layer. All four endpoints gate on admin role
// (mirrors the /revoke-access + /set-role pattern above) and return
// JSON shaped for the operator dashboard.
//
// Quota docs live at `quota_usage/{tenantId}__{YYYY-MM-DD}` (see
// quotaTracker.ts). The circuit breaker is in-process state, so the
// /circuit-state response reflects the instance the request landed
// on; behind a load balancer with replicas > 1 the operator should
// hit each replica or rely on Cloud Monitoring metrics.

const QUOTAS_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

async function assertAdminCaller(req: any, res: any): Promise<boolean> {
  const callerUid = req.user?.uid;
  if (!callerUid) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  const callerRecord = await admin.auth().getUser(callerUid);
  if (!isAdminRole(callerRecord.customClaims?.role)) {
    res.status(403).json({ error: 'Forbidden: Requires admin role' });
    return false;
  }
  return true;
}

// GET /api/admin/quotas?tenantId=X&date=Y
//   Returns the daily Gemini usage row for `tenantId`. `date` is
//   optional; defaults to today UTC. Used by the operator dashboard
//   to investigate per-tenant abuse / runaway-loop scenarios.
router.get('/quotas', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return;
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  if (!UID_REGEX.test(tenantId)) {
    return res.status(400).json({ error: 'Invalid tenantId' });
  }
  const date = typeof req.query.date === 'string' ? req.query.date : todayUtc();
  if (!QUOTAS_DATE_REGEX.test(date)) {
    return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
  }
  try {
    const usage = await getUsage(tenantId, date);
    res.json({ ok: true, usage });
  } catch (error) {
    logger.error('admin_quotas_get_failed', error, { tenantId, date });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/quotas/global?date=Y&limit=N
//   Top-N tenants by Gemini USD spend on a given day (default today,
//   default 10). Backs the "biggest spenders" widget on the operator
//   dashboard — useful for catching runaway tenants before billing
//   sees the bill.
router.get('/quotas/global', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return;
  const date = typeof req.query.date === 'string' ? req.query.date : todayUtc();
  if (!QUOTAS_DATE_REGEX.test(date)) {
    return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
  }
  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10;
  try {
    const top = await topTenantsByUsage(date, limit);
    res.json({ ok: true, date, limit, tenants: top });
  } catch (error) {
    logger.error('admin_quotas_global_failed', error, { date, limit });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/quotas/reset { tenantId, date }
//   Manual reset of a tenant's daily quota. Audit-logged. Use case:
//   tenant was unfairly throttled by a buggy client or a one-off batch
//   job that shouldn't have been counted. Document the reason in the
//   change ticket — the audit_logs row captures who/when only.
router.post('/quotas/reset', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return;
  const callerUid = (req as any).user.uid;
  const { tenantId, date } = req.body ?? {};
  if (typeof tenantId !== 'string' || !UID_REGEX.test(tenantId)) {
    return res.status(400).json({ error: 'Invalid tenantId' });
  }
  if (typeof date !== 'string' || !QUOTAS_DATE_REGEX.test(date)) {
    return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
  }
  try {
    await resetQuota(tenantId, date);
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'quota_reset',
      target: tenantId,
      date,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });
    res.json({ ok: true, tenantId, date });
  } catch (error) {
    logger.error('admin_quotas_reset_failed', error, { tenantId, date });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/circuit-state
//   Snapshot of in-process circuit breaker state. Note: in-process
//   only — see header comment block above.
router.get('/circuit-state', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return;
  try {
    res.json({
      ok: true,
      thresholds: {
        threshold: geminiCircuit.THRESHOLD,
        windowMs: geminiCircuit.WINDOW_MS,
        openDurationMs: geminiCircuit.OPEN_DURATION_MS,
      },
      state: geminiCircuit.snapshot(),
    });
  } catch (error) {
    logger.error('admin_circuit_state_failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
