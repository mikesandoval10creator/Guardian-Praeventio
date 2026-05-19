// Praeventio Guard — RACI Matrix HTTP surface.
//
// Sprint 53 §50-58 — six stateless endpoints over the engine under
// `src/services/raciMatrix/raciMatrixEngine.ts`:
//
//   POST /:projectId/raci-matrix/build              { taskId, taskTitle, assignments, critical? }
//   POST /:projectId/raci-matrix/validate           { matrix }
//   POST /:projectId/raci-matrix/detect-overload    { matrices, uid }
//   POST /:projectId/raci-matrix/find-critical-gaps { matrices }
//   POST /:projectId/raci-matrix/list-uids          { matrices }
//   POST /:projectId/raci-matrix/summarize-health   { matrices }
//
// Pure compute — no Firestore writes. Responsible / Accountable /
// Consulted / Informed validation across single matrices + cross-matrix
// overload analysis.

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
  buildRaciMatrix,
  validateRaci,
  detectRoleOverload,
  findCriticalGaps,
  listUidsInMatrices,
  summarizeRaciHealth,
  type RaciMatrix,
  type TaskRoleAssignment,
} from '../../services/raciMatrix/raciMatrixEngine.js';

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

const RACI_ROLES = ['responsible', 'accountable', 'consulted', 'informed'] as const;

const assignmentSchema = z.object({
  taskId: z.string().min(1).max(200),
  uid: z.string().min(1).max(200),
  role: z.enum(RACI_ROLES),
}) as unknown as z.ZodType<TaskRoleAssignment>;

const matrixSchema = z.object({
  taskId: z.string().min(1).max(200),
  taskTitle: z.string().min(1).max(500),
  critical: z.boolean().optional(),
  assignments: z.array(assignmentSchema).max(500),
  valid: z.boolean(),
  violations: z.array(z.unknown()).max(50),
}) as unknown as z.ZodType<RaciMatrix>;

// ────────────────────────────────────────────────────────────────────────
// 1. build
// ────────────────────────────────────────────────────────────────────────

const buildSchema = z.object({
  taskId: z.string().min(1).max(200),
  taskTitle: z.string().min(1).max(500),
  assignments: z.array(assignmentSchema).max(500),
  critical: z.boolean().optional(),
});

router.post(
  '/:projectId/raci-matrix/build',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const matrix = buildRaciMatrix(
        body.taskId,
        body.taskTitle,
        body.assignments,
        body.critical !== undefined ? { critical: body.critical } : undefined,
      );
      return res.json({ matrix });
    } catch (err) {
      logger.error?.('raciMatrix.build.error', err);
      captureRouteError(err, 'raciMatrix.build');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. validate
// ────────────────────────────────────────────────────────────────────────

const validateSchema = z.object({
  matrix: matrixSchema,
});

router.post(
  '/:projectId/raci-matrix/validate',
  verifyAuth,
  validate(validateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = validateRaci(body.matrix);
      return res.json({ result });
    } catch (err) {
      logger.error?.('raciMatrix.validate.error', err);
      captureRouteError(err, 'raciMatrix.validate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. detect-overload
// ────────────────────────────────────────────────────────────────────────

const overloadSchema = z.object({
  matrices: z.array(matrixSchema).max(10_000),
  uid: z.string().min(1).max(200),
});

router.post(
  '/:projectId/raci-matrix/detect-overload',
  verifyAuth,
  validate(overloadSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof overloadSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = detectRoleOverload(body.matrices, body.uid);
      return res.json({ report });
    } catch (err) {
      logger.error?.('raciMatrix.detectOverload.error', err);
      captureRouteError(err, 'raciMatrix.detectOverload');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. find-critical-gaps  /  5. list-uids  /  6. summarize-health
// ────────────────────────────────────────────────────────────────────────

const matricesSchema = z.object({
  matrices: z.array(matrixSchema).max(10_000),
});

router.post(
  '/:projectId/raci-matrix/find-critical-gaps',
  verifyAuth,
  validate(matricesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof matricesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const gaps = findCriticalGaps(body.matrices);
      return res.json({ gaps });
    } catch (err) {
      logger.error?.('raciMatrix.findCriticalGaps.error', err);
      captureRouteError(err, 'raciMatrix.findCriticalGaps');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/raci-matrix/list-uids',
  verifyAuth,
  validate(matricesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof matricesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const uids = listUidsInMatrices(body.matrices);
      return res.json({ uids });
    } catch (err) {
      logger.error?.('raciMatrix.listUids.error', err);
      captureRouteError(err, 'raciMatrix.listUids');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/raci-matrix/summarize-health',
  verifyAuth,
  validate(matricesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof matricesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeRaciHealth(body.matrices);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('raciMatrix.summarizeHealth.error', err);
      captureRouteError(err, 'raciMatrix.summarizeHealth');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
