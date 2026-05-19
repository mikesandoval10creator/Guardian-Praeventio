// Praeventio Guard — Climate-aware scheduling HTTP surface.
//
// Sprint K §94 — two stateless endpoints over the engine under
// `src/services/climateAwareScheduling/climateAwareScheduling.ts`:
//
//   POST /:projectId/climate-scheduling/assess-task
//     body: { task, weather }
//     200:  { assessment: TaskWeatherAssessment }
//
//   POST /:projectId/climate-scheduling/build-daily-plan
//     body: { tasks, weather }
//     200:  { plan: DailyPlanAdjustment }
//
// Pure compute — no Firestore writes. Determines which tasks to
// proceed/add-controls/reschedule/suspend based on weather conditions.
// Per directive #2, recommendations only — never auto-blocks machinery.

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
  assessTaskWeather,
  buildDailyPlanAdjustment,
  type WeatherConditions,
  type ScheduledTask,
  type TaskCategory,
} from '../../services/climateAwareScheduling/climateAwareScheduling.js';

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

const CATEGORIES: readonly TaskCategory[] = [
  'altura',
  'izaje',
  'excavacion',
  'soldadura',
  'electrico',
  'pintura_exterior',
  'transporte',
  'oficina',
];

const weatherSchema = z.object({
  temperatureC: z.number().min(-80).max(80),
  humidityPercent: z.number().min(0).max(100),
  windSpeedMs: z.number().nonnegative().max(150),
  rainProbability: z.number().min(0).max(1),
  uvIndex: z.number().min(0).max(20),
  lightningRiskWithinHours: z.number().min(0).max(168).optional(),
  visibilityKm: z.number().nonnegative().max(100),
}) as unknown as z.ZodType<WeatherConditions>;

const taskSchema = z.object({
  id: z.string().min(1).max(200),
  category: z.enum(CATEGORIES as readonly [TaskCategory, ...TaskCategory[]]),
  scheduledHour: z.number().int().min(0).max(23),
  outdoor: z.boolean(),
  workerUids: z.array(z.string().min(1).max(200)).max(10_000),
}) as unknown as z.ZodType<ScheduledTask>;

// ────────────────────────────────────────────────────────────────────────
// 1. assess-task
// ────────────────────────────────────────────────────────────────────────

const assessSchema = z.object({
  task: taskSchema,
  weather: weatherSchema,
});

router.post(
  '/:projectId/climate-scheduling/assess-task',
  verifyAuth,
  validate(assessSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof assessSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const assessment = assessTaskWeather(body.task, body.weather);
      return res.json({ assessment });
    } catch (err) {
      logger.error?.('climateScheduling.assessTask.error', err);
      captureRouteError(err, 'climateScheduling.assessTask');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-daily-plan
// ────────────────────────────────────────────────────────────────────────

const dailyPlanSchema = z.object({
  tasks: z.array(taskSchema).max(10_000),
  weather: weatherSchema,
});

router.post(
  '/:projectId/climate-scheduling/build-daily-plan',
  verifyAuth,
  validate(dailyPlanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof dailyPlanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = buildDailyPlanAdjustment(body.tasks, body.weather);
      return res.json({ plan });
    } catch (err) {
      logger.error?.('climateScheduling.buildDailyPlan.error', err);
      captureRouteError(err, 'climateScheduling.buildDailyPlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
