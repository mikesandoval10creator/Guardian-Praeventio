// Praeventio Guard — Emergency Comms Drill HTTP surface.
//
// Sprint 53 §215-218 — drill comunicación emergencia + prueba mensual
// cadena + verificación contactabilidad + radios y dispositivos audibles.
//
// 4 stateless endpoints over the engine under
// `src/services/commsDrill/commsDrillEngine.ts`:
//
//   POST /:projectId/comms-drills/list-scripts
//     body: {}
//     200:  { scripts: DrillScenario[] }
//
//   POST /:projectId/comms-drills/get-by-id
//     body: { id }
//     200:  { scenario: DrillScenario | null }
//
//   POST /:projectId/comms-drills/score
//     body: DrillExecutionInput
//     200:  { report: DrillScoreReport }
//
//   POST /:projectId/comms-drills/plan-schedule
//     body: { pastExecutions, now? }
//     200:  { schedule: DrillScheduleEntry[] }
//
// Pure compute — no Firestore writes. Caller persists execution records
// + schedule to their own collections.

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
  listDrillScripts,
  getDrillById,
  scoreDrill,
  planDrillSchedule,
  type DrillExecutionInput,
  type PastDrillExecution,
} from '../../services/commsDrill/commsDrillEngine.js';

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

const COMMS_CHANNELS = [
  'radio_vhf',
  'radio_uhf',
  'phone_cell',
  'phone_satellite',
  'app_push',
  'sms',
  'whatsapp',
  'pa_loudspeaker',
  'face_to_face',
] as const;

const DRILL_VERDICTS = [
  'excellent',
  'satisfactory',
  'deficient',
  'failed',
] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. list-scripts
// ────────────────────────────────────────────────────────────────────────

const listScriptsSchema = z.object({}).strict();

router.post(
  '/:projectId/comms-drills/list-scripts',
  verifyAuth,
  validate(listScriptsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const scripts = listDrillScripts();
      return res.json({ scripts });
    } catch (err) {
      logger.error?.('commsDrill.listScripts.error', err);
      captureRouteError(err, 'commsDrill.listScripts');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. get-by-id
// ────────────────────────────────────────────────────────────────────────

const getByIdSchema = z.object({
  id: z.string().min(1).max(120),
});

router.post(
  '/:projectId/comms-drills/get-by-id',
  verifyAuth,
  validate(getByIdSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof getByIdSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const scenario = getDrillById(body.id);
      return res.json({ scenario });
    } catch (err) {
      logger.error?.('commsDrill.getById.error', err);
      captureRouteError(err, 'commsDrill.getById');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. score
// ────────────────────────────────────────────────────────────────────────

const drillTargetSchema = z.object({
  uid: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  expectedChannels: z.array(z.enum(COMMS_CHANNELS)).max(20),
});

const confirmationSchema = z.object({
  targetUid: z.string().min(1).max(120),
  channelUsed: z.enum(COMMS_CHANNELS),
  receivedAtSeconds: z.number().nonnegative().max(86_400),
  onTime: z.boolean(),
});

const outageSchema = z.object({
  channel: z.enum(COMMS_CHANNELS),
  from: z.number().nonnegative(),
  to: z.number().nonnegative(),
});

const scoreSchema = z.object({
  scenarioId: z.string().min(1).max(120),
  targets: z.array(drillTargetSchema).max(500),
  confirmations: z.array(confirmationSchema).max(500),
  channelOutages: z.array(outageSchema).max(50).optional(),
  executedAt: z.string().min(10),
}) as unknown as z.ZodType<DrillExecutionInput>;

router.post(
  '/:projectId/comms-drills/score',
  verifyAuth,
  validate(scoreSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as DrillExecutionInput;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = scoreDrill(body);
      return res.json({ report });
    } catch (err) {
      logger.error?.('commsDrill.score.error', err);
      captureRouteError(err, 'commsDrill.score');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. plan-schedule
// ────────────────────────────────────────────────────────────────────────

const pastExecutionSchema = z.object({
  scenarioId: z.string().min(1).max(120),
  executedAt: z.string().min(10),
  verdict: z.enum(DRILL_VERDICTS),
}) as unknown as z.ZodType<PastDrillExecution>;

const planScheduleSchema = z.object({
  pastExecutions: z.array(pastExecutionSchema).max(500),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/comms-drills/plan-schedule',
  verifyAuth,
  validate(planScheduleSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof planScheduleSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const schedule = planDrillSchedule(
        body.pastExecutions,
        body.now ? new Date(body.now) : new Date(),
      );
      return res.json({ schedule });
    } catch (err) {
      logger.error?.('commsDrill.planSchedule.error', err);
      captureRouteError(err, 'commsDrill.planSchedule');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
