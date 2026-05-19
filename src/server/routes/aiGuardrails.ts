// Praeventio Guard — AI Guardrails HTTP surface.
//
// Sprint K §155-160 — stateless endpoints over the three sub-engines
// under `src/services/aiGuardrails/`:
//
//   Prompt catalog (versionedPrompts):
//     POST /:projectId/ai-guardrails/get-prompt           { promptId, version }
//     POST /:projectId/ai-guardrails/get-latest-version   { promptId }
//     POST /:projectId/ai-guardrails/list-versions        { promptId }
//     POST /:projectId/ai-guardrails/list-prompt-ids      {}
//     POST /:projectId/ai-guardrails/get-catalog          {}
//
//   Placeholder rendering (runWithGuardrails helpers):
//     POST /:projectId/ai-guardrails/render-prompt-body   { body, inputs }
//     POST /:projectId/ai-guardrails/find-unresolved-placeholders { rendered }
//
//   Citation enforcement (citationValidator):
//     POST /:projectId/ai-guardrails/extract-citations    { text }
//     POST /:projectId/ai-guardrails/validate-response    { text, sources, policy }
//
//   Hallucination guard (hallucinationGuard):
//     POST /:projectId/ai-guardrails/guard-hallucination  { text }
//
// Pure compute — no Firestore writes. `runWithGuardrails` itself is NOT
// exposed because it requires an LLM adapter callback; the UI composes
// the primitive endpoints to enforce guardrails around its own LLM calls.

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
  getPrompt,
  getLatestVersion,
  getCatalog,
  listVersions,
  listPromptIds,
  UnknownPromptError,
  validateResponse,
  extractCitations,
  guardAgainstHallucination,
  renderPromptBody,
  findUnresolvedPlaceholders,
  type CitationSource,
  type CitationPolicy,
} from '../../services/aiGuardrails/index.js';

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

const CITATION_POLICY = ['required', 'optional'] as const;

// ────────────────────────────────────────────────────────────────────────
// Prompt catalog
// ────────────────────────────────────────────────────────────────────────

const getPromptSchema = z.object({
  promptId: z.string().min(1).max(200),
  version: z.string().min(1).max(50),
});

router.post(
  '/:projectId/ai-guardrails/get-prompt',
  verifyAuth,
  validate(getPromptSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof getPromptSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const prompt = getPrompt(body.promptId, body.version);
      return res.json({ prompt });
    } catch (err) {
      if (err instanceof UnknownPromptError) {
        return res.status(404).json({ error: 'unknown_prompt', message: err.message });
      }
      logger.error?.('aiGuardrails.getPrompt.error', err);
      captureRouteError(err, 'aiGuardrails.getPrompt');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const promptIdSchema = z.object({
  promptId: z.string().min(1).max(200),
});

router.post(
  '/:projectId/ai-guardrails/get-latest-version',
  verifyAuth,
  validate(promptIdSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof promptIdSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const prompt = getLatestVersion(body.promptId);
      return res.json({ prompt });
    } catch (err) {
      if (err instanceof UnknownPromptError) {
        return res.status(404).json({ error: 'unknown_prompt', message: err.message });
      }
      logger.error?.('aiGuardrails.getLatestVersion.error', err);
      captureRouteError(err, 'aiGuardrails.getLatestVersion');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/ai-guardrails/list-versions',
  verifyAuth,
  validate(promptIdSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof promptIdSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const versions = listVersions(body.promptId);
      return res.json({ versions });
    } catch (err) {
      logger.error?.('aiGuardrails.listVersions.error', err);
      captureRouteError(err, 'aiGuardrails.listVersions');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const emptySchema = z.object({}).strict();

router.post(
  '/:projectId/ai-guardrails/list-prompt-ids',
  verifyAuth,
  validate(emptySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ids = listPromptIds();
      return res.json({ ids });
    } catch (err) {
      logger.error?.('aiGuardrails.listPromptIds.error', err);
      captureRouteError(err, 'aiGuardrails.listPromptIds');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/ai-guardrails/get-catalog',
  verifyAuth,
  validate(emptySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const catalog = getCatalog();
      return res.json({ catalog });
    } catch (err) {
      logger.error?.('aiGuardrails.getCatalog.error', err);
      captureRouteError(err, 'aiGuardrails.getCatalog');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Placeholder rendering
// ────────────────────────────────────────────────────────────────────────

const renderSchema = z.object({
  body: z.string().min(0).max(50_000),
  inputs: z.record(
    z.string().min(1).max(200),
    z.union([z.string().max(50_000), z.number(), z.boolean()]),
  ),
});

router.post(
  '/:projectId/ai-guardrails/render-prompt-body',
  verifyAuth,
  validate(renderSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof renderSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const rendered = renderPromptBody(body.body, body.inputs);
      return res.json({ rendered });
    } catch (err) {
      logger.error?.('aiGuardrails.renderPromptBody.error', err);
      captureRouteError(err, 'aiGuardrails.renderPromptBody');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const unresolvedSchema = z.object({
  rendered: z.string().min(0).max(100_000),
});

router.post(
  '/:projectId/ai-guardrails/find-unresolved-placeholders',
  verifyAuth,
  validate(unresolvedSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof unresolvedSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const unresolved = findUnresolvedPlaceholders(body.rendered);
      return res.json({ unresolved });
    } catch (err) {
      logger.error?.('aiGuardrails.findUnresolvedPlaceholders.error', err);
      captureRouteError(err, 'aiGuardrails.findUnresolvedPlaceholders');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Citation enforcement
// ────────────────────────────────────────────────────────────────────────

const extractSchema = z.object({
  text: z.string().min(0).max(100_000),
});

router.post(
  '/:projectId/ai-guardrails/extract-citations',
  verifyAuth,
  validate(extractSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof extractSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const citations = extractCitations(body.text);
      return res.json({ citations });
    } catch (err) {
      logger.error?.('aiGuardrails.extractCitations.error', err);
      captureRouteError(err, 'aiGuardrails.extractCitations');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const citationSourceSchema = z.object({
  id: z.string().min(1).max(500),
  label: z.string().min(0).max(500).optional(),
}) as unknown as z.ZodType<CitationSource>;

const validateResponseSchema = z.object({
  text: z.string().min(0).max(100_000),
  sources: z.array(citationSourceSchema).max(500),
  policy: z.enum(CITATION_POLICY) as unknown as z.ZodType<CitationPolicy>,
});

router.post(
  '/:projectId/ai-guardrails/validate-response',
  verifyAuth,
  validate(validateResponseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validateResponseSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = validateResponse(body.text, body.sources, body.policy);
      return res.json({ result });
    } catch (err) {
      logger.error?.('aiGuardrails.validateResponse.error', err);
      captureRouteError(err, 'aiGuardrails.validateResponse');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Hallucination guard
// ────────────────────────────────────────────────────────────────────────

const guardSchema = z.object({
  text: z.string().min(0).max(100_000),
});

router.post(
  '/:projectId/ai-guardrails/guard-hallucination',
  verifyAuth,
  validate(guardSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof guardSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = guardAgainstHallucination(body.text);
      return res.json({ result });
    } catch (err) {
      logger.error?.('aiGuardrails.guardHallucination.error', err);
      captureRouteError(err, 'aiGuardrails.guardHallucination');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
