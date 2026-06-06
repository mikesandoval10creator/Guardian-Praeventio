// Praeventio Guard — Sprint K §23-24: Control de Visitas + Inducción Express QR.
//
// Mounted via `app.use('/api/visitors', visitorsRouter)` in `server.ts`.
//
// Endpoints
//   • POST /api/visitors/check-in                  — register a new visit
//   • POST /api/visitors/:id/check-out             — close an active visit
//   • POST /api/visitors/:id/acknowledge-induction — pin induction version
//   • GET  /api/visitors?projectId=…               — list active visits
//
// Middleware stack mirrors the canonical mutating-route shape used by
// `incidents.ts`, `iot.ts` and `medicalAptitude.ts`:
//
//   verifyAuth → idempotencyKey() → validate(zodSchema) → handler
//
// The host uid ALWAYS comes from the verified token (`req.user!.uid`),
// NEVER from the request body. The tenantId NEVER comes from the body —
// it is resolved from `projects/{projectId}.tenantId`. Both rules
// mirror the defenses applied in `incidents.ts` / `emergency.ts` against
// cross-tenant writes.
//
// Firestore path:
//   tenants/{tenantId}/projects/{projectId}/visitors/{visitorId}
//
// The pure event functions live in
// `src/services/visitorControl/visitorRegistry.ts`; this route is the
// thin Express adapter responsible for the I/O.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  registerVisitor,
  acknowledgeInduction,
  checkOutVisitor,
  isActive,
  VisitorRegistryError,
  type Visitor,
  type RegisterVisitorPayload,
} from '../../services/visitorControl/visitorRegistry.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────

const checkInSchema = z.object({
  projectId: z.string().min(1).max(128),
  fullName: z.string().min(3).max(256),
  rut: z.string().min(3).max(32),
  company: z.string().min(1).max(256),
  reason: z.string().min(1).max(1024),
  /** Optional client-supplied UUID for offline-first idempotent retries. */
  id: z.string().min(1).max(128).optional(),
});

const acknowledgeSchema = z.object({
  inductionVersionId: z.string().min(1).max(128),
});

const listQuerySchema = z.object({
  projectId: z.string().min(1).max(128),
});

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Resolve tenantId from `projects/{projectId}.tenantId`. Null if missing. */
async function tenantIdFor(projectId: string): Promise<string | null> {
  const db = admin.firestore();
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const tid = (data as { tenantId?: unknown }).tenantId;
  return typeof tid === 'string' && tid.length > 0 ? tid : null;
}

/**
 * B11 (Fase 5): every visitor endpoint must confirm the caller is a MEMBER of
 * the target project before resolving its tenant — otherwise any authenticated
 * user could register/check-out/induct visitors (or list them) for ANY
 * projectId (cross-project write/read). Returns the tenantId, or writes the
 * error response and returns null.
 */
async function assertMemberAndResolveTenant(
  res: import('express').Response,
  callerUid: string,
  projectId: string,
): Promise<string | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await tenantIdFor(projectId);
  if (!tenantId) {
    res.status(400).json({ error: 'project_missing_tenant' });
    return null;
  }
  return tenantId;
}

function visitorsCollection(
  tenantId: string,
  projectId: string,
): FirebaseFirestore.CollectionReference {
  return admin
    .firestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('projects')
    .doc(projectId)
    .collection('visitors');
}

function newVisitorId(): string {
  // crypto.randomUUID() returns an RFC-4122 v4 UUID (128 bits of entropy).
  // Date.now() prefix preserves sort order for log/audit scanners.
  return `vis_${Date.now()}_${randomUUID()}`;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/visitors/check-in
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/check-in',
  verifyAuth,
  idempotencyKey(),
  validate(checkInSchema),
  async (req, res) => {
    const hostUid = req.user!.uid;
    const body = req.validated as z.infer<typeof checkInSchema>;

    const tenantId = await assertMemberAndResolveTenant(res, hostUid, body.projectId);
    if (!tenantId) return undefined;

    const visitorId = body.id ?? newVisitorId();

    let payload: RegisterVisitorPayload;
    try {
      payload = {
        id: visitorId,
        fullName: body.fullName,
        rut: body.rut,
        company: body.company,
        hostUid,
        reason: body.reason,
        projectId: body.projectId,
        tenantId,
      };
    } catch (err) {
      // Defensive — should not be reachable given the Zod gate above.
      return res.status(400).json({ error: 'invalid_payload' });
    }

    let event;
    try {
      event = registerVisitor(payload);
    } catch (err) {
      if (err instanceof VisitorRegistryError) {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      throw err;
    }

    try {
      await visitorsCollection(tenantId, body.projectId)
        .doc(visitorId)
        .set(event.visitor, { merge: false });
      // CLAUDE.md #3: state change must be audited.
      await auditServerEvent(req, 'visitors.check_in', 'visitors', {
        visitorId,
        projectId: body.projectId,
        company: body.company,
      }, { projectId: body.projectId });
      return res.json({ ok: true, visitor: event.visitor });
    } catch (err: any) {
      logger.error('visitor_check_in_failed', err, { hostUid, visitorId });
      captureRouteError(err, 'visitors.check_in', { hostUid, visitorId });
      return res.status(500).json({ error: 'visitor_check_in_failed' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// POST /api/visitors/:id/check-out
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:id/check-out',
  verifyAuth,
  idempotencyKey(),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const visitorId = req.params.id;
    const projectIdRaw =
      typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!visitorId || !projectIdRaw) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const tenantId = await assertMemberAndResolveTenant(res, callerUid, projectIdRaw);
    if (!tenantId) return undefined;

    const ref = visitorsCollection(tenantId, projectIdRaw).doc(visitorId);
    // CLAUDE.md #19: get() + update() on the same visitor doc must be atomic so
    // two concurrent check-outs can't race on checkOutAt (lost update).
    type R =
      | { kind: 'not_found' }
      | { kind: 'invalid'; code: string }
      | { kind: 'ok'; checkOutAt: string };
    let result: R;
    try {
      result = await admin.firestore().runTransaction<R>(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return { kind: 'not_found' };
        let event;
        try {
          event = checkOutVisitor(visitorId);
        } catch (err) {
          if (err instanceof VisitorRegistryError) {
            return { kind: 'invalid', code: err.code };
          }
          throw err;
        }
        txn.update(ref, { checkOutAt: event.checkOutAt });
        return { kind: 'ok', checkOutAt: event.checkOutAt };
      });
    } catch (err: any) {
      logger.error('visitor_check_out_failed', err, { visitorId });
      captureRouteError(err, 'visitors.check_out', { visitorId });
      return res.status(500).json({ error: 'visitor_check_out_failed' });
    }

    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'visitor_not_found' });
    }
    if (result.kind === 'invalid') {
      return res.status(400).json({ error: result.code });
    }
    // CLAUDE.md #3: state change must be audited.
    await auditServerEvent(req, 'visitors.check_out', 'visitors', {
      visitorId,
      projectId: projectIdRaw,
      checkOutAt: result.checkOutAt,
    }, { projectId: projectIdRaw });
    return res.json({ ok: true, visitorId, checkOutAt: result.checkOutAt });
  },
);

