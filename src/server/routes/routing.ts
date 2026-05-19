// Praeventio Guard — Routing engines HTTP surface.
//
// Two stateless endpoints over engines under `src/services/routing/`:
//
//   POST /:projectId/routing/find-path-astar    { grid, start, goal, opts? }
//     200:  { path: GridCell[] | null }
//
//   POST /:projectId/routing/assess-climate     { input }
//     200:  { assessment: RouteAssessmentResult }
//
// `findPathAStar` is deterministic, O((N×M) log(N×M)). `assessRouteClimate`
// is async + depends on NASA POWER + EONET; on failure it degrades to
// heuristic (keywords + distance) and reports `failedSources`.

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
  findPathAStar,
  type GridCell,
  type AStarOptions,
} from '../../services/routing/gridAStar.js';
import {
  assessRouteClimate,
  type RouteAssessmentInput,
} from '../../services/routing/routeClimateAssessment.js';

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

// ────────────────────────────────────────────────────────────────────────
// 1. find-path-astar
// ────────────────────────────────────────────────────────────────────────

const cellSchema = z.object({
  x: z.number().int().nonnegative().max(100_000),
  y: z.number().int().nonnegative().max(100_000),
}) as unknown as z.ZodType<GridCell>;

const astarSchema = z.object({
  grid: z.array(z.array(z.number().int().min(0).max(10_000))).max(2000),
  start: cellSchema,
  goal: cellSchema,
  opts: z.object({
    allowDiagonals: z.boolean().optional(),
  }).optional(),
});

router.post(
  '/:projectId/routing/find-path-astar',
  verifyAuth,
  validate(astarSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof astarSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      // cellCost callback can't traverse JSON; only allowDiagonals supported on wire.
      const opts: AStarOptions = {
        allowDiagonals: body.opts?.allowDiagonals,
      };
      const path = findPathAStar(body.grid, body.start, body.goal, opts);
      return res.json({ path });
    } catch (err) {
      logger.error?.('routing.findPathAStar.error', err);
      captureRouteError(err, 'routing.findPathAStar');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. assess-climate
// ────────────────────────────────────────────────────────────────────────

const bboxSchema = z.object({
  minLat: z.number().min(-90).max(90),
  maxLat: z.number().min(-90).max(90),
  minLng: z.number().min(-180).max(180),
  maxLng: z.number().min(-180).max(180),
});

const climateInputSchema = z.object({
  midpointLat: z.number().min(-90).max(90),
  midpointLng: z.number().min(-180).max(180),
  bbox: bboxSchema,
  totalDistanceM: z.number().nonnegative().max(1e8),
  totalDurationS: z.number().nonnegative().max(1e7),
  summary: z.string().min(0).max(5000),
  historicalDaysBack: z.number().int().min(1).max(90).optional(),
}) as unknown as z.ZodType<RouteAssessmentInput>;

const climateSchema = z.object({
  input: climateInputSchema,
});

router.post(
  '/:projectId/routing/assess-climate',
  verifyAuth,
  validate(climateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof climateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const assessment = await assessRouteClimate(body.input);
      return res.json({ assessment });
    } catch (err) {
      logger.error?.('routing.assessClimate.error', err);
      captureRouteError(err, 'routing.assessClimate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
