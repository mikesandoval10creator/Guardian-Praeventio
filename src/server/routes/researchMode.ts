// Praeventio Guard — Research Mode (root cause investigation) HTTP surface.
//
// Sprint K §191-194 — four stateless endpoints over the engine under
// `src/services/researchMode/researchMode.ts`:
//
//   POST /:projectId/research-mode/find-root-branches
//     body: { tree }
//     200:  { branches: BranchPath[] }
//
//   POST /:projectId/research-mode/summarize-tree
//     body: { tree }
//     200:  { summary: TreeSummary }
//
//   POST /:projectId/research-mode/compare-trees
//     body: { primary, others }
//     200:  { scores: SimilarityScore[] }
//
//   POST /:projectId/research-mode/detect-failed-control-patterns
//     body: { trees }
//     200:  { signals: FailedControlSignal[] }
//
// Pure compute — no Firestore writes. Determinístico, sin LLM.
// Acompaña a `rootCauseClassifier` (existente).

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
  findRootBranches,
  summarizeTree,
  compareTrees,
  detectFailedControlPatterns,
  type CauseNode,
  type RootCauseTree,
} from '../../services/researchMode/researchMode.js';

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

const CAUSE_CATEGORIES = [
  'people',
  'process',
  'environment',
  'equipment',
  'materials',
  'measurement',
  'management',
] as const;

const causeNodeSchema = z.object({
  id: z.string().min(1).max(200),
  text: z.string().min(1).max(2000),
  category: z.enum(CAUSE_CATEGORIES),
  isRoot: z.boolean(),
  parentId: z.string().min(1).max(200).optional(),
  failedControlId: z.string().min(1).max(200).optional(),
  proposedByUid: z.string().min(1).max(200),
  evidenceRefs: z.array(z.string().min(1).max(500)).max(200).optional(),
}) as unknown as z.ZodType<CauseNode>;

const rootCauseTreeSchema = z.object({
  incidentId: z.string().min(1).max(200),
  nodes: z.array(causeNodeSchema).max(5000),
}) as unknown as z.ZodType<RootCauseTree>;

// ────────────────────────────────────────────────────────────────────────
// 1. find-root-branches
// ────────────────────────────────────────────────────────────────────────

const treeBodySchema = z.object({
  tree: rootCauseTreeSchema,
});

router.post(
  '/:projectId/research-mode/find-root-branches',
  verifyAuth,
  validate(treeBodySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof treeBodySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const branches = findRootBranches(body.tree);
      return res.json({ branches });
    } catch (err) {
      logger.error?.('researchMode.findRootBranches.error', err);
      captureRouteError(err, 'researchMode.findRootBranches');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. summarize-tree
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/research-mode/summarize-tree',
  verifyAuth,
  validate(treeBodySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof treeBodySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeTree(body.tree);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('researchMode.summarizeTree.error', err);
      captureRouteError(err, 'researchMode.summarizeTree');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. compare-trees
// ────────────────────────────────────────────────────────────────────────

const compareSchema = z.object({
  primary: rootCauseTreeSchema,
  others: z.array(rootCauseTreeSchema).max(500),
});

router.post(
  '/:projectId/research-mode/compare-trees',
  verifyAuth,
  validate(compareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof compareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const scores = compareTrees(body.primary, body.others);
      return res.json({ scores });
    } catch (err) {
      logger.error?.('researchMode.compareTrees.error', err);
      captureRouteError(err, 'researchMode.compareTrees');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. detect-failed-control-patterns
// ────────────────────────────────────────────────────────────────────────

const detectSchema = z.object({
  trees: z.array(rootCauseTreeSchema).max(2000),
});

router.post(
  '/:projectId/research-mode/detect-failed-control-patterns',
  verifyAuth,
  validate(detectSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof detectSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const signals = detectFailedControlPatterns(body.trees);
      return res.json({ signals });
    } catch (err) {
      logger.error?.('researchMode.detectFailedControlPatterns.error', err);
      captureRouteError(err, 'researchMode.detectFailedControlPatterns');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
