// Praeventio Guard — Route Scoring HTTP surface (driving safety routes).
//
// 2 stateless endpoints (pure compute over caller-supplied inputs):
//   POST /:projectId/routes/build-profile
//     body: { routeId, points, hazards }
//     200:  { profile: RouteRiskProfile }
//   POST /:projectId/routes/evaluate-driver
//     body: { driver, profile, requiredVehicleType? }
//     200:  { decision: RouteAssignmentDecision }
//
// No Firestore writes — the engine is pure compute over a route +
// hazard payload the caller assembles from their own collections.

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
  buildRouteRiskProfile,
  type RouteRiskProfile,
} from '../../services/routeScoring/criticalRouteScoring.js';
import { evaluateDriverRoute } from '../../services/routeScoring/driverRouteMatcher.js';

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

// Mirror the 9 RouteHazardKind values from criticalRouteScoring.ts.
const HAZARD_KINDS = [
  'sharp_curve',
  'steep_grade',
  'blind_spot',
  'high_traffic',
  'school_zone',
  'wildlife_crossing',
  'weather_prone',
  'fatigue_zone',
  'no_signal_zone',
] as const;

const HAZARD_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const;

const EXPERIENCE_TIERS = ['novice', 'intermediate', 'expert'] as const;

const FATIGUE_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

// RoutePoint mirror — `kmFromStart` is required by the engine to score
// segment hazards, so we don't make it optional here either.
const routePointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  altMeters: z.number().optional(),
  kmFromStart: z.number().nonnegative(),
});

// RouteSegmentHazard mirror — `fromKm`/`toKm` are the engine field names.
const hazardSchema = z.object({
  fromKm: z.number().nonnegative(),
  toKm: z.number().nonnegative(),
  kind: z.enum(HAZARD_KINDS),
  severity: z.enum(HAZARD_SEVERITIES),
});

const buildProfileSchema = z.object({
  routeId: z.string().min(1).max(200),
  points: z.array(routePointSchema).min(2).max(5000),
  hazards: z.array(hazardSchema).max(500),
});

router.post(
  '/:projectId/routes/build-profile',
  verifyAuth,
  validate(buildProfileSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildProfileSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const profile = buildRouteRiskProfile(
        body.routeId,
        body.points,
        body.hazards,
      );
      return res.json({ profile });
    } catch (err) {
      logger.error?.('routeScoring.buildProfile.error', err);
      captureRouteError(err, 'routeScoring.buildProfile');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const driverProfileSchema = z.object({
  uid: z.string().min(1).max(120),
  experienceLevel: z.enum(EXPERIENCE_TIERS),
  yearsLicensed: z.number().nonnegative().max(80),
  hoursDrivenLast30d: z.number().nonnegative(),
  incidentsLast12months: z.number().int().nonnegative(),
  vehicleTypesAuthorized: z.array(z.string().min(1).max(60)).max(50),
  fatigueLevel: z.enum(FATIGUE_LEVELS).optional(),
});

// RouteRiskProfile is the engine's own output shape. Accept it loosely
// from clients (they'll typically pass the buildProfile response).
// z.record(z.string(), z.unknown()) requires an object (not undefined/null),
// so a missing `profile` field yields 400 invalid_payload instead of a
// 500 from the engine dereferencing profile.recommendedDriverExperience.
const evaluateDriverSchema = z.object({
  driver: driverProfileSchema,
  profile: z.record(z.string(), z.unknown()) as unknown as z.ZodType<RouteRiskProfile>,
  requiredVehicleType: z.string().min(1).max(60).optional(),
});

router.post(
  '/:projectId/routes/evaluate-driver',
  verifyAuth,
  validate(evaluateDriverSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evaluateDriverSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = evaluateDriverRoute(
        body.driver,
        body.profile,
        body.requiredVehicleType,
      );
      return res.json({ decision });
    } catch (err) {
      logger.error?.('routeScoring.evaluateDriver.error', err);
      captureRouteError(err, 'routeScoring.evaluateDriver');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
