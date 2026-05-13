// Praeventio Guard â€” Sprint 12.
//
// /api/commute/{start,sample,end} â€” server-side persistence for the
// "accidente de trayecto" workflow (Ley 16.744 SUSESO). The client hook
// `useCommuteSession` writes directly to Firestore for low-latency local
// state, but the SAME writes also flow through these endpoints so that:
//
//   â€¢ Server can apply uniform validation (member guard + body schema)
//     even when an offline client replays a queue.
//   â€¢ Audit logs are stamped server-side with the SDK uid (never the
//     body) for SUSESO-grade traceability.
//   â€¢ Rate limits cap a misbehaving client / repeat-replayed offline
//     queue from blowing through Firestore writes.
//
// Membership pattern reuses verifyAuth + assertProjectMember and the
// rate limiter mirrors `geminiLimiter` (30 req / 15 min, keyed on uid).
//
// Storage path: `tenants/{tenantId}/commute_sessions/{sessionId}` â€”
// tenantId is sourced from the project doc (NOT the body) so a malicious
// client cannot redirect writes into a different tenant.

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
import { captureRouteError } from '../middleware/captureRouteError.js';

const router = Router();

const SESSION_ID_REGEX = /^[A-Za-z0-9_\-:.]{1,128}$/;
const VALID_TYPES = new Set(['home-to-site', 'site-to-home', 'between-sites']);

// Per-uid rate limiter â€” same shape as geminiLimiter (30 req / 15 min).
// Mounted AFTER verifyAuth so the keyGenerator can read req.user.uid.
export const commuteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req: Request) =>
    req.user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de commute. Intenta de nuevo en 15 minutos.' },
});

/** Returns the tenantId that owns a project, or null if missing. */
async function tenantIdFor(projectId: string): Promise<string | null> {
  const db = admin.firestore();
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const tid = data.tenantId;
  return typeof tid === 'string' && tid.length > 0 ? tid : null;
}

router.post('/start', verifyAuth, commuteLimiter, async (req, res) => {
  const callerUid = req.user.uid;
  const callerEmail: string | null = req.user.email ?? null;
  const { type, projectId } = req.body ?? {};

  if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 128) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid type' });
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

  const tenantId = await tenantIdFor(projectId);
  if (!tenantId) {
    return res.status(400).json({ error: 'Project missing tenantId' });
  }

  const sessionId = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db
      .collection(`tenants/${tenantId}/commute_sessions`)
      .doc(sessionId)
      .set({
        id: sessionId,
        projectId,
        type,
        startedBy: callerUid,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAt: null,
        samples: [],
      });
    await db.collection('audit_logs').add({
      action: 'commute.start',
      module: 'driving',
      details: { sessionId, type },
      userId: callerUid,
      userEmail: callerEmail,
      projectId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    return res.json({ success: true, sessionId });
  } catch (error: any) {
    logger.error('commute_start_failed', {
      uid: callerUid,
      projectId,
      message: error?.message,
    });
    captureRouteError(error, 'commute.start', { uid: callerUid, projectId });
    return res.status(500).json({ error: 'commute start failed' });
  }
});

router.post('/sample', verifyAuth, commuteLimiter, async (req, res) => {
  const callerUid = req.user.uid;
  const { sessionId, lat, lng, speedKmh, accuracyM, timestamp } = req.body ?? {};

  if (typeof sessionId !== 'string' || !SESSION_ID_REGEX.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'Invalid lat' });
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Invalid lng' });
  }
  if (typeof speedKmh !== 'number' || !Number.isFinite(speedKmh) || speedKmh < 0 || speedKmh > 500) {
    return res.status(400).json({ error: 'Invalid speedKmh' });
  }
  if (
    typeof accuracyM !== 'number' ||
    !Number.isFinite(accuracyM) ||
    accuracyM < 0 ||
    accuracyM > 100_000
  ) {
    return res.status(400).json({ error: 'Invalid accuracyM' });
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return res.status(400).json({ error: 'Invalid timestamp' });
  }

  const db = admin.firestore();
  // Look up session to validate ownership. The session lives under
  // `tenants/{tenantId}/commute_sessions/{id}`, but the body doesn't
  // carry tenantId â€” we resolve it via the session's `projectId` field.
  // Use a collection-group query so we don't have to scan all tenants.
  let sessionDoc: FirebaseFirestore.DocumentSnapshot | null = null;
  try {
    const groupSnap = await db
      .collectionGroup('commute_sessions')
      .where('id', '==', sessionId)
      .limit(1)
      .get();
    if (!groupSnap.empty) {
      sessionDoc = groupSnap.docs[0];
    }
  } catch (err: any) {
    logger.error('commute_sample_lookup_failed', { uid: callerUid, sessionId, message: err?.message });
    captureRouteError(err, 'commute.sample_lookup', { uid: callerUid, sessionId });
    return res.status(500).json({ error: 'commute sample failed' });
  }
  if (!sessionDoc) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const session = sessionDoc.data() ?? {};
  if (session.startedBy !== callerUid) {
    // Allow project members to append? The session is per-driver; only the
    // starter may append. Cross-driver appends would garble the trace.
    return res.status(403).json({ error: 'forbidden' });
  }
  if (session.endedAt) {
    return res.status(409).json({ error: 'Session already ended' });
  }

  try {
    await sessionDoc.ref.update({
      samples: admin.firestore.FieldValue.arrayUnion({
        lat,
        lng,
        speedKmh,
        accuracyM,
        timestamp,
      }),
    });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('commute_sample_failed', { uid: callerUid, sessionId, message: error?.message });
    captureRouteError(error, 'commute.sample', { uid: callerUid, sessionId });
    return res.status(500).json({ error: 'commute sample failed' });
  }
});

router.post('/end', verifyAuth, commuteLimiter, async (req, res) => {
  const callerUid = req.user.uid;
  const callerEmail: string | null = req.user.email ?? null;
  const { sessionId } = req.body ?? {};

  if (typeof sessionId !== 'string' || !SESSION_ID_REGEX.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  const db = admin.firestore();
  let sessionDoc: FirebaseFirestore.DocumentSnapshot | null = null;
  try {
    const groupSnap = await db
      .collectionGroup('commute_sessions')
      .where('id', '==', sessionId)
      .limit(1)
      .get();
    if (!groupSnap.empty) sessionDoc = groupSnap.docs[0];
  } catch (err: any) {
    logger.error('commute_end_lookup_failed', { uid: callerUid, sessionId, message: err?.message });
    captureRouteError(err, 'commute.end_lookup', { uid: callerUid, sessionId });
    return res.status(500).json({ error: 'commute end failed' });
  }
  if (!sessionDoc) {
    return res.status(404).json({ error: 'Session not found' });
  }
  const session = sessionDoc.data() ?? {};
  if (session.startedBy !== callerUid) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    await sessionDoc.ref.update({
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection('audit_logs').add({
      action: 'commute.end',
      module: 'driving',
      details: { sessionId },
      userId: callerUid,
      userEmail: callerEmail,
      projectId: session.projectId ?? null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('commute_end_failed', { uid: callerUid, sessionId, message: error?.message });
    captureRouteError(error, 'commute.end', { uid: callerUid, sessionId });
    return res.status(500).json({ error: 'commute end failed' });
  }
});

export default router;
