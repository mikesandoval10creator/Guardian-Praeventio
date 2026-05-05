// Praeventio Guard — Sprint 14.
//
// POST /api/emergency/sos — worker-initiated SOS alert. The mobile client
// (SOSButton with 3s long-press confirmation) calls this endpoint with an
// optional GPS fix and the active project. The server:
//
//   1. Authenticates via verifyAuth.
//   2. Asserts project membership (cross-tenant SOS would be a privacy leak —
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
import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { logger } from '../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing on the SOS path. Emergency
// notifications are CRITICAL to correlate end-to-end (push fan-out
// failures, missing tokens, Firestore lag).
import { tracedAsync } from '../../services/observability/tracing.js';
// Sprint 22 Bucket Y — email fallback when FCM push fails or no
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
    (req as any).user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas alertas SOS. Espera un momento.' },
});

const SUPERVISOR_ROLES = new Set(['supervisor', 'gerente', 'prevencionista', 'admin']);

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
  const tokens: string[] = [];
  const supervisorEmails: string[] = [];
  for (const memberDoc of membersSnap.docs) {
    const data = memberDoc.data();
    if (!SUPERVISOR_ROLES.has(data?.role)) continue;
    if (typeof data?.fcmToken === 'string' && data.fcmToken) {
      tokens.push(data.fcmToken);
    }
    if (typeof data?.email === 'string' && data.email) {
      supervisorEmails.push(data.email);
    }
  }
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
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;
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
            title: '🆘 SOS recibido',
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
      // FCM fan-out failure must NOT fail the SOS write — the worker still
      // needs the audit row + alert doc so a human dispatcher can pick up.
      logger.error('sos_fcm_fanout_failed', {
        uid: callerUid,
        projectId,
        message: fcmErr?.message,
      });
    }

    // Sprint 22 Bucket Y — email fallback when push delivery is partial
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
            ((req as any).user?.name as string | undefined) ||
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
              subject: `🚨 SOS — ${workerName} en ${projectName}`,
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
    return res.status(500).json({
      error: 'sos_failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

export default router;
