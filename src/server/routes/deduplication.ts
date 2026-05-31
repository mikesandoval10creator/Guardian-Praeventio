// Praeventio Guard — Record Deduplication HTTP surface.
//
// Sprint K — record deduplicator over (worker / equipment / project /
// contractor) catalogs. Detects duplicates via canonical key + email
// + phone exact matches + name fuzzy/initials matching. Output drives
// the data-quality dashboard's merge-suggest flow.
//
// 2 stateless endpoints over the engine under
// `src/services/deduplication/recordDeduplicator.ts`:
//
//   POST /:projectId/deduplication/detect
//     body: { records, reviewThreshold?, suggestThreshold?, autoMergeThreshold? }
//     200:  { candidates: DuplicateCandidate[] }
//
//   POST /:projectId/deduplication/build-merge-plan
//     body: { candidate, records, edgesOnDuplicates? }
//     200:  { plan: MergePlan }
//
// Pure compute — no Firestore writes. Caller decides whether to apply
// auto-merges or surface them as suggestions in the UI.

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
  detectDuplicates,
  buildMergePlan,
  type DedupRecord,
  type DuplicateCandidate,
} from '../../services/deduplication/recordDeduplicator.js';

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

const RECORD_KINDS = ['worker', 'equipment', 'project', 'contractor'] as const;

const dedupRecordSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(RECORD_KINDS),
  name: z.string().min(1).max(500),
  canonicalKey: z.string().min(1).max(200).optional(),
  email: z.string().min(1).max(500).optional(),
  phone: z.string().min(1).max(50).optional(),
  createdAt: z.string().min(10),
  metadata: z.record(z.string(), z.unknown()).optional(),
}) as unknown as z.ZodType<DedupRecord>;

// DuplicateCandidate is the engine output shape; accept it as a structured
// object for build-merge-plan so missing fields yield 400, not a 500 deref.
const duplicateCandidateSchema = z.object({
  primaryId: z.string().min(1).max(200),
  duplicateIds: z.array(z.string().min(1).max(200)),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  recommendedAction: z.enum(['auto_merge', 'suggest_merge', 'review_only']),
}) as unknown as z.ZodType<DuplicateCandidate>;

// ────────────────────────────────────────────────────────────────────────
// 1. detect
// ────────────────────────────────────────────────────────────────────────

const detectSchema = z.object({
  records: z.array(dedupRecordSchema).max(10_000),
  reviewThreshold: z.number().min(0).max(1).optional(),
  suggestThreshold: z.number().min(0).max(1).optional(),
  autoMergeThreshold: z.number().min(0).max(1).optional(),
});

router.post(
  '/:projectId/deduplication/detect',
  verifyAuth,
  validate(detectSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof detectSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const candidates = detectDuplicates(body.records, {
        reviewThreshold: body.reviewThreshold,
        suggestThreshold: body.suggestThreshold,
        autoMergeThreshold: body.autoMergeThreshold,
      });
      return res.json({ candidates });
    } catch (err) {
      logger.error?.('deduplication.detect.error', err);
      captureRouteError(err, 'deduplication.detect');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-merge-plan
// ────────────────────────────────────────────────────────────────────────

const buildMergePlanSchema = z.object({
  candidate: duplicateCandidateSchema,
  records: z.array(dedupRecordSchema).max(10_000),
  edgesOnDuplicates: z.record(z.string(), z.number().int().nonnegative()).optional(),
});

router.post(
  '/:projectId/deduplication/build-merge-plan',
  verifyAuth,
  validate(buildMergePlanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildMergePlanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const plan = buildMergePlan(
        body.candidate,
        body.records,
        body.edgesOnDuplicates,
      );
      return res.json({ plan });
    } catch (err) {
      logger.error?.('deduplication.buildMergePlan.error', err);
      captureRouteError(err, 'deduplication.buildMergePlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
