// Praeventio Guard — Shift Risk Panel (Pre-Turno) HTTP surface.
//
// Sprint 40 F.21 — one stateless endpoint over the engine under
// `src/services/shiftRiskPanel/preShiftRiskComposer.ts`:
//
//   POST /:projectId/shift-risk-panel/compose
//     body: ShiftRiskInputs (projectId from URL)
//     200:  { report: ShiftRiskReport }
//
// Determinístico, sin ML. Recomendaciones, no decisiones (directive #2).

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
  composeShiftRiskPanel,
  type ShiftRiskInputs,
} from '../../services/shiftRiskPanel/preShiftRiskComposer.js';

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

const SHIFT_PERIODS = ['day', 'evening', 'night'] as const;
const FATIGUE_LEVELS = ['low', 'moderate', 'high', 'critical'] as const;
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const composeSchema = z.object({
  shift: z.enum(SHIFT_PERIODS),
  date: z.string().min(8).max(20),
  weather: z.object({
    rainProbability: z.number().min(0).max(1),
    windSpeedMs: z.number().min(0).max(200),
    uvIndex: z.number().min(0).max(20),
    temperatureC: z.number().min(-50).max(70),
    lightningRiskWithinHours: z.number().nonnegative().max(168).optional(),
    visibilityKm: z.number().nonnegative().max(200),
  }),
  workers: z
    .array(
      z.object({
        uid: z.string().min(1).max(200),
        fullName: z.string().min(1).max(500),
        fatigueRisk: z.enum(FATIGUE_LEVELS).optional(),
        daysSinceHire: z.number().nonnegative().max(50_000),
        hasNightShiftHistory: z.boolean().optional(),
      }),
    )
    .max(10_000),
  plannedTasks: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        category: z.string().min(1).max(200),
        isCriticalTask: z.boolean(),
        requiresPermit: z.boolean().optional(),
      }),
    )
    .max(10_000),
  equipment: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        code: z.string().min(1).max(200),
        overdueMaintenance: z.boolean().optional(),
      }),
    )
    .max(10_000),
  recentIncidents: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        severity: z.enum(INCIDENT_SEVERITIES),
        occurredAt: z.string().min(10).max(64),
      }),
    )
    .max(10_000),
  activePermitsCount: z.number().nonnegative().max(100_000),
  emergencyBrigadeReady: z.boolean(),
});

router.post(
  '/:projectId/shift-risk-panel/compose',
  verifyAuth,
  validate(composeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof composeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const inputs: ShiftRiskInputs = { ...body, projectId };
      const report = composeShiftRiskPanel(inputs);
      return res.json({ report });
    } catch (err) {
      logger.error?.('shiftRiskPanel.compose.error', err);
      captureRouteError(err, 'shiftRiskPanel.compose');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
