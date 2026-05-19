// Praeventio Guard — First Responder Map HTTP surface.
//
// Sprint 52 §219 — two stateless endpoints over the engine under
// `src/services/firstResponderMap/firstResponderMap.ts`:
//
//   POST /:projectId/first-responder-map/build-dispatch-plan
//     body: { responders, incident, options?, now? }
//     200:  { plan: DispatchPlan }
//
//   POST /:projectId/first-responder-map/analyze-coverage
//     body: { responders }
//     200:  { gaps: CoverageGap[] }
//
// Pure compute — no Firestore writes.

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
  buildDispatchPlan,
  analyzeCoverage,
  type Responder,
  type ResponderRole,
  type AvailabilityState,
  type IncidentKind,
  type IncidentLocation,
} from '../../services/firstResponderMap/firstResponderMap.js';

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

const ROLES: readonly ResponderRole[] = [
  'paramedic',
  'first_aid_certified',
  'fire_brigade',
  'rescue_specialist',
  'supervisor',
  'security_guard',
  'mutual_contact',
  'site_doctor',
];
const AVAILABILITIES: readonly AvailabilityState[] = [
  'on_duty',
  'on_break',
  'off_site',
  'unavailable',
  'in_response',
];
const KINDS: readonly IncidentKind[] = [
  'medical_emergency',
  'cardiac_arrest',
  'trauma_injury',
  'fire',
  'chemical_exposure',
  'fall_from_height',
  'confined_space_rescue',
  'electrical_injury',
  'mass_casualty',
];

const responderSchema = z.object({
  uid: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  roles: z.array(z.enum(ROLES as readonly [ResponderRole, ...ResponderRole[]])).max(ROLES.length),
  currentPosition: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      floor: z.number().int().min(-100).max(500).optional(),
    })
    .optional(),
  lastSeenAt: z.string().min(10).optional(),
  availability: z.enum(AVAILABILITIES as readonly [AvailabilityState, ...AvailabilityState[]]),
  sifCertified: z.boolean().optional(),
  activeAssignments: z.number().int().nonnegative().max(10_000).optional(),
  maxConcurrent: z.number().int().positive().max(10_000).optional(),
}) as unknown as z.ZodType<Responder>;

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  floor: z.number().int().min(-100).max(500).optional(),
  zoneId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<IncidentLocation>;

// ────────────────────────────────────────────────────────────────────────
// 1. build-dispatch-plan
// ────────────────────────────────────────────────────────────────────────

const dispatchSchema = z.object({
  responders: z.array(responderSchema).max(10_000),
  incident: z.object({
    kind: z.enum(KINDS as readonly [IncidentKind, ...IncidentKind[]]),
    location: locationSchema,
  }),
  options: z
    .object({
      walkSpeedMps: z.number().positive().max(20).optional(),
      maxLastSeenStaleSeconds: z.number().int().positive().max(86_400).optional(),
    })
    .optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/first-responder-map/build-dispatch-plan',
  verifyAuth,
  validate(dispatchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof dispatchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const plan = buildDispatchPlan(
        body.responders,
        body.incident,
        now,
        body.options ?? {},
      );
      return res.json({ plan });
    } catch (err) {
      logger.error?.('firstResponderMap.buildDispatchPlan.error', err);
      captureRouteError(err, 'firstResponderMap.buildDispatchPlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. analyze-coverage
// ────────────────────────────────────────────────────────────────────────

const coverageSchema = z.object({
  responders: z.array(responderSchema).max(10_000),
});

router.post(
  '/:projectId/first-responder-map/analyze-coverage',
  verifyAuth,
  validate(coverageSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof coverageSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const gaps = analyzeCoverage(body.responders);
      return res.json({ gaps });
    } catch (err) {
      logger.error?.('firstResponderMap.analyzeCoverage.error', err);
      captureRouteError(err, 'firstResponderMap.analyzeCoverage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
