// Praeventio Guard â€” Sprint 14.
//
// POST /api/emergency/sos â€” worker-initiated SOS alert. The mobile client
// (SOSButton with 3s long-press confirmation) calls this endpoint with an
// optional GPS fix and the active project. The server:
//
//   1. Authenticates via verifyAuth.
//   2. Asserts project membership (cross-tenant SOS would be a privacy leak â€”
//      a worker on project A could spam supervisors of project B otherwise).
//   3. Writes the alert to `tenants/{tenantId}/emergency_alerts/{alertId}`
//      with `{type, uid, projectId, geo, createdAt}`.
//   4. Multicasts an FCM payload to all supervisor/gerente/prevencionista
//      role members of the project that have an `fcmToken` in their
//      project-member doc (mirrors the existing /api/emergency/notify-brigada
//      pattern in server.ts).
//
// Tenancy: each project belongs to a tenant. We resolve `tenantId` from the
// `projects/{projectId}.tenantId` field; if absent (legacy projects) we
// fall back to `projectId` itself so the write still lands in a per-project
// namespace and tests can assert against a deterministic path.
//
// Rate limit: 10 SOS per minute per uid. Honest workers don't spam SOS;
// this caps a compromised token / runaway script from filling Firestore.

import { Router } from 'express';
import admin from 'firebase-admin';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';

// Sprint 22 Bucket AA â€” request-scoped tracing on the SOS path. Emergency
// notifications are CRITICAL to correlate end-to-end (push fan-out
// failures, missing tokens, Firestore lag).
import { tracedAsync } from '../../services/observability/tracing.js';
// Sprint 22 Bucket Y â€” email fallback when FCM push fails or no
// supervisor has a registered token. Resend service is constructed
// lazily from env so dev environments without RESEND_API_KEY still
// boot; `EmailService.fromEnv()` returns null in that case and we
// silently skip the email step.
import { EmailService } from '../../services/email/resendService.js';
import { sosBackupTemplate } from '../../services/email/templates.js';

export const sosLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req: Request) =>
    req.user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas alertas SOS. Espera un momento.' },
});

const SUPERVISOR_ROLES = new Set(['supervisor', 'gerente', 'prevencionista', 'admin']);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sprint 27 P0 H7 â€” cross-collection FCM token cache.
//
// Background: `push.ts` writes registered tokens to `users/{uid}.fcmTokens`
// (an array, via arrayUnion). The legacy SOS fan-out path read
// `projects/{id}/members/{uid}.fcmToken` (singular). Nobody synchronized
// the two, so `notified` was always 0 â€” the brigade's phones never rang.
//
// Fix (option 1 / single source of truth): for each project member,
// resolve their tokens cross-collection from `users/{memberUid}.fcmTokens`
// and union them with any legacy `members/{uid}.fcmToken` value still on
// the member doc. Dedupe via Set before sending.
//
// Cache: TTL 5 min keyed by uid. SOS bursts (e.g. a brigade leader hitting
// the button repeatedly during an active incident) shouldn't hammer
// `users/*` reads. The cache is process-local â€” no Redis needed; pods
// rotate often enough that staleness is bounded.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const USER_TOKEN_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const userTokenCache = new Map<string, { tokens: string[]; expiresAt: number }>();

/** Test-only: clear the in-process cache between cases. Not exported via
 *  the default router export; tests `import { __clearUserTokenCache }`. */
export function __clearUserTokenCache(): void {
  userTokenCache.clear();
}

/**
 * Read `users/{uid}.fcmTokens` (array) with a TTL cache. Returns `[]` when
 * the doc doesn't exist or the field is missing/empty. Errors are swallowed
 * to a `[]` return â€” a single user-doc read failing must never block the
 * SOS fan-out.
 */
async function getUserTokensCached(
  uid: string,
  db: FirebaseFirestore.Firestore,
): Promise<string[]> {
  const now = Date.now();
  const hit = userTokenCache.get(uid);
  if (hit && hit.expiresAt > now) {
    return hit.tokens;
  }
  let tokens: string[] = [];
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) {
      const raw = (snap.data() as any)?.fcmTokens;
      if (Array.isArray(raw)) {
        tokens = raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
      }
    }
  } catch (err: any) {
    logger.warn('sos_user_token_lookup_failed', { uid, message: err?.message });
    tokens = [];
  }
  userTokenCache.set(uid, { tokens, expiresAt: now + USER_TOKEN_CACHE_TTL_MS });
  return tokens;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

interface GeoPoint {
  lat: number;
  lng: number;
}

