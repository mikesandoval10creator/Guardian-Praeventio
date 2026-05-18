// Praeventio Guard — Root Cause Investigation Mode HTTP surface.
//
// Sprint K §191 — Modo Investigación Causa Raíz Avanzado. Complements
// the statistical `rootCauseClassifier` with a guided question-answer
// flow for complex incidents: builds a 5-Why tree, detects shallow
// answers ("error humano" sin profundizar), and suggests next questions
// per Ishikawa 6M (Machine / Method / Material / Measurement / Man /
// Environment).
//
// 4 stateless endpoints over the engine under
// `src/services/rootCauseInvestigation/investigationMode.ts`:
//
//   POST /:projectId/investigations/build-tree
//     body: BuildTreeInput
//     200:  { tree: InvestigationTree }
//     400:  InvestigationValidationError → { error, code }
//
//   POST /:projectId/investigations/extract-chain
//     body: { tree }
//     200:  { chain: string[] }   // deepest 5-Why branch as Q/A pairs
//
//   POST /:projectId/investigations/classify-category
//     body: { text }
//     200:  { category: SixMCategory }
//
//   POST /:projectId/investigations/is-shallow-answer
//     body: { answer }
//     200:  { shallow: boolean }
//
// Pure compute — no Firestore writes. Caller persists the tree to
// their own collection.

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
  buildInvestigationTree,
  extractDeepestChain,
  classifyCategory,
  isShallowAnswer,
  InvestigationValidationError,
  type BuildTreeInput,
  type InvestigationTree,
  type NodeInput,
} from '../../services/rootCauseInvestigation/investigationMode.js';

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

// NodeInput is a recursive shape (each node has nested children).
// Accept loosely via the engine's own validation (which recursively
// validates depth ≤ 5, unique ids, non-empty fields).
const nodeInputSchema = z.unknown() as unknown as z.ZodType<NodeInput>;
const treeSchema = z.unknown() as unknown as z.ZodType<InvestigationTree>;

// ────────────────────────────────────────────────────────────────────────
// 1. build-tree
// ────────────────────────────────────────────────────────────────────────

const buildTreeSchema = z.object({
  incidentId: z.string().min(1).max(200),
  rootQuestion: z.string().min(1).max(2000),
  root: nodeInputSchema,
}) as unknown as z.ZodType<BuildTreeInput>;

router.post(
  '/:projectId/investigations/build-tree',
  verifyAuth,
  validate(buildTreeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as BuildTreeInput;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const tree = buildInvestigationTree(body);
      return res.json({ tree });
    } catch (err) {
      if (err instanceof InvestigationValidationError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      logger.error?.('rootCauseInvestigation.buildTree.error', err);
      captureRouteError(err, 'rootCauseInvestigation.buildTree');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. extract-chain
// ────────────────────────────────────────────────────────────────────────

const extractChainSchema = z.object({
  tree: treeSchema,
});

router.post(
  '/:projectId/investigations/extract-chain',
  verifyAuth,
  validate(extractChainSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof extractChainSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const chain = extractDeepestChain(body.tree);
      return res.json({ chain });
    } catch (err) {
      logger.error?.('rootCauseInvestigation.extractChain.error', err);
      captureRouteError(err, 'rootCauseInvestigation.extractChain');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. classify-category
// ────────────────────────────────────────────────────────────────────────

const classifyCategorySchema = z.object({
  text: z.string().min(1).max(2000),
});

router.post(
  '/:projectId/investigations/classify-category',
  verifyAuth,
  validate(classifyCategorySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof classifyCategorySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const category = classifyCategory(body.text);
      return res.json({ category });
    } catch (err) {
      logger.error?.('rootCauseInvestigation.classifyCategory.error', err);
      captureRouteError(err, 'rootCauseInvestigation.classifyCategory');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. is-shallow-answer
// ────────────────────────────────────────────────────────────────────────

const isShallowSchema = z.object({
  answer: z.string().min(1).max(2000),
});

router.post(
  '/:projectId/investigations/is-shallow-answer',
  verifyAuth,
  validate(isShallowSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof isShallowSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const shallow = isShallowAnswer(body.answer);
      return res.json({ shallow });
    } catch (err) {
      logger.error?.('rootCauseInvestigation.isShallow.error', err);
      captureRouteError(err, 'rootCauseInvestigation.isShallow');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
