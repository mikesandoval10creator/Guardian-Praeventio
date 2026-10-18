// Server-owned commute lifecycle and sample persistence. The tenant comes
// from the project, identity from verifyAuth, and audits commit with lifecycle
// writes. Active pointers are server-only (top-level default-deny collection).

import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { logger } from '../../utils/logger.js';
import { createHash, randomUUID } from 'node:crypto';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { MAX_SAMPLES } from '../../services/driving/commuteLimits.js';

import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const router = Router();

const SESSION_ID_REGEX = /^[A-Za-z0-9_\-:.]{1,128}$/;
const VALID_TYPES = new Set(['home-to-site', 'site-to-home', 'between-sites']);

// Per-uid rate limiter — same shape as geminiLimiter (30 req / 15 min).
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
  const db = getFirestore();
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const tid = data.tenantId;
  return typeof tid === 'string' && tid.length > 0 ? tid : null;
}

// A deterministic document serializes starts for one actor/project/tenant,
// including the empty-query case. Do not put this under the tenant's readable
// catch-all subcollections; clients must recover through the authenticated API.
function activeRef(db: FirebaseFirestore.Firestore, tenantId: string, projectId: string, uid: string) {
  const key = createHash('sha256').update(JSON.stringify([tenantId, projectId, uid])).digest('hex');
  return db.collection('commute_active').doc(key);
}

class ActiveCommuteConflict extends Error {}

function metadata(doc: FirebaseFirestore.DocumentSnapshot, projectId: string, uid: string) {
  const session = doc.data() ?? {};
  if (session.startedBy !== uid || session.projectId !== projectId
    || session.id !== doc.id || !SESSION_ID_REGEX.test(doc.id) || !VALID_TYPES.has(session.type)) {
    throw new Error('Invalid active commute metadata');
  }
  return { sessionId: doc.id, projectId, type: session.type as string };
}

async function findActive(
  db: FirebaseFirestore.Firestore, tx: FirebaseFirestore.Transaction,
  tenantId: string, projectId: string, uid: string,
) {
  const pointer = await tx.get(activeRef(db, tenantId, projectId, uid));
  const id: unknown = pointer.data()?.sessionId;
  const sessions = db.collection(`tenants/${tenantId}/commute_sessions`);
  if (id !== undefined && id !== null) {
    if (typeof id !== 'string' || !SESSION_ID_REGEX.test(id)) throw new Error('Invalid active commute pointer');
    const current = await tx.get(sessions.doc(id));
    if (current.exists && current.data()?.endedAt == null) {
      metadata(current, projectId, uid);
      return current;
    }
  }
  // Adopt a single legacy open session without rewriting its evidence. More
  // than one is ambiguous: never pick an arbitrary trip or create another one.
  const legacy = await tx.get(sessions.where('projectId', '==', projectId)
    .where('startedBy', '==', uid).where('endedAt', '==', null).limit(2));
  if (legacy.size > 1) throw new ActiveCommuteConflict('Multiple open commute sessions');
  const current = legacy.docs[0] ?? null;
  if (current) metadata(current, projectId, uid);
  return current;
}

router.get('/active', verifyAuth, commuteLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const callerUid = req.user!.uid;
  const { projectId } = req.query;
  if (typeof projectId !== 'string' || !SESSION_ID_REGEX.test(projectId)) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }
  const db = getFirestore();
  try {
    await assertProjectMember(callerUid, projectId, db);
    const tenantId = await tenantIdFor(projectId);
    if (!tenantId) return res.status(400).json({ error: 'Project missing tenantId' });
    const session = await db.runTransaction(async (tx) => {
      const current = await findActive(db, tx, tenantId, projectId, callerUid);
      return current ? metadata(current, projectId, callerUid) : null;
    });
    return res.json({ success: true, session });
  } catch (error) {
    if (error instanceof ProjectMembershipError) return res.status(error.httpStatus).json({ error: 'forbidden' });
    if (error instanceof ActiveCommuteConflict) return res.status(409).json({ error: error.message });
    captureRouteError(error, 'commute.active', { uid: callerUid, projectId });
    return res.status(500).json({ error: 'commute recovery failed' });
  }
});

