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
import { auditServerEvent } from '../middleware/auditLog.js';
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

// ────────────────────────────────────────────────────────────────────────
// 3. issue-recommendation
//
// [P0][VIDA] PredictiveGuard showed "Condiciones adversas detectadas … ¿Deseas
// enviar una alerta para suspender trabajos en altura?" over two buttons with
// NO handler: the supervisor pressed "Sí, Enviar Alerta" and nothing left the
// screen.
//
// Praeventio recommends; a human decides, and the decision is recorded. This
// endpoint IS that record: the caller endorses a recommendation, it reaches the
// crew through the in-app notifications channel, and an audit row names who
// issued it. Server-side because a state change on a safety route must be
// audited (CLAUDE.md #3) and the issuer's identity has to come from the
// verified token, never from the client.
// ────────────────────────────────────────────────────────────────────────

const issueRecommendationSchema = z.object({
  /** Which detector produced it — 'weather.wind', 'weather.storm', … */
  source: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  /** What the crew should do — the actionable part for a worker. */
  recommendedAction: z.string().min(1).max(2000),
  /** The reading that motivated it, kept for traceability. */
  metric: z
    .object({
      kind: z.string().min(1).max(80),
      value: finiteNumber,
      unit: z.string().min(1).max(20),
    })
    .optional(),
});

router.post(
  '/:projectId/predictive-alerts/issue-recommendation',
  verifyAuth,
  validate(issueRecommendationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof issueRecommendationSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const nowIso = new Date().toISOString();
      const ref = await admin
        .firestore()
        .collection('projects')
        .doc(projectId)
        .collection('notifications')
        .add({
          kind: 'safety.recommendation_issued',
          createdAt: nowIso,
          read: false,
          title: body.title,
          body: body.body,
          recommendedAction: body.recommendedAction,
          source: body.source,
          metric: body.metric ?? null,
          // Identity from the verified token — never from the request body.
          issuedByUid: callerUid,
        });

      // Rule #14: awaited. A failure here is logged but must not fail the
      // user-facing action — the crew notification already went out.
      const auditOk = await auditServerEvent(
        req,
        'predictive_alerts.recommendation_issued',
        'predictive_alerts',
        {
          projectId,
          notificationId: ref.id,
          source: body.source,
          recommendedAction: body.recommendedAction,
          metric: body.metric ?? null,
        },
      );
      if (!auditOk) {
        captureRouteError(
          new Error('audit_write_failed'),
          'predictiveAlerts.audit',
          { audit_event: 'predictive_alerts.recommendation_issued', projectId },
        );
      }

      return res.status(201).json({ notificationId: ref.id, issuedAt: nowIso });
    } catch (err) {
      logger.error?.('predictiveAlerts.issueRecommendation.error', err);
      captureRouteError(err, 'predictiveAlerts.issueRecommendation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
