// SystemEngine â€” POST /api/system-events/emit.
//
// Server-side emit endpoint: clients that cannot write directly to
// `tenants/{tid}/system_events` (e.g. when the firestore.rules tighten to
// server-only writes for the bus) can POST here. The endpoint validates
// the envelope, stamps tenantId from the verified token, and writes via
// the Admin SDK (which bypasses client rules).

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';

import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { SystemEventSchema } from '../../services/systemEngine/eventTypes.js';
import { logger } from '../../utils/logger.js';

const router = Router();

// We trust the client to provide envelope + payload but ignore any
// `tenantId` they put in the body â€” we stamp it from the token claim, so
// a worker on tenant A cannot inject events into tenant B.
const emitBodySchema = z.object({
  event: SystemEventSchema,
});

router.post(
  '/emit',
  verifyAuth,
  idempotencyKey(),
  validate(emitBodySchema),
  async (req, res) => {
    const callerUid: string = req.user!.uid;
    const claimTenantId: string | null =
      typeof req.user!.tenantId === 'string'
        ? req.user!.tenantId
        : null;
    const { event } = req.body as z.infer<typeof emitBodySchema>;

    if (!claimTenantId) {
      // No tenantId claim â†’ the user is an anonymous / cross-tenant role.
      // We refuse rather than guess; the caller should get a tenant claim
      // before trying to emit on the bus.
      return res.status(403).json({ error: 'missing tenant claim' });
    }
    if (event.tenantId !== claimTenantId) {
      return res.status(403).json({ error: 'tenant mismatch' });
    }

    try {
      const db = admin.firestore();
      const path = `tenants/${claimTenantId}/system_events`;
      await db.collection(path).doc(event.id).set({
        ...event,
        actorUid: callerUid,
        serverTs: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, eventId: event.id });
    } catch (err) {
      logger.error('systemEvents.emit failed', err, {
        tenantId: claimTenantId,
        eventType: event.type,
      });
      return res.status(500).json({ error: 'emit failed' });
    }
  },
);

export default router;
