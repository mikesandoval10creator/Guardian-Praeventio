// Praeventio Guard — F.4 Corrective Actions Center.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/corrective-actions*`.
// Migrado del monolito `sprintK.ts` (2026-05-18).
//
// 3 endpoints:
//   GET  /:projectId/corrective-actions[?status=open|in_progress|closed|verified|reopened]
//   POST /:projectId/corrective-actions                                  → create
//   POST /:projectId/corrective-actions/:actionId/effectiveness-review   → schedule review
//
// Codex P2 fixes preservados (PR #309 rounds 1-4):
//   - Accept full F.4 status set en filter (5 status: open/in_progress/
//     closed/verified/reopened) para que la página vea acciones reabiertas.
//   - Effectiveness-review schedule persiste `effectivenessReviewAt` así
//     el cron F.11 puede picar.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { CorrectiveActionsAdapter } from '../../services/correctiveActions/correctiveActionsFirestoreAdapter.js';

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
  '/:projectId/corrective-actions',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new CorrectiveActionsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const status =
        typeof req.query.status === 'string' ? req.query.status : 'open';
      type AnyStatus =
        | 'open'
        | 'in_progress'
        | 'closed'
        | 'verified'
        | 'reopened';
      const ALL_STATUSES: ReadonlySet<AnyStatus> = new Set([
        'open',
        'in_progress',
        'closed',
        'verified',
        'reopened',
      ]);
      const validStatus: AnyStatus = ALL_STATUSES.has(status as AnyStatus)
        ? (status as AnyStatus)
        : 'open';
      const [byStatus, systemic] = await Promise.all([
        adapter.listByStatus(validStatus),
        adapter.listSystemic(),
      ]);
      return res.json({ actions: byStatus, systemic });
    } catch (err) {
      logger.error?.('correctiveActions.list.error', err);
      captureRouteError(err, 'correctiveActions.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const scheduleReviewSchema = z.object({
  actionId: z.string().min(1),
  reviewAt: z.string().min(10),
});

router.post(
  '/:projectId/corrective-actions/:actionId/effectiveness-review',
  verifyAuth,
  validate(scheduleReviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, actionId } = req.params;
    const body = req.body as z.infer<typeof scheduleReviewSchema>;
    if (body.actionId !== actionId) {
      return res.status(400).json({ error: 'actionId_mismatch' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      await admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/corrective_actions`,
        )
        .doc(actionId)
        .set(
          {
            effectivenessReviewAt: body.reviewAt,
            effectivenessReviewScheduledBy: callerUid,
            effectivenessReviewScheduledAt: new Date().toISOString(),
          },
          { merge: true },
        );
      return res.status(204).end();
    } catch (err) {
      logger.error?.('correctiveActions.scheduleReview.error', err);
      captureRouteError(err, 'correctiveActions.scheduleReview');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const correctiveActionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(3).max(4000),
  level: z
    .enum([
      'elimination',
      'engineering',
      'administrative',
      'training',
      'epp',
      'supervision',
      'communication',
    ])
    .optional(),
  status: z.enum(['open', 'closed', 'verified']),
  isSystemic: z.boolean(),
  sourceCause: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/corrective-actions',
  verifyAuth,
  validate(correctiveActionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof correctiveActionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new CorrectiveActionsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      await adapter.save(body);
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('correctiveActions.create.error', err);
      captureRouteError(err, 'correctiveActions.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
