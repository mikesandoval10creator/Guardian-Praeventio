// Praeventio Guard — AI Quality Audit HTTP surface.
//
// Sprint K §G.4 / §101-103 — AI audit log. Records every AI response,
// enforces human gating for blacklisted actions (work_approval /
// medical_triage / emergency_response), tracks human decisions/overrides,
// and produces quality summaries.
//
// 6 stateless endpoints over the engine under
// `src/services/aiQuality/aiAuditLog.ts`:
//
//   POST /:projectId/ai-quality/log-response
//     body: { id, source, kind, prompt, response, contextDigest?, recipientRole, now? }
//     200:  { entry: AiAuditEntry }
//
//   POST /:projectId/ai-quality/assert-human-gated
//     body: { kind, humanDecision? }
//     200:  { ok: true }
//     400:  BlacklistedAiActionError → { error }
//
//   POST /:projectId/ai-quality/record-human-decision
//     body: { entry, decision }
//     200:  { entry: AiAuditEntry }
//
//   POST /:projectId/ai-quality/record-override
//     body: { entry, overrideReason, now? }
//     200:  { entry: AiAuditEntry }
//     400:  reason < 10 chars → { error }
//
//   POST /:projectId/ai-quality/rate-entry
//     body: { entry, rating: { verdict, reviewerNote? } }
//     200:  { entry: AiAuditEntry }
//
//   POST /:projectId/ai-quality/summarize
//     body: { entries }
//     200:  { summary: AiQualitySummary }
//
// Server-side overrides:
//   • recipientUid forced to callerUid (logResponse)
//   • reviewerUid forced to callerUid (rate-entry)

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
  logAiResponse,
  assertHumanGatedAction,
  recordHumanDecision,
  recordOverride,
  rateEntry,
  summarizeAiQuality,
  BlacklistedAiActionError,
  type AiAuditEntry,
  type AiRating,
  type HumanDecision,
} from '../../services/aiQuality/aiAuditLog.js';

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

const AI_RESPONSE_KINDS = [
  'risk_assessment',
  'epp_suggestion',
  'training_recommendation',
  'legal_citation',
  'incident_classification',
  'medical_triage',
  'work_approval',
  'emergency_response',
  'document_summarization',
  'other',
] as const;

const AI_SOURCES = [
  'gemini',
  'slm_offline_phi3',
  'slm_offline_gemma',
  'deterministic_rule',
  'mediapipe_pose',
  'human_only',
] as const;

const RATING_VERDICTS = [
  'useful',
  'not_useful',
  'missing_context',
  'incorrect',
] as const;

const humanDecisionSchema = z.object({
  followed: z.boolean(),
  overrideReason: z.string().max(2000).optional(),
  decidedAt: z.string().min(10),
  actionAuditId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<HumanDecision>;

// AiAuditEntry is the engine's output; accept loosely on mutator inputs.
const auditEntrySchema = z.unknown() as unknown as z.ZodType<AiAuditEntry>;

// ────────────────────────────────────────────────────────────────────────
// 1. log-response (recipientUid forced from caller)
// ────────────────────────────────────────────────────────────────────────

const logResponseSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.enum(AI_SOURCES),
  kind: z.enum(AI_RESPONSE_KINDS),
  prompt: z.string().min(1).max(10_000),
  response: z.string().min(1).max(50_000),
  contextDigest: z.string().min(1).max(500).optional(),
  recipientRole: z.string().min(1).max(120),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/ai-quality/log-response',
  verifyAuth,
  validate(logResponseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof logResponseSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const entry = logAiResponse({
        id: body.id,
        source: body.source,
        kind: body.kind,
        prompt: body.prompt,
        response: body.response,
        contextDigest: body.contextDigest,
        recipientUid: callerUid,
        recipientRole: body.recipientRole,
        now: body.now ? new Date(body.now) : undefined,
      });
      return res.json({ entry });
    } catch (err) {
      logger.error?.('aiQuality.logResponse.error', err);
      captureRouteError(err, 'aiQuality.logResponse');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. assert-human-gated
// ────────────────────────────────────────────────────────────────────────

const assertHumanGatedSchema = z.object({
  kind: z.enum(AI_RESPONSE_KINDS),
  humanDecision: humanDecisionSchema.optional(),
});

router.post(
  '/:projectId/ai-quality/assert-human-gated',
  verifyAuth,
  validate(assertHumanGatedSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof assertHumanGatedSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      assertHumanGatedAction(body.kind, body.humanDecision);
      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof BlacklistedAiActionError) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('aiQuality.assertHumanGated.error', err);
      captureRouteError(err, 'aiQuality.assertHumanGated');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. record-human-decision
// ────────────────────────────────────────────────────────────────────────

const recordHumanDecisionSchema = z.object({
  entry: auditEntrySchema,
  decision: humanDecisionSchema,
});

router.post(
  '/:projectId/ai-quality/record-human-decision',
  verifyAuth,
  validate(recordHumanDecisionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recordHumanDecisionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const entry = recordHumanDecision(body.entry, body.decision);
      return res.json({ entry });
    } catch (err) {
      logger.error?.('aiQuality.recordHumanDecision.error', err);
      captureRouteError(err, 'aiQuality.recordHumanDecision');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. record-override
// ────────────────────────────────────────────────────────────────────────

const recordOverrideSchema = z.object({
  entry: auditEntrySchema,
  overrideReason: z.string().min(10).max(2000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/ai-quality/record-override',
  verifyAuth,
  validate(recordOverrideSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recordOverrideSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const entry = recordOverride(
        body.entry,
        body.overrideReason,
        body.now ? new Date(body.now) : new Date(),
      );
      return res.json({ entry });
    } catch (err) {
      if (err instanceof Error && err.message.includes('override reason must be')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('aiQuality.recordOverride.error', err);
      captureRouteError(err, 'aiQuality.recordOverride');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. rate-entry (reviewerUid forced from caller)
// ────────────────────────────────────────────────────────────────────────

const rateEntrySchema = z.object({
  entry: auditEntrySchema,
  rating: z.object({
    verdict: z.enum(RATING_VERDICTS),
    reviewedAt: z.string().min(10).optional(),
    reviewerNote: z.string().max(5000).optional(),
  }),
});

router.post(
  '/:projectId/ai-quality/rate-entry',
  verifyAuth,
  validate(rateEntrySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rateEntrySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const fullRating: AiRating = {
        verdict: body.rating.verdict,
        reviewerUid: callerUid,
        reviewedAt: body.rating.reviewedAt ?? new Date().toISOString(),
        reviewerNote: body.rating.reviewerNote,
      };
      const entry = rateEntry(body.entry, fullRating);
      return res.json({ entry });
    } catch (err) {
      logger.error?.('aiQuality.rateEntry.error', err);
      captureRouteError(err, 'aiQuality.rateEntry');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. summarize
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  entries: z.array(auditEntrySchema).max(5000),
});

router.post(
  '/:projectId/ai-quality/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeAiQuality(body.entries);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('aiQuality.summarize.error', err);
      captureRouteError(err, 'aiQuality.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
