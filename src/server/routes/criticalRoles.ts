// Praeventio Guard — Critical Roles map + Substitute matrix HTTP surface.
//
// Sprint K §271-272, §275 — four stateless endpoints over the engine under
// `src/services/criticalRoles/criticalRolesMap.ts`:
//
//   POST /:projectId/critical-roles/for-industry        { industry }
//   POST /:projectId/critical-roles/find-by-code        { code }
//   POST /:projectId/critical-roles/build-coverage      { role, workers }
//   POST /:projectId/critical-roles/suggest-training    { coverage, workers }
//
// Pure compute — no Firestore writes. Bus-factor + fragility analysis for
// `grua_operator` / `rigger` / `electrician_sec` / `confined_space_supervisor`
// / `blasting_specialist` / `forklift_operator` / `medical_emergency_response`.

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
  getRolesForIndustry,
  findRoleByCode,
  buildRoleCoverage,
  suggestTrainingPlan,
  type Industry,
  type CriticalRoleDefinition,
  type WorkerProfile,
  type RoleCoverage,
} from '../../services/criticalRoles/criticalRolesMap.js';

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

const INDUSTRIES: readonly Industry[] = [
  'mining',
  'construction',
  'industrial',
  'agriculture',
  'electrical',
  'logistics',
];

const workerProfileSchema = z.object({
  uid: z.string().min(1).max(200),
  fullName: z.string().min(1).max(500),
  isActive: z.boolean(),
  activeTrainings: z.array(z.string().min(1).max(200)).max(500),
  activeDocuments: z.array(z.string().min(1).max(200)).max(500),
  trainingsInProgress: z.array(z.string().min(1).max(200)).max(500),
}) as unknown as z.ZodType<WorkerProfile>;

const roleDefinitionSchema = z.object({
  code: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  industries: z.array(z.enum(INDUSTRIES as readonly [Industry, ...Industry[]])).max(INDUSTRIES.length),
  minimumAuthorized: z.number().int().nonnegative().max(10_000),
  requiredTrainings: z.array(z.string().min(1).max(200)).max(50),
  requiredDocuments: z.array(z.string().min(1).max(200)).max(50),
  blocksTaskCategories: z.array(z.string().min(1).max(200)).max(50),
}) as unknown as z.ZodType<CriticalRoleDefinition>;

const roleCoverageSchema = z.object({
  role: roleDefinitionSchema,
  titulars: z.array(workerProfileSchema).max(10_000),
  substitutes: z.array(workerProfileSchema).max(10_000),
  inTraining: z.array(workerProfileSchema).max(10_000),
  busFactor: z.number().int().nonnegative().max(10_000),
  isFragile: z.boolean(),
}) as unknown as z.ZodType<RoleCoverage>;

// ────────────────────────────────────────────────────────────────────────
// 1. for-industry
// ────────────────────────────────────────────────────────────────────────

const industrySchema = z.object({
  industry: z.enum(INDUSTRIES as readonly [Industry, ...Industry[]]),
});

router.post(
  '/:projectId/critical-roles/for-industry',
  verifyAuth,
  validate(industrySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof industrySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const roles = getRolesForIndustry(body.industry);
      return res.json({ roles });
    } catch (err) {
      logger.error?.('criticalRoles.forIndustry.error', err);
      captureRouteError(err, 'criticalRoles.forIndustry');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. find-by-code
// ────────────────────────────────────────────────────────────────────────

const findByCodeSchema = z.object({
  code: z.string().min(1).max(200),
});

router.post(
  '/:projectId/critical-roles/find-by-code',
  verifyAuth,
  validate(findByCodeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof findByCodeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const role = findRoleByCode(body.code);
      if (!role) return res.status(404).json({ error: 'role_not_found' });
      return res.json({ role });
    } catch (err) {
      logger.error?.('criticalRoles.findByCode.error', err);
      captureRouteError(err, 'criticalRoles.findByCode');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. build-coverage
// ────────────────────────────────────────────────────────────────────────

const buildCoverageSchema = z.object({
  role: roleDefinitionSchema,
  workers: z.array(workerProfileSchema).max(50_000),
});

router.post(
  '/:projectId/critical-roles/build-coverage',
  verifyAuth,
  validate(buildCoverageSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildCoverageSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const coverage = buildRoleCoverage(body.role, body.workers);
      return res.json({ coverage });
    } catch (err) {
      logger.error?.('criticalRoles.buildCoverage.error', err);
      captureRouteError(err, 'criticalRoles.buildCoverage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. suggest-training
// ────────────────────────────────────────────────────────────────────────

const suggestSchema = z.object({
  coverage: roleCoverageSchema,
  workers: z.array(workerProfileSchema).max(50_000),
});

router.post(
  '/:projectId/critical-roles/suggest-training',
  verifyAuth,
  validate(suggestSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof suggestSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = suggestTrainingPlan(body.coverage, body.workers);
      return res.json({ plan });
    } catch (err) {
      logger.error?.('criticalRoles.suggestTraining.error', err);
      captureRouteError(err, 'criticalRoles.suggestTraining');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
