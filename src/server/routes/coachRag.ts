// Praeventio Guard — Coach IA RAG HTTP surface.
//
// Bucket HH item #90 companion — three stateless endpoints over the
// `NormativeRagService` class under `src/services/coach/normativeRag.ts`
// + the static `DOMAIN_PROMPTS` from `./prompts.ts`:
//
//   POST /:projectId/coach-rag/search-top-k
//     body: { query, domain, k? }
//     200:  { chunks: NormativeChunk[] }
//
//   POST /:projectId/coach-rag/list-chunks
//     body: {}
//     200:  { chunks: NormativeChunk[] }
//
//   POST /:projectId/coach-rag/get-domain-prompt
//     body: { domain }
//     200:  { prompt: DomainPrompt }
//
// Service is instantiated per-request via fromEnv() — hermetic in-memory
// retrieval over the CL_PACK corpus (the Pinecone backend was discarded
// 2026-05-30). Pure read at this surface: ingestChunk is not exposed (no UI
// consumer; mutation would not survive across stateless requests anyway).

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
import { NormativeRagService } from '../../services/coach/normativeRag.js';
import { DOMAIN_PROMPTS, type CoachDomain } from '../../services/coach/prompts.js';

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

const COACH_DOMAINS = ['chemical', 'medicine', 'legal'] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. search-top-k
// ────────────────────────────────────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  domain: z.enum(COACH_DOMAINS),
  k: z.number().int().min(1).max(50).optional(),
});

router.post(
  '/:projectId/coach-rag/search-top-k',
  verifyAuth,
  validate(searchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof searchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const service = NormativeRagService.fromEnv();
      const chunks = await service.searchTopK(body.query, body.domain, body.k ?? 5);
      return res.json({ chunks });
    } catch (err) {
      logger.error?.('coachRag.searchTopK.error', err);
      captureRouteError(err, 'coachRag.searchTopK');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. list-chunks
// ────────────────────────────────────────────────────────────────────────

const emptySchema = z.object({}).strict();

router.post(
  '/:projectId/coach-rag/list-chunks',
  verifyAuth,
  validate(emptySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const service = NormativeRagService.fromEnv();
      // Strip embeddings from list output — they're high-dim vectors that
      // bloat payloads and aren't useful at the HTTP surface.
      const chunks = service
        .listChunks()
        .map(({ embedding, ...rest }) => rest);
      return res.json({ chunks });
    } catch (err) {
      logger.error?.('coachRag.listChunks.error', err);
      captureRouteError(err, 'coachRag.listChunks');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. get-domain-prompt
// ────────────────────────────────────────────────────────────────────────

const promptSchema = z.object({
  domain: z.enum(COACH_DOMAINS),
});

router.post(
  '/:projectId/coach-rag/get-domain-prompt',
  verifyAuth,
  validate(promptSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof promptSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const prompt = DOMAIN_PROMPTS[body.domain as CoachDomain];
      return res.json({ prompt });
    } catch (err) {
      logger.error?.('coachRag.getDomainPrompt.error', err);
      captureRouteError(err, 'coachRag.getDomainPrompt');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
