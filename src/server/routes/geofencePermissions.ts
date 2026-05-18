// Praeventio Guard — Geofence Permissions UX HTTP surface.
//
// Pure decision engine — given (platform + foreground state + background
// state + criticality), returns the recommended UX action without
// pinging the device. Useful for SSR-rendered admin dashboards that
// preview what a worker would see, or for server-side feature gating.
//
// Directive #2: this engine NEVER instructs the app to block machinery
// — it only blocks Guardian's own geofence/SOS features.
//
// 1 stateless endpoint over the engine under
// `src/services/geofence/permissionUXDecision.ts`:
//
//   POST /:projectId/geofence-permissions/decide-ux
//     body: { platform, foregroundState, backgroundState, inCriticalZone?, userOptedOutForever? }
//     200:  { decision: PermissionUXDecision }
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
  decidePermissionUX,
} from '../../services/geofence/permissionUXDecision.js';

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

const PLATFORMS = ['ios', 'android', 'web-mobile', 'web-desktop'] as const;

const GEO_PERM_STATES = [
  'granted',
  'denied',
  'prompt',
  'restricted',
  'unsupported',
] as const;

const BG_GEO_PERM_STATES = [
  'granted_always',
  'granted_when_in_use',
  'denied',
  'not_requested',
] as const;

const decideUxSchema = z.object({
  platform: z.enum(PLATFORMS),
  foregroundState: z.enum(GEO_PERM_STATES),
  backgroundState: z.enum(BG_GEO_PERM_STATES),
  inCriticalZone: z.boolean().optional(),
  userOptedOutForever: z.boolean().optional(),
});

router.post(
  '/:projectId/geofence-permissions/decide-ux',
  verifyAuth,
  validate(decideUxSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof decideUxSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = decidePermissionUX(body);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('geofencePermissions.decideUx.error', err);
      captureRouteError(err, 'geofencePermissions.decideUx');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
