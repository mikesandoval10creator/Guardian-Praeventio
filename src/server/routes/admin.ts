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
import { verifySchedulerOrFallback } from '../middleware/verifySchedulerToken.js';
import {
  ADMIN_ROLES,
  DOCTOR_ROLES,
  SUPERVISOR_ROLES,
  WORKER_ROLES,
  isValidRole,
  isAdminRole,
} from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
// B17 (Fase 5) — admin-assisted WebAuthn recovery (revoke a worker's
// compromised credentials). The store is DB-agnostic; we feed it a thin
// Admin-SDK adapter built below.
import {
  getCredentialsByUid,
  findByCredentialId,
  deleteCredentialById,
  type MinimalCredentialsDb,
} from '../../services/auth/webauthnCredentialStore.js';
// 15th wave (Bucket D): real server analytics adapter — closes the 13th
// wave Sentry-breadcrumb deferral for `auth.role.granted/revoked`.
import { serverAnalytics } from '../../services/analytics/serverAdapter.js';
import type { Role as AnalyticsRole } from '../../services/analytics/types.js';
// Sprint 22 Bucket W.5: hourly write-through replica for critical
// Firestore collections (audit_logs + invoices) â†’ Cloud Storage JSONL.
// Endpoint exists so Cloud Scheduler can drive the job hourly without
// owning a separate Cloud Run job; admin can also re-drive a missed hour
// manually from the operator dashboard.
import { replicateCriticalData } from '../jobs/firestoreCriticalReplicate.js';
// Sprint 22 Bucket Y — weekly digest job. Runs Mondays 09:00 Santiago via
// Cloud Scheduler hitting POST /api/admin/jobs/weekly-digest. Job pure-ish
// in jobs/weeklyDigest.ts; this endpoint is a thin admin-gated wrapper.
import { runWeeklyDigest } from '../jobs/weeklyDigest.js';
// Sprint 25 Bucket TT — daily climate risk scan orchestrator. Cloud
// Scheduler hits this endpoint at 05:00 Santiago (08:00 UTC) every day.
import {
  runDailyClimateRiskScan,
  type ClimateRiskScanDeps,
  type DailyScanProject,
} from '../jobs/dailyClimateRiskScan.js';
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

/**
 * Write an `audit_logs` entry WITHOUT letting a Firestore failure break the
 * user-facing admin action (directive #14). The state change has already
 * happened by the time we audit, so an audit-write error is logged + captured
 * but NON-blocking — the original response still succeeds. Previously these
 * writes were bare `await ...add(...)` inside the handler try, so an audit
 * failure 500'd a COMPLETED operation (done-but-reported-failed, no audit row).
 * Audit failure is severe (compliance) but must not corrupt the user action.
 */
// Thin Admin-SDK adapter onto the DB-agnostic webauthn credential store.
// Mirrors the shape buildWebAuthnCredentialsDb (curriculum.ts) exposes; kept
// local so this admin route doesn't statically couple to the curriculum
// module (and its boot-time origin guard). Only the methods the recovery
// flow needs are wired: doc().get()/delete() and where().get().
function buildCredentialsDb(): MinimalCredentialsDb {
  const fs = admin.firestore();
  return {
    now: () => Date.now(),
    collection(name: string) {
      const col = fs.collection(name);
      return {
        doc(id: string) {
          const ref = col.doc(id);
          return {
            async get() {
              const snap = await ref.get();
              return {
                exists: snap.exists,
                id: snap.id,
                data: () => (snap.exists ? (snap.data() as Record<string, unknown>) : undefined),
              };
            },
            async set(data: Record<string, unknown>) {
              await ref.set(data);
            },
            async update(patch: Record<string, unknown>) {
              await ref.update(patch);
            },
            async delete() {
              await ref.delete();
            },
          };
        },
        where(field: string, op: '==', value: unknown) {
          const q = col.where(field, op, value);
          return {
            async get() {
              const snap = await q.get();
              return {
                empty: snap.empty,
                docs: snap.docs.map((d) => ({
                  id: d.id,
                  data: () => d.data() as Record<string, unknown>,
                })),
              };
            },
          };
        },
      };
    },
  };
}

