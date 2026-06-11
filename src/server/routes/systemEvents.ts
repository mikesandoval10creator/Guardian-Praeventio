// SystemEngine — POST /api/system-events/emit.
//
// Server-side emit endpoint: clients that cannot write directly to
// `projects/{pid}/system_events` can POST here. The endpoint validates the
// envelope, asserts the caller is a member of the event's project, stamps
// `actorUid` from the verified token (anti-spoof), and writes via the
// Admin SDK.
//
// A4 re-scope (2026-06): this route used to gate on a `tenantId` token
// claim and write `tenants/{tid}/system_events` — but no code path ever
// minted a tenant claim (only `role` and `assignedSiteIds` exist), so the
// route 403'd for every real user. Authorization is now the same primitive
// the rest of the server uses: `assertProjectMember()` against the
// `projects` collection (CLAUDE.md rule #6). `tenantId` stays inside the
// event payload as informational metadata.
//
// Audit-log invariant: every persisted system event produces exactly one
// idempotent `audit_logs` row via the server-side collectionGroup trigger
// (`src/server/triggers/systemEngineTrigger.ts` → makeSystemEventAuditor),
// which also covers client-SDK writes — so this handler does not write a
// second, duplicate row itself.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';

import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { SystemEventSchema } from '../../services/systemEngine/eventTypes.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { logger } from '../../utils/logger.js';

const router = Router();

// We trust the client to provide envelope + payload but ignore any
// `actorUid` they put in the body — we stamp it from the verified token,
// so a caller cannot emit events as somebody else.
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
    const { event } = req.body as z.infer<typeof emitBodySchema>;

    if (!event.projectId) {
      // The bus is project-scoped; an event without a project has no
      // cross-device destination. Clients keep such events local-only
      // (eventLog.ts) instead of POSTing them here.
      return res.status(400).json({ error: 'missing projectId' });
    }

    try {
      const db = admin.firestore();
      // Membership gate — same primitive as every projectId-accepting
      // route. Throws ProjectMembershipError (403) for non-members and
      // unknown projects alike (default-deny).
      await assertProjectMember(callerUid, event.projectId, db);

      const path = `projects/${event.projectId}/system_events`;
      await db.collection(path).doc(event.id).set({
        ...event,
        actorUid: callerUid,
        serverTs: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.json({ ok: true, eventId: event.id });
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      logger.error('systemEvents.emit failed', err, {
        projectId: event.projectId,
        eventType: event.type,
      });
      return res.status(500).json({ error: 'emit failed' });
    }
  },
);

export default router;
