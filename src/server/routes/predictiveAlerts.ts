// Praeventio Guard — Predictive Alerts HTTP surface.
//
// Sprint 15 — two stateless endpoints over the engine under
// `src/services/predictiveAlerts/{windowedTrigger,alertScheduler}.ts`.
//
// Adaptación HTTP: el engine recibe un `ForecastFn` (closure). Sobre la
// red no se puede transportar una función, así que el body envía un
// array `forecastValues[i]` con la lectura prevista en `i+1` minutos, y
// el server construye la closure server-side. Esto es compatible con
// los pasos discretos que el engine ya hace.
//
//   POST /:projectId/predictive-alerts/should-fire-windowed
//     body: { ctx, forecastValues, options? }
//     200:  { decision: WindowedDecision }
//
//   POST /:projectId/predictive-alerts/evaluate-probes
//     body: { probes: ProbeWithForecast[], windowMinutes?, minLeadTimeMin? }
//     200:  { alerts: ScheduledAlert[] }

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
import { shouldFireWindowed } from '../../services/predictiveAlerts/windowedTrigger.js';
import { evaluateProbes } from '../../services/predictiveAlerts/alertScheduler.js';

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

const MAX_FORECAST_WINDOW = 240; // 4 horas máximo
const finiteNumber = z.number().refine(Number.isFinite, { message: 'must be finite' });

function arrayForecastFn(forecastValues: number[]): (minutesAhead: number) => number {
  // engine usa `forecast(m)` con m en [1, windowMinutes]; mapeamos a index m-1.
  return (minutesAhead: number): number => {
    if (minutesAhead < 1 || minutesAhead > forecastValues.length) return Number.NaN;
    const value = forecastValues[minutesAhead - 1];
    return value ?? Number.NaN;
  };
}

// ────────────────────────────────────────────────────────────────────────
// 1. should-fire-windowed
// ────────────────────────────────────────────────────────────────────────

const shouldFireSchema = z.object({
  ctx: z.object({
    currentValue: finiteNumber,
    threshold: finiteNumber,
    generatorId: z.string().min(1).max(200),
  }),
  forecastValues: z.array(finiteNumber).min(1).max(MAX_FORECAST_WINDOW),
  options: z
    .object({
      windowMinutes: z.number().int().positive().max(MAX_FORECAST_WINDOW).optional(),
      minLeadTimeMin: z.number().int().nonnegative().max(MAX_FORECAST_WINDOW).optional(),
      recommendedAction: z.string().min(1).max(2000).optional(),
    })
    .optional(),
});

router.post(
  '/:projectId/predictive-alerts/should-fire-windowed',
  verifyAuth,
  validate(shouldFireSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof shouldFireSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = shouldFireWindowed(
        body.ctx,
        arrayForecastFn(body.forecastValues),
        body.options ?? {},
      );
      return res.json({ decision });
    } catch (err) {
      logger.error?.('predictiveAlerts.shouldFire.error', err);
      captureRouteError(err, 'predictiveAlerts.shouldFire');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. evaluate-probes
// ────────────────────────────────────────────────────────────────────────

const evaluateSchema = z.object({
  probes: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        threshold: finiteNumber,
        currentValue: finiteNumber,
        forecastValues: z.array(finiteNumber).min(1).max(MAX_FORECAST_WINDOW),
      }),
    )
    .min(1)
    .max(1000),
  windowMinutes: z.number().int().positive().max(MAX_FORECAST_WINDOW).optional(),
  minLeadTimeMin: z.number().int().nonnegative().max(MAX_FORECAST_WINDOW).optional(),
});

router.post(
  '/:projectId/predictive-alerts/evaluate-probes',
  verifyAuth,
  validate(evaluateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evaluateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const alerts = evaluateProbes({
        probes: body.probes.map((p) => ({
          id: p.id,
          threshold: p.threshold,
          currentValue: p.currentValue,
          forecast: arrayForecastFn(p.forecastValues),
        })),
        windowMinutes: body.windowMinutes,
        minLeadTimeMin: body.minLeadTimeMin,
      });
      return res.json({ alerts });
    } catch (err) {
      logger.error?.('predictiveAlerts.evaluateProbes.error', err);
      captureRouteError(err, 'predictiveAlerts.evaluateProbes');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
