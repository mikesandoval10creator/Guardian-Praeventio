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
import { randomId } from '../../utils/randomId.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
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
  // Crypto.randomUUID is available in Node 18+ (server runtime).
  // randomId() delegates to crypto.randomUUID() and exposes a documented
  // `fallback-…` token when the API is missing. We slice 7 chars to keep
  // the legacy short-suffix shape (`vis_<ts>_<7hex>`) that downstream
  // logs, audit rows, and tests already match.
  return `vis_${Date.now()}_${randomId().slice(0, 7)}`;
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

    const tenantId = await tenantIdFor(body.projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

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
    const visitorId = req.params.id;
    const projectIdRaw =
      typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!visitorId || !projectIdRaw) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const tenantId = await tenantIdFor(projectIdRaw);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    const ref = visitorsCollection(tenantId, projectIdRaw).doc(visitorId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'visitor_not_found' });
    }

    let event;
    try {
      event = checkOutVisitor(visitorId);
    } catch (err) {
      if (err instanceof VisitorRegistryError) {
        return res.status(400).json({ error: err.code });
      }
      throw err;
    }

    try {
      await ref.update({ checkOutAt: event.checkOutAt });
      return res.json({ ok: true, visitorId, checkOutAt: event.checkOutAt });
    } catch (err: any) {
      logger.error('visitor_check_out_failed', err, { visitorId });
      captureRouteError(err, 'visitors.check_out', { visitorId });
      return res.status(500).json({ error: 'visitor_check_out_failed' });
    }
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
    const visitorId = req.params.id;
    const { inductionVersionId } = req.validated as z.infer<typeof acknowledgeSchema>;
    const projectIdRaw =
      typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!visitorId || !projectIdRaw) {
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const tenantId = await tenantIdFor(projectIdRaw);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    const ref = visitorsCollection(tenantId, projectIdRaw).doc(visitorId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'visitor_not_found' });
    }

    let event;
    try {
      event = acknowledgeInduction(visitorId, inductionVersionId);
    } catch (err) {
      if (err instanceof VisitorRegistryError) {
        return res.status(400).json({ error: err.code });
      }
      throw err;
    }

    try {
      await ref.update({
        inductionVersionId: event.inductionVersionId,
        inductedAt: event.inductedAt,
      });
      return res.json({
        ok: true,
        visitorId,
        inductionVersionId: event.inductionVersionId,
        inductedAt: event.inductedAt,
      });
    } catch (err: any) {
      logger.error('visitor_ack_induction_failed', err, { visitorId });
      captureRouteError(err, 'visitors.acknowledge_induction', { visitorId });
      return res.status(500).json({ error: 'visitor_ack_induction_failed' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// GET /api/visitors?projectId=…
// ────────────────────────────────────────────────────────────────────────

router.get('/', verifyAuth, validate(listQuerySchema, 'query'), async (req, res) => {
  const { projectId } = req.validated as z.infer<typeof listQuerySchema>;

  const tenantId = await tenantIdFor(projectId);
  if (!tenantId) {
    return res.status(400).json({ error: 'project_missing_tenant' });
  }

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