// ────────────────────────────────────────────────────────────────────────
// POST /api/visitors/:id/acknowledge-induction
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:id/acknowledge-induction',
  verifyAuth,
  idempotencyKey(),
  validate(acknowledgeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const visitorId = req.params.id;
    const { inductionVersionId } = req.validated as z.infer<typeof acknowledgeSchema>;
    const projectIdRaw =
      typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!visitorId || !projectIdRaw) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const tenantId = await assertMemberAndResolveTenant(res, callerUid, projectIdRaw);
    if (!tenantId) return undefined;

    const ref = visitorsCollection(tenantId, projectIdRaw).doc(visitorId);
    // CLAUDE.md #19: get() + update() on the same visitor doc must be atomic.
    type R =
      | { kind: 'not_found' }
      | { kind: 'invalid'; code: string }
      | { kind: 'ok'; inductionVersionId: string; inductedAt: string };
    let result: R;
    try {
      result = await admin.firestore().runTransaction<R>(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) return { kind: 'not_found' };
        let event;
        try {
          event = acknowledgeInduction(visitorId, inductionVersionId);
        } catch (err) {
          if (err instanceof VisitorRegistryError) {
            return { kind: 'invalid', code: err.code };
          }
          throw err;
        }
        txn.update(ref, {
          inductionVersionId: event.inductionVersionId,
          inductedAt: event.inductedAt,
        });
        return {
          kind: 'ok',
          inductionVersionId: event.inductionVersionId,
          inductedAt: event.inductedAt,
        };
      });
    } catch (err: any) {
      logger.error('visitor_ack_induction_failed', err, { visitorId });
      captureRouteError(err, 'visitors.acknowledge_induction', { visitorId });
      return res.status(500).json({ error: 'visitor_ack_induction_failed' });
    }

    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'visitor_not_found' });
    }
    if (result.kind === 'invalid') {
      return res.status(400).json({ error: result.code });
    }
    // CLAUDE.md #3: state change must be audited.
    await auditServerEvent(req, 'visitors.acknowledge_induction', 'visitors', {
      visitorId,
      projectId: projectIdRaw,
      inductionVersionId: result.inductionVersionId,
    }, { projectId: projectIdRaw });
    return res.json({
      ok: true,
      visitorId,
      inductionVersionId: result.inductionVersionId,
      inductedAt: result.inductedAt,
    });
  },
);

// ────────────────────────────────────────────────────────────────────────
// GET /api/visitors?projectId=…
// ────────────────────────────────────────────────────────────────────────

router.get('/', verifyAuth, validate(listQuerySchema, 'query'), async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.validated as z.infer<typeof listQuerySchema>;

  const tenantId = await assertMemberAndResolveTenant(res, callerUid, projectId);
  if (!tenantId) return undefined;

  try {
    // We deliberately filter "active" (no checkOutAt) client-side because
    // Firestore has no "field-does-not-exist" predicate. Active visit
    // counts are typically <100 per site, so this is cheap.
    const snap = await visitorsCollection(tenantId, projectId).get();
    const visitors = snap.docs
      .map((d) => d.data() as Visitor)
      .filter(isActive);
    return res.json({ ok: true, visitors });
  } catch (err: any) {
    logger.error('visitor_list_failed', err, { projectId });
    captureRouteError(err, 'visitors.list', { projectId });
    return res.status(500).json({ error: 'visitor_list_failed' });
  }
});

export default router;
