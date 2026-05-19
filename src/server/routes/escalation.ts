// Praeventio Guard — Escalation + SLA Engine HTTP surface.
//
// Sprint 50 §206-210 — six stateless endpoints over the engine under
// `src/services/escalation/escalationSlaEngine.ts`:
//
//   POST /:projectId/escalation/sla-minutes          { kind, severity }
//   POST /:projectId/escalation/assess-sla           { item, now? }
//   POST /:projectId/escalation/decide               { item, chain, options?, now? }
//   POST /:projectId/escalation/apply                { item, decision, now? }
//   POST /:projectId/escalation/process-batch        { items, chain, options?, now? }
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
  getSlaMinutes,
  assessSla,
  decideEscalation,
  applyEscalation,
  processBatchEscalations,
  type WorkflowItem,
  type WorkflowItemKind,
  type SeverityLevel,
  type EscalationLevel,
  type EscalationChain,
  type EscalationDecision,
  type EscalationOptions,
  type EscalationHistoryEntry,
} from '../../services/escalation/escalationSlaEngine.js';

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

const KINDS: readonly WorkflowItemKind[] = [
  'incident',
  'corrective_action',
  'non_conformity',
  'work_permit',
  'sos_alert',
  'exception_request',
  'audit_finding',
];
const SEVERITIES: readonly SeverityLevel[] = ['low', 'medium', 'high', 'critical', 'sif'];
const STATUSES = ['open', 'in_progress', 'pending_review', 'closed', 'rejected'] as const;
const REASONS = ['sla_breach', 'severity_increase', 'manual_escalation', 'recipient_unavailable'] as const;

const escalationLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]) as unknown as z.ZodType<EscalationLevel>;

const historyEntrySchema = z.object({
  fromLevel: escalationLevelSchema,
  toLevel: escalationLevelSchema,
  fromUid: z.string().min(1).max(200).optional(),
  toUid: z.string().min(1).max(200),
  at: z.string().min(10),
  reason: z.enum(REASONS),
}) as unknown as z.ZodType<EscalationHistoryEntry>;

const itemSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(KINDS as readonly [WorkflowItemKind, ...WorkflowItemKind[]]),
  severity: z.enum(SEVERITIES as readonly [SeverityLevel, ...SeverityLevel[]]),
  status: z.enum(STATUSES),
  createdAt: z.string().min(10),
  lastTransitionAt: z.string().min(10).optional(),
  assignedToUid: z.string().min(1).max(200).optional(),
  currentLevel: escalationLevelSchema.optional(),
  history: z.array(historyEntrySchema).max(50).optional(),
}) as unknown as z.ZodType<WorkflowItem>;

const chainLevelSchema = z.object({
  primary: z.string().min(1).max(200),
  fallback: z.string().min(1).max(200).optional(),
  label: z.string().min(1).max(200),
});

const chainSchema = z.object({
  level1: chainLevelSchema,
  level2: chainLevelSchema,
  level3: chainLevelSchema,
  level4: chainLevelSchema.optional(),
  level5: chainLevelSchema.optional(),
}) as unknown as z.ZodType<EscalationChain>;

const optionsWireSchema = z.object({
  unavailableUids: z.array(z.string().min(1).max(200)).max(10_000).optional(),
  severityJustIncreased: z.boolean().optional(),
  manualEscalation: z.boolean().optional(),
});

function deserializeOptions(o?: z.infer<typeof optionsWireSchema>): EscalationOptions {
  if (!o) return {};
  return {
    unavailableUids: o.unavailableUids ? new Set(o.unavailableUids) : undefined,
    severityJustIncreased: o.severityJustIncreased,
    manualEscalation: o.manualEscalation,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 1. sla-minutes
// ────────────────────────────────────────────────────────────────────────

const slaMinutesSchema = z.object({
  kind: z.enum(KINDS as readonly [WorkflowItemKind, ...WorkflowItemKind[]]),
  severity: z.enum(SEVERITIES as readonly [SeverityLevel, ...SeverityLevel[]]),
});

router.post(
  '/:projectId/escalation/sla-minutes',
  verifyAuth,
  validate(slaMinutesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof slaMinutesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const slaMinutes = getSlaMinutes(body.kind, body.severity);
      return res.json({ slaMinutes });
    } catch (err) {
      logger.error?.('escalation.slaMinutes.error', err);
      captureRouteError(err, 'escalation.slaMinutes');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. assess-sla
// ────────────────────────────────────────────────────────────────────────

const assessSchema = z.object({
  item: itemSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/escalation/assess-sla',
  verifyAuth,
  validate(assessSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof assessSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const assessment = assessSla(body.item, now);
      return res.json({ assessment });
    } catch (err) {
      logger.error?.('escalation.assessSla.error', err);
      captureRouteError(err, 'escalation.assessSla');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. decide
// ────────────────────────────────────────────────────────────────────────

const decideSchema = z.object({
  item: itemSchema,
  chain: chainSchema,
  options: optionsWireSchema.optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/escalation/decide',
  verifyAuth,
  validate(decideSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof decideSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const decision = decideEscalation(
        body.item,
        body.chain,
        now,
        deserializeOptions(body.options),
      );
      return res.json({ decision });
    } catch (err) {
      logger.error?.('escalation.decide.error', err);
      captureRouteError(err, 'escalation.decide');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. apply
// ────────────────────────────────────────────────────────────────────────

const decisionSchema = z.object({
  shouldEscalate: z.boolean(),
  toLevel: escalationLevelSchema.optional(),
  toUid: z.string().min(1).max(200).optional(),
  reason: z.enum(REASONS).optional(),
  detail: z.string().min(1).max(2000),
  chainExhausted: z.boolean(),
}) as unknown as z.ZodType<EscalationDecision>;

const applySchema = z.object({
  item: itemSchema,
  decision: decisionSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/escalation/apply',
  verifyAuth,
  validate(applySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof applySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const item = applyEscalation(body.item, body.decision, now);
      return res.json({ item });
    } catch (err) {
      logger.error?.('escalation.apply.error', err);
      captureRouteError(err, 'escalation.apply');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. process-batch
// ────────────────────────────────────────────────────────────────────────

const batchSchema = z.object({
  items: z.array(itemSchema).max(10_000),
  chain: chainSchema,
  options: optionsWireSchema.optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/escalation/process-batch',
  verifyAuth,
  validate(batchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof batchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const result = processBatchEscalations(
        body.items,
        body.chain,
        now,
        deserializeOptions(body.options),
      );
      return res.json({ result });
    } catch (err) {
      logger.error?.('escalation.processBatch.error', err);
      captureRouteError(err, 'escalation.processBatch');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
