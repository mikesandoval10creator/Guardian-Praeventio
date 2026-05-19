// Praeventio Guard — External Audit Portal HTTP surface.
//
// Sprint 39 H.1 — six stateless endpoints over the engine under
// `src/services/auditPortal/externalAuditPortal.ts`:
//
//   POST /:projectId/audit-portal/create-portal       { input }
//   POST /:projectId/audit-portal/derive-status       { portal, now? }
//   POST /:projectId/audit-portal/revoke              { portal, reason, now? }
//   POST /:projectId/audit-portal/check-access        { portal, request, now? }
//   POST /:projectId/audit-portal/summarize-usage     { portal, logs }
//   POST /:projectId/audit-portal/generate-token      {}
//
// Pure compute — no Firestore writes. createdByUid (create-portal) and
// revokedByUid (revoke) forced to authenticated caller.

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
  generateAccessToken,
  createPortal,
  derivePortalStatus,
  revokePortal,
  checkAccess,
  summarizePortalUsage,
  PortalValidationError,
  type AuditPortalConfig,
  type AuditModule,
  type AuditorAffiliation,
  type PortalAccessLog,
} from '../../services/auditPortal/externalAuditPortal.js';

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

const MODULES: readonly AuditModule[] = [
  'documents',
  'iper_matrix',
  'trainings',
  'epp',
  'incidents',
  'corrective_actions',
  'evidences',
  'compliance_snapshot',
];
const AFFILIATIONS: readonly AuditorAffiliation[] = [
  'mandante',
  'suseso',
  'mutualidad',
  'iso',
  'seremi',
  'dt',
  'cliente',
  'other',
];

const portalSchema = z.object({
  id: z.string().min(1).max(200),
  accessToken: z.string().min(32).max(200),
  createdByUid: z.string().min(1).max(200),
  createdAt: z.string().min(10),
  expiresAt: z.string().min(10),
  auditorName: z.string().min(1).max(500),
  auditorAffiliation: z.enum(AFFILIATIONS as readonly [AuditorAffiliation, ...AuditorAffiliation[]]),
  auditorEmail: z.string().min(1).max(500).optional(),
  scopeProjectIds: z.array(z.string().min(1).max(200)).max(500),
  scopeModules: z.array(z.enum(MODULES as readonly [AuditModule, ...AuditModule[]])).max(MODULES.length),
  internalNotes: z.string().min(0).max(5000).optional(),
  revokedAt: z.string().min(10).optional(),
  revokedByUid: z.string().min(1).max(200).optional(),
  revokedReason: z.string().min(1).max(5000).optional(),
}) as unknown as z.ZodType<AuditPortalConfig>;

const accessLogSchema = z.object({
  portalId: z.string().min(1).max(200),
  accessedAt: z.string().min(10),
  module: z.enum(MODULES as readonly [AuditModule, ...AuditModule[]]),
  downloaded: z.boolean(),
  payloadBytes: z.number().int().nonnegative().max(10_000_000_000).optional(),
  ip: z.string().min(1).max(100).optional(),
  userAgent: z.string().min(1).max(500).optional(),
}) as unknown as z.ZodType<PortalAccessLog>;

// ────────────────────────────────────────────────────────────────────────
// 1. create-portal — createdByUid forced
// ────────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  id: z.string().min(1).max(200),
  auditorName: z.string().min(3).max(500),
  auditorAffiliation: z.enum(AFFILIATIONS as readonly [AuditorAffiliation, ...AuditorAffiliation[]]),
  auditorEmail: z.string().min(1).max(500).optional(),
  scopeProjectIds: z.array(z.string().min(1).max(200)).min(1).max(500),
  scopeModules: z.array(z.enum(MODULES as readonly [AuditModule, ...AuditModule[]])).min(1).max(MODULES.length),
  ttlDays: z.number().int().min(1).max(90),
  internalNotes: z.string().min(0).max(5000).optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/audit-portal/create-portal',
  verifyAuth,
  validate(createSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const portal = createPortal({
        ...body,
        createdByUid: callerUid,
        now: body.now ? new Date(body.now) : undefined,
      });
      return res.json({ portal });
    } catch (err) {
      if (err instanceof PortalValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('auditPortal.createPortal.error', err);
      captureRouteError(err, 'auditPortal.createPortal');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. derive-status
// ────────────────────────────────────────────────────────────────────────

const deriveSchema = z.object({
  portal: portalSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/audit-portal/derive-status',
  verifyAuth,
  validate(deriveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof deriveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const status = derivePortalStatus(body.portal, now);
      return res.json({ status });
    } catch (err) {
      logger.error?.('auditPortal.deriveStatus.error', err);
      captureRouteError(err, 'auditPortal.deriveStatus');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. revoke — revokedByUid forced
// ────────────────────────────────────────────────────────────────────────

const revokeSchema = z.object({
  portal: portalSchema,
  reason: z.string().min(10).max(5000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/audit-portal/revoke',
  verifyAuth,
  validate(revokeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof revokeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const portal = revokePortal(body.portal, callerUid, body.reason, now);
      return res.json({ portal });
    } catch (err) {
      if (err instanceof PortalValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('auditPortal.revoke.error', err);
      captureRouteError(err, 'auditPortal.revoke');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. check-access
// ────────────────────────────────────────────────────────────────────────

const accessSchema = z.object({
  portal: portalSchema.nullable(),
  request: z.object({
    token: z.string().min(1).max(200),
    module: z.enum(MODULES as readonly [AuditModule, ...AuditModule[]]),
    projectId: z.string().min(1).max(200),
  }),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/audit-portal/check-access',
  verifyAuth,
  validate(accessSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof accessSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const decision = checkAccess(body.portal, body.request, now);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('auditPortal.checkAccess.error', err);
      captureRouteError(err, 'auditPortal.checkAccess');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. summarize-usage
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  portal: portalSchema,
  logs: z.array(accessLogSchema).max(50_000),
});

router.post(
  '/:projectId/audit-portal/summarize-usage',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizePortalUsage(body.portal, body.logs);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('auditPortal.summarizeUsage.error', err);
      captureRouteError(err, 'auditPortal.summarizeUsage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. generate-token
// ────────────────────────────────────────────────────────────────────────

const emptySchema = z.object({}).strict();

router.post(
  '/:projectId/audit-portal/generate-token',
  verifyAuth,
  validate(emptySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const token = generateAccessToken();
      return res.json({ token });
    } catch (err) {
      logger.error?.('auditPortal.generateToken.error', err);
      captureRouteError(err, 'auditPortal.generateToken');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
