// Praeventio Guard — Fase F.28 Explainability HTTP surface.
//
// Stateless endpoint that wraps `explainRecommendation()` and
// `partitionByActionability()` so React clients can ask the server for
// a human-readable "porque..." rationale derived from graph evidences.
//
// 1 endpoint:
//   POST /:projectId/explainability/recommendation
//     body: { recommendation, evidences }
//     200:  { explained }
//   POST /:projectId/explainability/batch
//     body: { recommendations: [{ recommendation, evidences }, ...] }
//     200:  { actionable, needsReview }
//
// Pure compute — no Firestore writes. The audit trail at the call site
// records that explainability was requested (via captureRouteError on
// failures + the standard request log).

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
  explainRecommendation,
  explainBatch,
  partitionByActionability,
} from '../../services/explainability/recommendationExplainer.js';

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

const EVIDENCE_KINDS = [
  'graph_node',
  'legal_rule',
  'historical_pattern',
  'sensor_reading',
  'incident_correlation',
  'expert_input',
  'llm_inference',
] as const;

const evidenceSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(EVIDENCE_KINDS),
  description: z.string().min(1).max(2000),
  citation: z.string().min(1).max(200),
  weight: z.number().min(0).max(10).optional(),
});

const recommendationSchema = z.object({
  id: z.string().min(1).max(200),
  action: z.string().min(1).max(2000),
  responsibleRole: z.string().max(120).optional(),
  validUntil: z.string().max(60).optional(),
  category: z.string().min(1).max(120),
});

const singleSchema = z.object({
  recommendation: recommendationSchema,
  evidences: z.array(evidenceSchema).max(50),
});

const batchSchema = z.object({
  recommendations: z.array(singleSchema).min(1).max(100),
});

router.post(
  '/:projectId/explainability/recommendation',
  verifyAuth,
  validate(singleSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof singleSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const explained = explainRecommendation(body);
      return res.json({ explained });
    } catch (err) {
      logger.error?.('explainability.recommendation.error', err);
      captureRouteError(err, 'explainability.recommendation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/explainability/batch',
  verifyAuth,
  validate(batchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof batchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const explained = explainBatch(body.recommendations);
      const { actionable, needsReview } = partitionByActionability(explained);
      return res.json({ actionable, needsReview });
    } catch (err) {
      logger.error?.('explainability.batch.error', err);
      captureRouteError(err, 'explainability.batch');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
