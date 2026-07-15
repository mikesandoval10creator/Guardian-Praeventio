// Praeventio Guard — audited worker mutation endpoints.
//
// Part of the "server-side traceability of critical mutations" remediation
// (see docs/audits/DIRECT-WRITES-INVENTORY-2026-07-14.md). Worker records are
// PII in a regulated product (Ley 16.744); every edit MUST leave an immutable
// audit trail, which a client-side `updateDoc` cannot guarantee. This router is
// the audited path: verifyAuth + assertProjectMember + audit_logs, server SDK.
//
//   PATCH /api/projects/:projectId/workers/:workerId → update fields (200)
//
// Worker docs live at `projects/{projectId}/workers/{workerId}` (project-scoped;
// access is gated by project membership, not a tenant prefix). Create + the
// legacy global `workers` collection + bulk import are tracked follow-ups in
// the inventory — this PR migrates the edit path the audit flagged first.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const router = Router();

// Only these fields may be mutated through the endpoint. `projectId`, `id`,
// `nodeId`, `joinedAt` and any server/compliance field are intentionally NOT
// here — a client cannot reparent a worker or forge provenance.
const updateSchema = z
  .object({
    name: z.string().min(1).max(200),
    role: z.string().min(1).max(200),
    email: z.string().email().max(320),
    phone: z.string().min(1).max(40),
    status: z.enum(['active', 'inactive']),
    hasArt22: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, {
    message: 'at least one field is required',
  });

router.patch(
  '/projects/:projectId/workers/:workerId',
  verifyAuth,
  validate(updateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, workerId } = req.params;
    const patchIn = req.validated as z.infer<typeof updateSchema>;

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    try {
      const db = admin.firestore();
      const ref = db
        .collection('projects')
        .doc(projectId)
        .collection('workers')
        .doc(workerId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'worker_not_found' });
      }

      const patch = { ...patchIn, updatedAt: new Date().toISOString() };
      await ref.update(patch);

      await auditServerEvent(
        req,
        'workers.update',
        'workers',
        { workerId, fields: Object.keys(patchIn) },
        { projectId },
      );

      return res
        .status(200)
        .json({ worker: { id: workerId, ...snap.data(), ...patch } });
    } catch (err) {
      logger.error?.('workers.update.error', err);
      captureRouteError(err, 'workers.update');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