function validateGeo(g: unknown): GeoPoint | null {
  if (g == null || typeof g !== 'object') return null;
  const lat = (g as any).lat;
  const lng = (g as any).lng;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Send an FCM payload to every member of `projectId` whose role is in
 * `SUPERVISOR_ROLES`. Mirrors the existing `notify-brigada` pattern: reads
 * `projects/{projectId}/members` and forwards via `sendEachForMulticast`.
 *
 * Exported separately so a future generic `sendToProjectRole(projectId,
 * role, payload)` helper can adopt this same shape without churning the
 * call sites.
 */
export async function sendToProjectSupervisors(
  projectId: string,
  payload: { title: string; body: string; data?: Record<string, string> },
  db: FirebaseFirestore.Firestore,
  messaging: admin.messaging.Messaging,
): Promise<{ notified: number; failed: number; supervisorEmails: string[] }> {
  const membersSnap = await db.collection('projects').doc(projectId).collection('members').get();
  const tokenSet = new Set<string>();
  const supervisorEmails: string[] = [];

  // Sprint 27 P0 H7 â€” cross-collection lookup. The canonical token store
  // is `users/{uid}.fcmTokens` (array, written by /api/push/register-token
  // via arrayUnion). For each supervisor member of the project we union
  // those tokens with any legacy `members/{uid}.fcmToken` (singular) that
  // a not-yet-migrated installation may still carry. The Set deduplicates
  // across both sources so a single device with a token in both locations
  // is notified exactly once.
  for (const memberDoc of membersSnap.docs) {
    const data = memberDoc.data();
    if (!SUPERVISOR_ROLES.has(data?.role)) continue;

    // Legacy fallback first â€” keeps installations that haven't migrated
    // working until they do. The cache lookup below adds the canonical
    // tokens on top.
    if (typeof data?.fcmToken === 'string' && data.fcmToken) {
      tokenSet.add(data.fcmToken);
    }
    if (typeof data?.email === 'string' && data.email) {
      supervisorEmails.push(data.email);
    }

    // Canonical: read users/{memberUid}.fcmTokens (array) with TTL cache.
    // memberDoc.id is the member uid in `projects/{id}/members/{uid}`.
    const memberUid = memberDoc.id;
    const userTokens = await getUserTokensCached(memberUid, db);
    for (const tok of userTokens) {
      tokenSet.add(tok);
    }
  }

  const tokens = Array.from(tokenSet);
  if (tokens.length === 0) {
    return { notified: 0, failed: 0, supervisorEmails };
  }
  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
    android: { priority: 'high' },
    apns: { payload: { aps: { 'content-available': 1 } } },
  });
  return {
    notified: result.successCount,
    failed: result.failureCount,
    supervisorEmails,
  };
}

const router = Router();