async function safeAudit(entry: Record<string, unknown>): Promise<void> {
  try {
    await admin.firestore().collection('audit_logs').add(entry);
  } catch (err) {
    logger.error('admin_audit_event_failed', err, { action: entry.action });
    captureRouteError(err, 'admin.audit', {
      action: String(entry.action ?? 'unknown'),
    });
  }
}

// Desconexión Forzada (Revoke Tokens - El Haki del Rey / Security)
router.post('/revoke-access', verifyAuth, async (req, res) => {
  const { targetUid } = req.body;
  const callerUid = req.user!.uid;

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
    await safeAudit({
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

    return res.json({ success: true, message: `Access revoked for user ${targetUid}` });
  } catch (error) {
    logger.error('admin_revoke_access_failed', error, { callerUid, targetUid });
    captureRouteError(error, 'admin.revoke_access', { callerUid, targetUid });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/webauthn/revoke  { targetUid, credentialId? }
//
// Admin-assisted WebAuthn recovery (B17, Fase 5). There is NO user-facing
// self-delete of MFA credentials — a thief with an unlocked phone would
// otherwise wipe the victim's keys and lock them out of their safety data
// (client-side step-up does not protect a stolen UNLOCKED device, since the
// device's own key passes it). The ONLY removal path is this admin/supervisor
// gated, audited recovery: when a worker reports a lost/stolen device, an
// authorized operator revokes the compromised credential(s) on their behalf.
//
//   • `credentialId` present → revoke that one credential (404 if it isn't
//     registered to `targetUid`).
//   • `credentialId` absent  → revoke ALL of the worker's credentials
//     (force a clean re-enrollment from a trusted device).
//
// We also revoke the worker's refresh tokens so a session riding the
// compromised device is dropped. Audited to audit_logs (directive #3),
// non-blocking via safeAudit (directive #14).
router.post('/webauthn/revoke', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return undefined;
  const callerUid = req.user!.uid;
  const { targetUid, credentialId } = req.body ?? {};

  if (typeof targetUid !== 'string' || !UID_REGEX.test(targetUid)) {
    return res.status(400).json({ error: 'Invalid uid' });
  }
  if (
    credentialId !== undefined &&
    (typeof credentialId !== 'string' || credentialId.length === 0 || credentialId.length > 512)
  ) {
    return res.status(400).json({ error: 'Invalid credentialId' });
  }

  try {
    const credsDb = buildCredentialsDb();

    let revokedIds: string[] = [];
    if (typeof credentialId === 'string') {
      const stored = await findByCredentialId(credentialId, credsDb);
      // Treat "not found" and "registered to another user" identically — a
      // 404 that never confirms whether the id exists under a different uid.
      if (!stored || stored.uid !== targetUid) {
        return res.status(404).json({ error: 'Credential not found for user' });
      }
      await deleteCredentialById(credentialId, credsDb);
      revokedIds = [credentialId];
    } else {
      const all = await getCredentialsByUid(targetUid, credsDb);
      for (const c of all) {
        await deleteCredentialById(c.credentialId, credsDb);
      }
      revokedIds = all.map((c) => c.credentialId);
    }

    // Drop any session riding the compromised device.
    await admin.auth().revokeRefreshTokens(targetUid);

    await safeAudit({
      actor: callerUid,
      action: 'webauthn.admin_revoke',
      target: targetUid,
      // credentialIds are public identifiers (not secrets) — safe to audit.
      details: { count: revokedIds.length, credentialIds: revokedIds },
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });

    return res.json({ success: true, revoked: revokedIds.length });
  } catch (error) {
    logger.error('admin_webauthn_revoke_failed', error, { callerUid, targetUid });
    captureRouteError(error, 'admin.webauthn_revoke', { callerUid, targetUid });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Custom Claims Endpoint (El Haki del Rey)
router.post('/set-role', verifyAuth, async (req, res) => {
  const { uid, role } = req.body;
  const callerUid = req.user!.uid;

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
    await safeAudit({
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

    return res.json({ success: true, message: `Role ${role} assigned to user ${uid}` });
  } catch (error) {
    logger.error('admin_set_role_failed', error, { callerUid, targetUid: uid });
    captureRouteError(error, 'admin.set_role', { callerUid, targetUid: uid });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Sprint 22 Bucket W.5 — hourly critical-data replicate.
//
// POST /api/admin/replicate-critical
//   Drives the audit_logs + invoices write-through to GCS for the last
//   hour. Idempotent: re-running for the same hour overwrites the same
//   JSONL file with the same contents. Intended call sites:
//     • Cloud Scheduler (hourly) â†’ admin OIDC token â†’ this endpoint
//     • Operator dashboard "re-drive missed hour" button
//
// Returns { ok, collections: [{ collection, docs, path, error? }], window }.
// Per-collection errors do NOT fail the request — DR_RUNBOOK §3 commits
// to "best-effort hourly replica"; a failure on one collection should
// never starve the other.
router.post('/replicate-critical', verifySchedulerOrFallback(verifyAuth), async (req, res) => {
  const callerUid = (await resolveCronActor(req, res)) ?? null;
  if (!callerUid) return undefined;

  try {
    const result = await replicateCriticalData();

    // Audit trail — replicate runs are infrequent enough that we want one
    // row per invocation. Captures partial-success state in `result`.
    await safeAudit({
      actor: callerUid,
      action: 'replicate_critical',
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
      result,
    });

    return res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('admin_replicate_critical_failed', error, { callerUid });
    captureRouteError(error, 'admin.replicate_critical', { callerUid });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Sprint 22 Bucket Y — weekly digest cron entry point.
// Cloud Scheduler hits this endpoint every Monday at 09:00 Santiago.
// Admin-gated so a stale token can't trigger an N-tenant email burst.
// Optional `projectIds` body field allows ad-hoc replays for ops:
//   POST /api/admin/jobs/weekly-digest { "projectIds": ["proj_1"] }
router.post('/jobs/weekly-digest', verifySchedulerOrFallback(verifyAuth), async (req, res) => {
  const callerUid = (await resolveCronActor(req, res)) ?? null;
  if (!callerUid) return undefined;
  try {
    const body = (req.body ?? {}) as { projectIds?: unknown };
    const projectIds = Array.isArray(body.projectIds)
      ? body.projectIds.filter((id): id is string => typeof id === 'string').slice(0, 200)
      : undefined;
    const result = await runWeeklyDigest({ projectIds });
    await safeAudit({
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
    return res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('admin_weekly_digest_failed', error, { callerUid });
    captureRouteError(error, 'admin.weekly_digest', { callerUid });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Sprint 25 Bucket TT — daily climate risk scan. Cloud Scheduler at
// 05:00 Santiago (08:00 UTC). Admin-gated so a stale token cannot trigger
// an N-tenant FCM burst. Wires the orchestrator to real Firestore /
// Open-Meteo / FCM admin SDK; the orchestrator itself is DI-testeable.
router.post('/jobs/climate-scan', verifySchedulerOrFallback(verifyAuth), async (req, res) => {
  const callerUid = (await resolveCronActor(req, res)) ?? null;
  if (!callerUid) return undefined;
  try {
    const deps: ClimateRiskScanDeps = {
      listActiveProjects: async () => {
        const snap = await admin
          .firestore()
          .collectionGroup('projects')
          .where('status', '==', 'active')
          .where('outdoor', '==', true)
          .get();
        const projects: DailyScanProject[] = [];
        for (const d of snap.docs) {
          const data = d.data() as Record<string, any>;
          const tenantId = d.ref.parent.parent?.id ?? '';
          const geo =
            data.geo &&
            typeof data.geo.lat === 'number' &&
            typeof data.geo.lng === 'number'
              ? { lat: data.geo.lat as number, lng: data.geo.lng as number }
              : undefined;
          projects.push({
            id: d.id,
            tenantId,
            name: typeof data.name === 'string' ? data.name : d.id,
            geo,
            outdoor: data.outdoor === true,
            workTypes: Array.isArray(data.workTypes) ? data.workTypes : [],
            supervisorUids: Array.isArray(data.supervisorUids)
              ? data.supervisorUids.filter((u: unknown) => typeof u === 'string')
              : [],
          });
        }
        return projects;
      },
      fetchForecast: async (geo, days) => {
        const { getForecast } = await import('../../services/environmentBackend.js');
        return getForecast(days, { lat: geo.lat, lng: geo.lng });
      },
      persistNodes: async (assessments, projectId) => {
        // Server-side persistence — write directly to the `zettelkasten_nodes`
        // collection used by the POST /api/zettelkasten/nodes endpoint, with
        // the same SHA-256 idempotency contract enforced by `nodeIdFor`. We
        // avoid the HTTP roundtrip (cron is internal) and reuse the hash
        // function for stable doc IDs.
        const { nodeIdFor } = await import(
          '../../services/zettelkasten/persistence/writeNode.js'
        );
        const ids: string[] = [];
        const fs = admin.firestore();
        const batch = fs.batch();
        for (const a of assessments) {
          // The pure climateRiskCoupling output uses ClimateRiskNodePayload
          // (no `severity`/`references` field). Wrap it into a server-side
          // shape compatible with the writeNode hash by feeding the
          // canonical fields. We synthesize the missing optionals.
          // Flatten metadata to RiskNodePayload's primitive-only contract.
          const md = a.riskNodePayload.metadata;
          const flatMetadata: Record<string, number | string | boolean | null> = {
            conditionCode: md.conditionCode,
            temperatureC: md.temperatureC,
            windKmh: md.windKmh ?? null,
            precipMm: md.precipMm ?? null,
            forecastDateISO: md.forecastDateISO,
            riskFactors: md.riskFactors.join(','),
          };
          const proxy = {
            type: a.riskNodePayload.type,
            title: a.riskNodePayload.title,
            description: a.riskNodePayload.description,
            severity: 'medium' as const,
            metadata: flatMetadata,
            connections: a.riskNodePayload.connections,
            references: ['NCh 432'],
          };
          const id = await nodeIdFor(proxy as any, projectId);
          ids.push(id);
          batch.set(
            fs.collection('zettelkasten_nodes').doc(id),
            {
              ...proxy,
              projectId,
              source: 'daily-climate-scan',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
        await batch.commit();
        return { ok: true, ids };
      },
      sendFcmMulticast: async (opts) => {
        if (opts.uids.length === 0) {
          return { successCount: 0, failureCount: 0 };
        }
        // Look up FCM tokens — Firestore `in` is capped at 30 values, so we
        // chunk the supervisor UID list.
        const tokens: string[] = [];
        const fs = admin.firestore();
        const CHUNK = 30;
        for (let i = 0; i < opts.uids.length; i += CHUNK) {
          const chunk = opts.uids.slice(i, i + CHUNK);
          const snap = await fs
            .collection('fcm_tokens')
            .where('uid', 'in', chunk)
            .get();
          for (const d of snap.docs) {
            const t = (d.data() as any).token;
            if (typeof t === 'string' && t.length > 0) tokens.push(t);
          }
        }
        if (tokens.length === 0) {
          return { successCount: 0, failureCount: 0 };
        }
        const out = await admin.messaging().sendEachForMulticast({
          tokens,
          notification: { title: opts.title, body: opts.body },
          data: opts.data,
        });
        return { successCount: out.successCount, failureCount: out.failureCount };
      },
      audit: async (action, details) => {
        await safeAudit({
          actor: callerUid,
          action,
          ts: admin.firestore.FieldValue.serverTimestamp(),
          ip: req.ip,
          ua: req.header('user-agent') || null,
          details,
        });
      },
    };

    const result = await runDailyClimateRiskScan(deps);
    res.json({ ok: true, result });
  } catch (error) {
    logger.error('admin_climate_scan_failed', error, { callerUid });
    captureRouteError(error, 'admin.climate_scan', { callerUid });
    res.status(500).json({ error: 'climate_scan_failed' });
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

/**
 * Resolve the actor for an endpoint that serves BOTH Cloud Scheduler and a
 * human operator (replicate-critical, weekly-digest, climate-scan). Used
 * behind `verifySchedulerOrFallback(verifyAuth)`:
 *   • machine tick   → `req.schedulerInvocation` true → actor 'cloud-scheduler'
 *     (no Firebase user lookup; the OIDC SA was already pinned by the gate).
 *   • human operator → fall back to the admin-role check.
 * Returns the actor string to stamp in audit_logs, or null after writing the
 * 401/403 response. Closes AUDIT-2026-06 B19: these crons were gated by plain
 * verifyAuth, which rejects the scheduler's OIDC token → no cron ever ran.
 */
async function resolveCronActor(req: any, res: any): Promise<string | null> {
  if (req.schedulerInvocation === true) return 'cloud-scheduler';
  const callerUid = req.user?.uid;
  if (!callerUid) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const callerRecord = await admin.auth().getUser(callerUid);
  if (!isAdminRole(callerRecord.customClaims?.role)) {
    res.status(403).json({ error: 'Forbidden: Requires admin role' });
    return null;
  }
  return callerUid;
}

// GET /api/admin/quotas?tenantId=X&date=Y
//   Returns the daily Gemini usage row for `tenantId`. `date` is
//   optional; defaults to today UTC. Used by the operator dashboard
//   to investigate per-tenant abuse / runaway-loop scenarios.
router.get('/quotas', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return undefined;
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
    return res.json({ ok: true, usage });
  } catch (error) {
    logger.error('admin_quotas_get_failed', error, { tenantId, date });
    captureRouteError(error, 'admin.quotas_get', { tenantId, date });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/quotas/global?date=Y&limit=N
//   Top-N tenants by Gemini USD spend on a given day (default today,
//   default 10). Backs the "biggest spenders" widget on the operator
//   dashboard — useful for catching runaway tenants before billing
//   sees the bill.
router.get('/quotas/global', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return undefined;
  const date = typeof req.query.date === 'string' ? req.query.date : todayUtc();
  if (!QUOTAS_DATE_REGEX.test(date)) {
    return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
  }
  const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 10;
  try {
    const top = await topTenantsByUsage(date, limit);
    return res.json({ ok: true, date, limit, tenants: top });
  } catch (error) {
    logger.error('admin_quotas_global_failed', error, { date, limit });
    captureRouteError(error, 'admin.quotas_global', { date, limit });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/quotas/reset { tenantId, date }
//   Manual reset of a tenant's daily quota. Audit-logged. Use case:
//   tenant was unfairly throttled by a buggy client or a one-off batch
//   job that shouldn't have been counted. Document the reason in the
//   change ticket — the audit_logs row captures who/when only.
router.post('/quotas/reset', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return undefined;
  const callerUid = req.user!.uid;
  const { tenantId, date } = req.body ?? {};
  if (typeof tenantId !== 'string' || !UID_REGEX.test(tenantId)) {
    return res.status(400).json({ error: 'Invalid tenantId' });
  }
  if (typeof date !== 'string' || !QUOTAS_DATE_REGEX.test(date)) {
    return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' });
  }
  try {
    await resetQuota(tenantId, date);
    await safeAudit({
      actor: callerUid,
      action: 'quota_reset',
      target: tenantId,
      date,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });
    return res.json({ ok: true, tenantId, date });
  } catch (error) {
    logger.error('admin_quotas_reset_failed', error, { tenantId, date });
    captureRouteError(error, 'admin.quotas_reset', { tenantId, date });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/circuit-state
//   Snapshot of in-process circuit breaker state. Note: in-process
//   only — see header comment block above.
router.get('/circuit-state', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return undefined;
  try {
    return res.json({
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
    captureRouteError(error, 'admin.circuit_state');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Sprint 25 Bucket QQ — admin observability/control for the offline
// sync state machine. The state machine itself lives client-side
// (browser IndexedDB), so the server only knows about *server-side
// observability of pending writes*: we track pending sync operations
// per-user via the `user_sync_state` collection, where clients
// write a heartbeat document containing { uid, pendingCount, state,
// updatedAt } whenever their state machine snapshot changes.
//
// Endpoints:
//   • POST /api/admin/sync/clear-user-queue { targetUid }
//       Marks the user_sync_state doc with `clearRequested: true` so
//       the client drops its local queue on next subscription. Use
//       case: a stuck queue caused by a bad payload that retries
//       forever — admin can break the loop without forcing the user
//       to clear their browser storage.
//   • GET /api/admin/sync/stats
//       Aggregates pending op count across all users. Backs the
//       "stuck users" widget on the operator dashboard.

router.post('/sync/clear-user-queue', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return undefined;
  const callerUid = req.user!.uid;
  const { targetUid } = req.body ?? {};
  if (typeof targetUid !== 'string' || !UID_REGEX.test(targetUid)) {
    return res.status(400).json({ error: 'Invalid targetUid' });
  }
  try {
    await admin
      .firestore()
      .collection('user_sync_state')
      .doc(targetUid)
      .set(
        {
          clearRequested: true,
          clearRequestedBy: callerUid,
          clearRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    await safeAudit({
      actor: callerUid,
      action: 'sync_clear_user_queue',
      target: targetUid,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });
    return res.json({ ok: true, targetUid });
  } catch (error) {
    logger.error('admin_sync_clear_user_queue_failed', error, {
      callerUid,
      targetUid,
    });
    captureRouteError(error, 'admin.sync_clear_user_queue', { callerUid, targetUid });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sync/stats', verifyAuth, async (req, res) => {
  if (!(await assertAdminCaller(req, res))) return undefined;
  try {
    const snap = await admin.firestore().collection('user_sync_state').get();
    let totalPending = 0;
    let usersWithPending = 0;
    let usersFailed = 0;
    const stuckUsers: Array<{ uid: string; pendingCount: number; state: string }> = [];
    snap.forEach((d) => {
      const data = d.data() as {
        pendingCount?: number;
        state?: string;
      };
      const pendingCount =
        typeof data.pendingCount === 'number' ? data.pendingCount : 0;
      const state = typeof data.state === 'string' ? data.state : 'unknown';
      totalPending += pendingCount;
      if (pendingCount > 0) usersWithPending += 1;
      if (state === 'online_failed') {
        usersFailed += 1;
        stuckUsers.push({ uid: d.id, pendingCount, state });
      }
    });
    // Sort stuck users by pendingCount desc and cap to 25 — the
    // dashboard widget only renders the worst offenders.
    stuckUsers.sort((a, b) => b.pendingCount - a.pendingCount);
    res.json({
      ok: true,
      totalPending,
      usersWithPending,
      usersFailed,
      stuckUsers: stuckUsers.slice(0, 25),
    });
  } catch (error) {
    logger.error('admin_sync_stats_failed', error);
    captureRouteError(error, 'admin.sync_stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
