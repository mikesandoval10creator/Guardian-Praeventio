// Praeventio Guard — Driving safety telemetry HTTP surface.
//
// Three stateless endpoints over the engine under
// `src/services/driving/speedTrigger.ts`:
//
//   POST /:projectId/driving/haversine-meters          { a, b }
//   POST /:projectId/driving/accumulate-trip-mileage   { prevTotalM, prev, next, prevTimestampMs, nextTimestampMs }
//   POST /:projectId/driving/detect-aggressive-brake   { samples }
//
// Pure compute — no Firestore writes. Suitable for off-device telemetry
// post-processing (mobile uploads buffered GPS/IMU samples; server
// recomputes trip totals + brake events server-side for audit).

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
  haversineMeters,
  accumulateTripMileage,
  detectAggressiveBrake,
  type GeoPoint,
  type ImuSample,
} from '../../services/driving/speedTrigger.js';

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

const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(100_000).optional(),
}) as unknown as z.ZodType<GeoPoint>;

const imuSchema = z.object({
  timestampMs: z.number().int().nonnegative().max(1e16),
  longitudinalMs2: z.number().min(-100).max(100),
  lateralMs2: z.number().min(-100).max(100).optional(),
  verticalMs2: z.number().min(-100).max(100).optional(),
}) as unknown as z.ZodType<ImuSample>;

// ────────────────────────────────────────────────────────────────────────
// 1. haversine-meters
// ────────────────────────────────────────────────────────────────────────

const haversineSchema = z.object({
  a: geoSchema,
  b: geoSchema,
});

router.post(
  '/:projectId/driving/haversine-meters',
  verifyAuth,
  validate(haversineSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof haversineSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const meters = haversineMeters(body.a, body.b);
      return res.json({ meters });
    } catch (err) {
      logger.error?.('driving.haversineMeters.error', err);
      captureRouteError(err, 'driving.haversineMeters');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. accumulate-trip-mileage
// ────────────────────────────────────────────────────────────────────────

const accumulateSchema = z.object({
  prevTotalM: z.number().nonnegative().max(1e10),
  prev: geoSchema.nullable(),
  next: geoSchema,
  prevTimestampMs: z.number().int().nonnegative().max(1e16),
  nextTimestampMs: z.number().int().nonnegative().max(1e16),
});

router.post(
  '/:projectId/driving/accumulate-trip-mileage',
  verifyAuth,
  validate(accumulateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof accumulateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = accumulateTripMileage(
        body.prevTotalM,
        body.prev,
        body.next,
        body.prevTimestampMs,
        body.nextTimestampMs,
      );
      return res.json({ result });
    } catch (err) {
      logger.error?.('driving.accumulateTripMileage.error', err);
      captureRouteError(err, 'driving.accumulateTripMileage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. detect-aggressive-brake
// ────────────────────────────────────────────────────────────────────────

const brakeSchema = z.object({
  samples: z.array(imuSchema).max(100_000),
});

router.post(
  '/:projectId/driving/detect-aggressive-brake',
  verifyAuth,
  validate(brakeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof brakeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const triggerAt = detectAggressiveBrake(body.samples);
      return res.json({ triggerAt });
    } catch (err) {
      logger.error?.('driving.detectAggressiveBrake.error', err);
      captureRouteError(err, 'driving.detectAggressiveBrake');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
