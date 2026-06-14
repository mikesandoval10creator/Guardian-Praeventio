// Praeventio Guard — F.3 SIF Precursors (Serious Injury/Fatality).
//
// Endpoints dedicados para `/api/sprint-k/:projectId/sif/*`.
// Migrado del monolito `sprintK.ts` (2026-05-18).
//
// 3 endpoints:
//   GET  /:projectId/sif/pending-review            → precursors pendientes
//   POST /:projectId/sif/:id/executive-review      → grabar revisión ejecutiva
//   POST /:projectId/sif/:id/notify-mandante       → registrar notificación al mandante

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
import { SIFAdapter } from '../../services/sif/sifFirestoreAdapter.js';

const router = Router();

async function resolveTenantId(
  _callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

router.get(
  '/:projectId/sif/pending-review',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new SIFAdapter(
        admin.firestore(),
        g.tenantId,
        projectId,
      );
      const pending = await adapter.listPendingExecutiveReview();
      return res.json({ precursors: pending });
    } catch (err) {
      logger.error?.('sif.pending.error', err);
      captureRouteError(err, 'sif.pending');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// B4 (Fase 5): the reviewer identity and timestamp are stamped server-side
// from the verified token + server clock — NEVER the request body. A SIF
// (Serious Injury/Fatality) executive review is an accountability record;
// trusting `reviewedByUid`/`reviewedAt` from the client let a caller attribute
// the review to another executive and backdate it. Only `reviewNotes` is
// client-supplied.
const sifReviewSchema = z.object({
  reviewNotes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/sif/:id/executive-review',
  verifyAuth,
  validate(sifReviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof sifReviewSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new SIFAdapter(
        admin.firestore(),
        g.tenantId,
        projectId,
      );
      // reviewer = authenticated caller; reviewedAt = server clock.
      await adapter.recordExecutiveReview(
        id,
        callerUid,
        new Date().toISOString(),
        body.reviewNotes,
      );
      await auditServerEvent(req, 'sif.executive-review', 'sif', { projectId, precursorId: id }, { projectId });
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sif.review.error', err);
      captureRouteError(err, 'sif.review');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// Records that the client mandante was notified of a SIF precursor. Same B4
// security model as executive-review: the notifier (uid) and timestamp are
// stamped SERVER-SIDE from the verified token + clock, never the body — this is
// an accountability record (who informed the mandante, when). It does NOT push
// to any external/state system (founder directive: we record; the company
// handles delivery) — it only marks the internal compliance timestamp.
router.post(
  '/:projectId/sif/:id/notify-mandante',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new SIFAdapter(admin.firestore(), g.tenantId, projectId);
      // notifier = authenticated caller; notifiedAt = server clock.
      await adapter.recordMandanteNotification(id, callerUid, new Date().toISOString());
      await auditServerEvent(req, 'sif.notify-mandante', 'sif', { projectId, precursorId: id }, { projectId });
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sif.notifyMandante.error', err);
      captureRouteError(err, 'sif.notifyMandante');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
