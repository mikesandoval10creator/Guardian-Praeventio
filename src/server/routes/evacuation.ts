// Praeventio Guard — Evacuation headcount HTTP surface.
//
// Sprint 39 G.12 — four stateless endpoints over the engine under
// `src/services/evacuation/evacuationHeadcount.ts`:
//
//   POST /:projectId/evacuation/compute-status     { drill, now? }
//   POST /:projectId/evacuation/record-scan        { drill, scan }
//   POST /:projectId/evacuation/end-drill          { drill, endedAt? }
//   POST /:projectId/evacuation/build-postmortem   { drill }
//
// Pure compute — no Firestore writes. scannedByUid forced server-side to
// the authenticated caller on record-scan so clients cannot ghost-scan
// for another worker.

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
import {
  computeStatus,
  recordScan,
  endDrill,
  buildPostmortem,
  type EvacuationDrill,
} from '../../services/evacuation/evacuationHeadcount.js';

const router = Router();

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

const drillSchema = z.object({
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  kind: z.enum(['drill', 'real']),
  startedAt: z.string().min(10),
  startedByUid: z.string().min(1).max(200),
  meetingPointId: z.string().min(1).max(200),
  expectedWorkers: z.array(z.object({
    uid: z.string().min(1).max(200),
    fullName: z.string().min(1).max(500),
    lastKnownLocation: z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      at: z.string().min(10),
    }).optional(),
  })).max(50_000),
  scans: z.array(z.object({
    workerUid: z.string().min(1).max(200),
    scannedAt: z.string().min(10),
    meetingPointId: z.string().min(1).max(200),
    scannedByUid: z.string().min(1).max(200),
  })).max(50_000),
  endedAt: z.string().min(10).optional(),
}) as unknown as z.ZodType<EvacuationDrill>;

// ────────────────────────────────────────────────────────────────────────
// 1. compute-status
// ────────────────────────────────────────────────────────────────────────

const statusSchema = z.object({
  drill: drillSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/evacuation/compute-status',
  verifyAuth,
  validate(statusSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof statusSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const status = computeStatus(body.drill, now);
      return res.json({ status });
    } catch (err) {
      logger.error?.('evacuation.computeStatus.error', err);
      captureRouteError(err, 'evacuation.computeStatus');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. record-scan
// ────────────────────────────────────────────────────────────────────────

const scanSchema = z.object({
  drill: drillSchema,
  scan: z.object({
    workerUid: z.string().min(1).max(200),
    meetingPointId: z.string().min(1).max(200),
    scannedAt: z.string().min(10).optional(),
  }),
});

router.post(
  '/:projectId/evacuation/record-scan',
  verifyAuth,
  validate(scanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof scanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const drill = recordScan(body.drill, {
        ...body.scan,
        scannedByUid: callerUid,
      });
      return res.json({ drill });
    } catch (err) {
      logger.error?.('evacuation.recordScan.error', err);
      captureRouteError(err, 'evacuation.recordScan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. end-drill
// ────────────────────────────────────────────────────────────────────────

const endSchema = z.object({
  drill: drillSchema,
  endedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/evacuation/end-drill',
  verifyAuth,
  validate(endSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof endSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const drill = endDrill(body.drill, body.endedAt);
      return res.json({ drill });
    } catch (err) {
      logger.error?.('evacuation.endDrill.error', err);
      captureRouteError(err, 'evacuation.endDrill');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. build-postmortem
// ────────────────────────────────────────────────────────────────────────

const postmortemSchema = z.object({
  drill: drillSchema,
});

router.post(
  '/:projectId/evacuation/build-postmortem',
  verifyAuth,
  validate(postmortemSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof postmortemSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const postmortem = buildPostmortem(body.drill);
      return res.json({ postmortem });
    } catch (err) {
      logger.error?.('evacuation.buildPostmortem.error', err);
      captureRouteError(err, 'evacuation.buildPostmortem');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
