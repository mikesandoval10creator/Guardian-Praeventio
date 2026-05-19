// Praeventio Guard — Role-based dashboard view HTTP surface.
//
// Sprint 39 J.4 (§94-96) — one stateless endpoint over the engine under
// `src/services/roleViews/roleViewBuilder.ts`:
//
//   POST /:projectId/role-views/build
//     body: { state }
//     200:  { cards: RoleCard[] }
//
// Pure compute — no Firestore writes. `userUid` and `userRole` in the
// state are forced from the authenticated caller — clients cannot
// request another worker's role view (anti-impersonation).

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
  buildRoleView,
  type RoleViewState,
  type UserRole,
} from '../../services/roleViews/roleViewBuilder.js';

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

const ROLES: readonly UserRole[] = ['worker', 'site_chief', 'prevention', 'management'];
const FAENA_STATES = [
  'operativa',
  'restringida',
  'parcialmente_detenida',
  'detenida',
  'emergencia',
] as const;

const stateSchema = z.object({
  userRole: z.enum(ROLES as readonly [UserRole, ...UserRole[]]),
  overdueActions: z.number().int().nonnegative().max(1_000_000),
  pendingApprovals: z.number().int().nonnegative().max(1_000_000),
  todaysTasks: z.number().int().nonnegative().max(1_000_000),
  myEppExpiringSoon: z.number().int().nonnegative().max(10_000),
  myTrainingExpiringSoon: z.number().int().nonnegative().max(10_000),
  myUnreadDocuments: z.number().int().nonnegative().max(10_000),
  criticalIncidentsLast7d: z.number().int().nonnegative().max(10_000),
  faenaState: z.enum(FAENA_STATES),
  complianceScore: z.number().min(0).max(100).optional(),
  totalActiveWorkers: z.number().int().nonnegative().max(10_000_000).optional(),
  totalActiveProjects: z.number().int().nonnegative().max(10_000_000).optional(),
  preventiveROIClpMonth: z.number().max(1e15).optional(),
});

const buildSchema = z.object({
  state: stateSchema,
});

router.post(
  '/:projectId/role-views/build',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const state: RoleViewState = {
        userUid: callerUid,
        ...body.state,
      };
      const cards = buildRoleView(state);
      return res.json({ cards });
    } catch (err) {
      logger.error?.('roleViews.build.error', err);
      captureRouteError(err, 'roleViews.build');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