router.post('/sos', verifyAuth, sosLimiter, async (req, res) => {
  const callerUid = req.user.uid;
  const callerEmail: string | null = req.user.email ?? null;
  const { type, projectId, geo, timestamp } = req.body ?? {};

  if (type !== 'sos') {
    return res.status(400).json({ error: 'invalid_type' });
  }
  if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 128) {
    return res.status(400).json({ error: 'invalid_projectId' });
  }
  if (timestamp !== undefined && timestamp !== null && typeof timestamp !== 'string') {
    return res.status(400).json({ error: 'invalid_timestamp' });
  }
  const validatedGeo = geo == null ? null : validateGeo(geo);
  if (geo != null && validatedGeo === null) {
    return res.status(400).json({ error: 'invalid_geo' });
  }

  const db = admin.firestore();
  try {
    await assertProjectMember(callerUid, projectId, db);
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    throw err;
  }

  try {
    const projectSnap = await db.collection('projects').doc(projectId).get();
    const tenantId: string =
      (projectSnap.exists && (projectSnap.data() as any)?.tenantId) || projectId;
    const alertRef = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('emergency_alerts')
      .add({
        type: 'sos',
        uid: callerUid,
        userEmail: callerEmail,
        projectId,
        geo: validatedGeo,
        clientTimestamp: timestamp ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    await db.collection('audit_logs').add({
      action: 'emergency.sos',
      module: 'emergency',
      details: { projectId, alertId: alertRef.id, hasGeo: validatedGeo !== null },
      userId: callerUid,
      userEmail: callerEmail,
      projectId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    let notified = 0;
    let pushFailed = 0;
    let supervisorEmails: string[] = [];
    try {
      const result = await tracedAsync(
        'emergency.sos.fanout',
        { tenantId, projectId, alertId: alertRef.id },
        () => sendToProjectSupervisors(
          projectId,
          {
            title: 'ðŸ†˜ SOS recibido',
            body: `Trabajador solicita ayuda en proyecto ${projectId}`,
            data: {
              projectId,
              alertId: alertRef.id,
              type: 'sos',
              uid: callerUid,
            },
          },
          db,
          admin.messaging(),
        ),
      );
      notified = result.notified;
      pushFailed = result.failed;
      supervisorEmails = result.supervisorEmails;
    } catch (fcmErr: any) {
      // FCM fan-out failure must NOT fail the SOS write â€” the worker still
      // needs the audit row + alert doc so a human dispatcher can pick up.
      logger.error('sos_fcm_fanout_failed', {
        uid: callerUid,
        projectId,
        message: fcmErr?.message,
      });
    }

    // Sprint 22 Bucket Y â€” email fallback when push delivery is partial
    // (some tokens failed) OR zero (no registered devices). Best-effort:
    // failure to email never bubbles up; the SOS Firestore row is the
    // authoritative artifact.
    let emailedSupervisors = 0;
    const shouldEmailFallback =
      supervisorEmails.length > 0 && (notified === 0 || pushFailed > 0);
    if (shouldEmailFallback) {
      try {
        const emailService = EmailService.fromEnv();
        if (emailService) {
          const projectName: string =
            (projectSnap.exists && (projectSnap.data() as any)?.name) || projectId;
          const workerName: string =
            (req.user?.name as string | undefined) ||
            callerEmail ||
            callerUid;
          const html = sosBackupTemplate({
            worker: { name: workerName, id: callerUid },
            project: { id: projectId, name: projectName },
            location: validatedGeo,
            timestamp: new Date(),
            alertId: alertRef.id,
          });
          const batch = await emailService.sendBatch(
            supervisorEmails.map((email) => ({
              to: email,
              subject: `ðŸš¨ SOS â€” ${workerName} en ${projectName}`,
              html,
              tag: 'sos-backup',
            })),
          );
          emailedSupervisors = batch.sent;
          if (batch.failed > 0) {
            logger.warn('sos_email_partial_failure', {
              alertId: alertRef.id,
              sent: batch.sent,
              failed: batch.failed,
            });
          }
        }
      } catch (emailErr: any) {
        logger.error('sos_email_fallback_failed', {
          alertId: alertRef.id,
          message: emailErr?.message,
        });
      }
    }

    return res.json({
      ok: true,
      alertId: alertRef.id,
      notified,
      emailedSupervisors,
    });
  } catch (error: any) {
    logger.error('sos_write_failed', {
      uid: callerUid,
      projectId,
      message: error?.message,
    });
    captureRouteError(error, 'emergency.sos', { projectId });
    return res.status(500).json({
      error: 'sos_failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/emergency/notify-brigada â€” supervisor-initiated brigade
// activation. Sprint 32 audit P0: previously inlined in server.ts:691 with
// a bug regression of H7 (only read `members/{uid}.fcmToken` singular,
// missing the canonical `users/{uid}.fcmTokens` array). Migrated here so
// it reuses `sendToProjectSupervisors` (cross-collection lookup + cache).
// Distinct from /sos: callable by supervisor/admin to notify the BRIGADE
// of a project-wide event, regardless of who dispatched it.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2026-05-16 (Codex fix #275 follow-up): agregamos tipos de emergencia
// que faltaban en el enum y que vidas dependen de poder reportar:
//   - tsunami: CoastalEmergencyMap dispara el botón emite-alerta (Sprint D)
//   - flood: inundación urbana/rural separada de tsunami
//   - earthquake: sismo (puede ir como 'collapse' pero merece su propio bucket)
//   - volcanic: ceniza/lava/lahar — VolcanicEruptionMap
//   - storm: viento blanco / temporales severos
// El enum sigue cerrado: backend rechaza valores arbitrarios.
const NotifyBrigadaSchema = z.object({
  projectId: z.string().min(1).max(128),
  emergencyType: z.enum([
    'fall',
    'sos',
    'medical',
    'fire',
    'gas',
    'collapse',
    'tsunami',
    'flood',
    'earthquake',
    'volcanic',
    'storm',
    'other',
  ]),
  message: z.string().max(500).optional(),
});

router.post(
  '/notify-brigada',
  verifyAuth,
  idempotencyKey(),
  validate(NotifyBrigadaSchema),
  async (req, res) => {
    const { projectId, emergencyType, message } = req.body as z.infer<
      typeof NotifyBrigadaSchema
    >;
    const callerUid = req.user.uid;
    const callerEmail: string | null = req.user.email ?? null;
    const db = admin.firestore();

    try {
      // Membership gate: caller must belong to the project. Prevents a
      // compromised token on tenant A from spamming tenant B brigades.
      await assertProjectMember(callerUid, projectId, db);
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    try {
      const result = await tracedAsync(
        'emergency.notify_brigada.handler',
        { 'praeventio.uid': callerUid, 'praeventio.projectId': projectId, emergencyType },
        () => sendToProjectSupervisors(
          projectId,
          {
            title: `ðŸš¨ Emergencia: ${emergencyType}`,
            body: message ?? `ActivaciÃ³n de brigada requerida en proyecto ${projectId}`,
            data: {
              projectId,
              emergencyType,
              timestamp: new Date().toISOString(),
            },
          },
          db,
          admin.messaging(),
        ),
      );

      // Audit trail â€” same shape as /sos so dashboards can union the streams.
      await db.collection('audit_logs').add({
        action: 'emergency.notify_brigada',
        module: 'emergency',
        details: {
          projectId,
          emergencyType,
          notified: result.notified,
          failed: result.failed,
        },
        userId: callerUid,
        userEmail: callerEmail,
        projectId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      return res.json({ ok: true, notified: result.notified, failed: result.failed });
    } catch (err: any) {
      logger.error('notify_brigada_failed', {
        uid: callerUid,
        projectId,
        emergencyType,
        message: err?.message,
      });
      return res.status(500).json({ error: 'notify_brigada_failed' });
    }
  },
);

export default router;
