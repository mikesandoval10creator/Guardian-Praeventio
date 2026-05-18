// Praeventio Guard — Job Safety Analysis (JSA) HTTP surface.
//
// DS 76 art. 21 (Chile) — the JSA is the most-used operational document
// in the field after the work permit. Supervisor decomposes a task into
// steps, identifies hazards per step, applies controls following the
// ISO 45001 hierarchy, and computes residual risk on a 5×5 matrix.
//
// 3 stateless endpoints over the engine under
// `src/services/jsa/jobSafetyAnalysis.ts`:
//
//   POST /:projectId/jsa/validate
//     body: { draft }
//     200:  { result: JsaValidationResult }
//
//   POST /:projectId/jsa/compute-residual-risks
//     body: { draft }
//     200:  { risks: JsaResidualRisk[], overallClass: ResidualClass }
//
//   POST /:projectId/jsa/finalize
//     body: { draft, signedAtIso?, signatureHashHex }
//     200:  { jsa: FinalizedJsa }
//     400:  JsaFinalizationError → { error, code }
//
// Server-side override: approverUid = callerUid (so the engine's
// separation-of-functions rule applies against the actual signed-in
// approver — never trust client-supplied approver identity).

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
  validateJsa,
  computeResidualRisks,
  overallResidualClass,
  finalize,
  JsaFinalizationError,
  type JsaDraft,
} from '../../services/jsa/jobSafetyAnalysis.js';

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

// JsaDraft is a deeply nested engine shape; accept it loosely via the
// engine's own `validateJsa` rather than duplicating the field/hazard/
// control taxonomy at the HTTP boundary.
const draftSchema = z.unknown() as unknown as z.ZodType<JsaDraft>;

// ────────────────────────────────────────────────────────────────────────
// 1. validate
// ────────────────────────────────────────────────────────────────────────

const validateSchema = z.object({
  draft: draftSchema,
});

router.post(
  '/:projectId/jsa/validate',
  verifyAuth,
  validate(validateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = validateJsa(body.draft);
      return res.json({ result });
    } catch (err) {
      logger.error?.('jsa.validate.error', err);
      captureRouteError(err, 'jsa.validate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. compute-residual-risks
// ────────────────────────────────────────────────────────────────────────

const residualRisksSchema = z.object({
  draft: draftSchema,
});

router.post(
  '/:projectId/jsa/compute-residual-risks',
  verifyAuth,
  validate(residualRisksSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof residualRisksSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const risks = computeResidualRisks(body.draft);
      const overallClass = overallResidualClass(risks);
      return res.json({ risks, overallClass });
    } catch (err) {
      logger.error?.('jsa.residualRisks.error', err);
      captureRouteError(err, 'jsa.residualRisks');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. finalize — server-side approverUid from callerUid
// ────────────────────────────────────────────────────────────────────────

const finalizeSchema = z.object({
  draft: draftSchema,
  signedAtIso: z.string().min(10).optional(),
  signatureHashHex: z.string().regex(/^[a-f0-9]{64,}$/i),
});

router.post(
  '/:projectId/jsa/finalize',
  verifyAuth,
  validate(finalizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof finalizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const jsa = finalize({
        draft: body.draft,
        approverUid: callerUid,
        signedAtIso: body.signedAtIso ?? new Date().toISOString(),
        signatureHashHex: body.signatureHashHex,
      });
      return res.json({ jsa });
    } catch (err) {
      if (err instanceof JsaFinalizationError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      logger.error?.('jsa.finalize.error', err);
      captureRouteError(err, 'jsa.finalize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
