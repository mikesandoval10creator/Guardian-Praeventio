// Praeventio Guard — Soft-blocking requirement gate HTTP surface.
//
// Five stateless endpoints over the engine under
// `src/services/softBlocking/requirementGate.ts`:
//
//   POST /:projectId/soft-blocking/evaluate-gate          { checks }
//   POST /:projectId/soft-blocking/validate-override      { decision, override }
//   POST /:projectId/soft-blocking/build-audit-entry      { decision, override, gateContext }
//   POST /:projectId/soft-blocking/is-override-valid      { entry, now? }
//
// Pure compute — no Firestore writes. The route injects SHA-256 as the
// hash function for `buildOverrideAuditEntry`. authorizingUid in
// override is forced to the authenticated caller.
//
// Per directive #2 (NUNCA bloquear maquinaria): the engine returns
// 'soft_block' as a flag, never a hard block. 'cannot_override' applies
// only to `critical_control_verification` and only requires supervisor
// intervention — the engine still doesn't physically stop machinery.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  evaluateGate,
  validateOverride,
  buildOverrideAuditEntry,
  isOverrideStillValid,
  GateOverrideError,
  type Requirement,
  type RequirementCheck,
  type RequirementKind,
  type RequirementStatus,
  type GateDecision,
  type GateLevel,
  type OverrideInput,
  type OverrideAuditEntry,
} from '../../services/softBlocking/requirementGate.js';

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

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const KINDS: readonly RequirementKind[] = [
  'training',
  'epp',
  'medical_aptitude',
  'work_permit',
  'document_acknowledgement',
  'critical_control_verification',
  'license_certification',
];
const STATUSES: readonly RequirementStatus[] = [
  'satisfied',
  'missing',
  'expired',
  'in_progress',
  'overdue',
];
const LEVELS: readonly GateLevel[] = ['pass', 'soft_block', 'cannot_override'];

const requirementSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(KINDS as readonly [RequirementKind, ...RequirementKind[]]),
  label: z.string().min(1).max(500),
  isMandatory: z.boolean(),
  citation: z.string().min(1).max(500).optional(),
}) as unknown as z.ZodType<Requirement>;

const checkSchema = z.object({
  requirement: requirementSchema,
  status: z.enum(STATUSES as readonly [RequirementStatus, ...RequirementStatus[]]),
  details: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
}) as unknown as z.ZodType<RequirementCheck>;

const decisionSchema = z.object({
  level: z.enum(LEVELS as readonly [GateLevel, ...GateLevel[]]),
  unsatisfied: z.array(checkSchema).max(500),
  reasoningText: z.string().min(0).max(10_000),
  canOverride: z.boolean(),
}) as unknown as z.ZodType<GateDecision>;

const auditEntrySchema = z.object({
  id: z.string().min(1).max(500),
  gateContext: z.object({
    actorUid: z.string().min(1).max(200),
    activityId: z.string().min(1).max(200),
    activityKind: z.string().min(1).max(200),
  }),
  unsatisfiedRequirementIds: z.array(z.string().min(1).max(200)).max(500),
  authorizingUid: z.string().min(1).max(200),
  reason: z.string().min(1).max(5000),
  approvedAt: z.string().min(10),
  validUntil: z.string().min(10).optional(),
  contentHash: z.string().min(1).max(200),
}) as unknown as z.ZodType<OverrideAuditEntry>;

// ────────────────────────────────────────────────────────────────────────
// 1. evaluate-gate
// ────────────────────────────────────────────────────────────────────────

const evalSchema = z.object({
  checks: z.array(checkSchema).max(500),
});

router.post(
  '/:projectId/soft-blocking/evaluate-gate',
  verifyAuth,
  validate(evalSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evalSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = evaluateGate(body.checks);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('softBlocking.evaluateGate.error', err);
      captureRouteError(err, 'softBlocking.evaluateGate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. validate-override (authorizingUid forced to caller)
// ────────────────────────────────────────────────────────────────────────

const overrideInputSchema = z.object({
  reason: z.string().min(20).max(5000),
  approvedAt: z.string().min(10),
  validUntil: z.string().min(10).optional(),
});

const validateSchema = z.object({
  decision: decisionSchema,
  override: overrideInputSchema,
});

router.post(
  '/:projectId/soft-blocking/validate-override',
  verifyAuth,
  validate(validateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const override: OverrideInput = {
        ...body.override,
        authorizingUid: callerUid,
      };
      const result = validateOverride({ decision: body.decision, override });
      return res.json({ result });
    } catch (err) {
      logger.error?.('softBlocking.validateOverride.error', err);
      captureRouteError(err, 'softBlocking.validateOverride');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. build-audit-entry
// ────────────────────────────────────────────────────────────────────────

const buildAuditSchema = z.object({
  decision: decisionSchema,
  override: overrideInputSchema,
  gateContext: z.object({
    activityId: z.string().min(1).max(200),
    activityKind: z.string().min(1).max(200),
  }),
});

router.post(
  '/:projectId/soft-blocking/build-audit-entry',
  verifyAuth,
  validate(buildAuditSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildAuditSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const override: OverrideInput = {
        ...body.override,
        authorizingUid: callerUid,
      };
      const entry = buildOverrideAuditEntry({
        decision: body.decision,
        override,
        gateContext: {
          actorUid: callerUid,
          activityId: body.gateContext.activityId,
          activityKind: body.gateContext.activityKind,
        },
        hashFn: sha256Hex,
      });
      return res.json({ entry });
    } catch (err) {
      if (err instanceof GateOverrideError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('softBlocking.buildAuditEntry.error', err);
      captureRouteError(err, 'softBlocking.buildAuditEntry');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. is-override-valid
// ────────────────────────────────────────────────────────────────────────

const validitySchema = z.object({
  entry: auditEntrySchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/soft-blocking/is-override-valid',
  verifyAuth,
  validate(validitySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validitySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const valid = isOverrideStillValid(body.entry, now);
      return res.json({ valid });
    } catch (err) {
      logger.error?.('softBlocking.isOverrideValid.error', err);
      captureRouteError(err, 'softBlocking.isOverrideValid');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