router.post('/start', verifyAuth, commuteLimiter, async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail: string | null = req.user!.email ?? null;
  const { type, projectId } = req.body ?? {};

  if (typeof projectId !== 'string' || !SESSION_ID_REGEX.test(projectId)) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  const db = getFirestore();
  // Generate IDs once, outside the retriable callback. Session, pointer and
  // audit either commit together or are all discarded by Firestore.
  const newSessionId = `cs_${Date.now()}_${randomUUID()}`;
  const auditId = db.collection('audit_logs').doc().id;
  try {
    await assertProjectMember(callerUid, projectId, db);
    const tenantId = await tenantIdFor(projectId);
    if (!tenantId) return res.status(400).json({ error: 'Project missing tenantId' });
    const sessionId = await db.runTransaction(async (tx) => {
      const current = await findActive(db, tx, tenantId, projectId, callerUid);
      if (current) {
        if (current.data()?.type !== type) throw new ActiveCommuteConflict('An active commute has a different type');
        tx.set(activeRef(db, tenantId, projectId, callerUid), { sessionId: current.id });
        return current.id;
      }
      tx.set(db.collection(`tenants/${tenantId}/commute_sessions`).doc(newSessionId), {
        id: newSessionId, projectId, type, startedBy: callerUid,
        startedAt: FieldValue.serverTimestamp(), endedAt: null, samples: [],
      });
      tx.set(activeRef(db, tenantId, projectId, callerUid), { sessionId: newSessionId });
      tx.set(db.collection('audit_logs').doc(auditId), {
        action: 'commute.start', module: 'driving', details: { sessionId: newSessionId, type },
        userId: callerUid, userEmail: callerEmail, projectId,
        timestamp: FieldValue.serverTimestamp(), ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      return newSessionId;
    });
    return res.json({ success: true, sessionId });
  } catch (error) {
    if (error instanceof ProjectMembershipError) return res.status(error.httpStatus).json({ error: 'forbidden' });
    if (error instanceof ActiveCommuteConflict) return res.status(409).json({ error: error.message });
    captureRouteError(error, 'commute.start', { uid: callerUid, projectId });
    return res.status(500).json({ error: 'commute start failed' });
  }
});

router.post('/sample', verifyAuth, commuteLimiter, async (req, res) => {
  const callerUid = req.user!.uid;
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

  const db = getFirestore();
  // Look up session to validate ownership. The session lives under
  // `tenants/{tenantId}/commute_sessions/{id}`, but the body doesn't
  // carry tenantId — we resolve it via the session's `projectId` field.
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
  try {
    const ref = sessionDoc.ref;
    const outcome = await db.runTransaction(async (tx) => {
      // Lookup only resolves the document path. Authorization and lifecycle
      // must be checked again against the same snapshot used for the write.
      const current = await tx.get(ref);
      if (!current.exists) return { status: 404, error: 'Session not found' };
      const session = current.data() ?? {};
      if (session.startedBy !== callerUid) return { status: 403, error: 'forbidden' };
      if (session.endedAt != null) return { status: 409, error: 'Session already ended' };
      const samples: unknown = session.samples === undefined ? [] : session.samples;
      if (!Array.isArray(samples)) throw new Error('Invalid commute sample buffer');
      const next = { lat, lng, speedKmh, accuracyM, timestamp };
      // Preserve arrayUnion's exact-map replay semantics within the retained window.
      const duplicate = samples.some((sample: unknown) => sample !== null && typeof sample === 'object'
        && Object.keys(sample).length === Object.keys(next).length
        && Object.entries(next).every(([key, value]) => (sample as Record<string, unknown>)[key] === value));
      if (!duplicate || samples.length > MAX_SAMPLES) {
        tx.update(ref, { samples: (duplicate ? samples : [...samples, next]).slice(-MAX_SAMPLES) });
      }
      return { status: 200, error: null };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('commute_sample_failed', { uid: callerUid, sessionId, message: error?.message });
    captureRouteError(error, 'commute.sample', { uid: callerUid, sessionId });
    return res.status(500).json({ error: 'commute sample failed' });
  }
});

router.post('/end', verifyAuth, commuteLimiter, async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail: string | null = req.user!.email ?? null;
  const { sessionId } = req.body ?? {};

  if (typeof sessionId !== 'string' || !SESSION_ID_REGEX.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  const db = getFirestore();
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
  const ref = sessionDoc.ref;
  const auditId = db.collection('audit_logs').doc().id;
  try {
    const outcome = await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (!current.exists) return { status: 404, error: 'Session not found' };
      const session = current.data() ?? {};
      if (session.startedBy !== callerUid) return { status: 403, error: 'forbidden' };
      // Preserve the first close timestamp and its audit on retries, even if a
      // newer trip is already open. An old end must never clear its pointer.
      if (session.endedAt != null) return { status: 200, error: null };
      const tenantId = current.ref.path.split('/')[1];
      const pointerRef = typeof session.projectId === 'string'
        ? activeRef(db, tenantId, session.projectId, callerUid) : null;
      const pointer = pointerRef ? await tx.get(pointerRef) : null;
      tx.update(current.ref, { endedAt: FieldValue.serverTimestamp() });
      if (pointerRef && pointer?.data()?.sessionId === sessionId) tx.delete(pointerRef);
      tx.set(db.collection('audit_logs').doc(auditId), {
        action: 'commute.end', module: 'driving', details: { sessionId },
        userId: callerUid, userEmail: callerEmail, projectId: session.projectId ?? null,
        timestamp: FieldValue.serverTimestamp(), ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      return { status: 200, error: null };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    return res.json({ success: true });
  } catch (error: any) {
    logger.error('commute_end_failed', { uid: callerUid, sessionId, message: error?.message });
    captureRouteError(error, 'commute.end', { uid: callerUid, sessionId });
    return res.status(500).json({ error: 'commute end failed' });
  }
});

export default router;
