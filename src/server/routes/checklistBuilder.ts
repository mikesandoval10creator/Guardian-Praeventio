// Praeventio Guard — Checklist Builder HTTP surface.
//
// Sprint 49 §261-270: constructor de checklists con conditional fields +
// scoring + multi-signature + rectificaciones + export legal.
//
// 4 stateless endpoints (pure compute over caller-supplied template +
// response — no Firestore writes; the engine is deterministic):
//
//   POST /:projectId/checklists/validate-response
//     body: { template, response }
//     200:  { result: ChecklistValidationResult }
//
//   POST /:projectId/checklists/rectify-field
//     body: { response, fieldId, newValue, reason, now? }
//     200:  { response: ChecklistResponse }     // 409 on RectificationError
//
//   POST /:projectId/checklists/apply-signature
//     body: { response, role, signaturePng, now? }
//     200:  { response: ChecklistResponse }
//
//   POST /:projectId/checklists/lock-response
//     body: { response, now? }
//     200:  { response: ChecklistResponse }
//
// Server-side overrides: rectifiedByUid + signedByUid are set to the
// caller's UID (never trust client-supplied values for audit fields).

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
  validateResponse,
  rectifyField,
  applySignature,
  lockResponse,
  RectificationError,
  type ChecklistTemplate,
  type ChecklistResponse,
  type FieldValue,
  type SignatureRole,
} from '../../services/checklistBuilder/checklistBuilder.js';

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

// Template + response are deeply nested engine shapes. We accept them
// loosely via z.unknown() with a cast — the engine's own
// `validateResponse` is responsible for catching structural problems,
// and we don't want to duplicate the field-kind taxonomy here.
const templateSchema = z.unknown() as unknown as z.ZodType<ChecklistTemplate>;
const responseSchema = z.unknown() as unknown as z.ZodType<ChecklistResponse>;
const fieldValueSchema = z.unknown() as unknown as z.ZodType<FieldValue>;

const SIGNATURE_ROLES = [
  'worker',
  'supervisor',
  'prevencionista',
  'cphs_rep',
  'company_doctor',
  'external_auditor',
] as const satisfies readonly SignatureRole[];

// ────────────────────────────────────────────────────────────────────────
// 1. validate-response
// ────────────────────────────────────────────────────────────────────────

const validateResponseSchema = z.object({
  template: templateSchema,
  response: responseSchema,
});

router.post(
  '/:projectId/checklists/validate-response',
  verifyAuth,
  validate(validateResponseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validateResponseSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = validateResponse(body.template, body.response);
      return res.json({ result });
    } catch (err) {
      logger.error?.('checklistBuilder.validate.error', err);
      captureRouteError(err, 'checklistBuilder.validate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. rectify-field
// ────────────────────────────────────────────────────────────────────────

const rectifyFieldSchema = z.object({
  response: responseSchema,
  fieldId: z.string().min(1).max(200),
  newValue: fieldValueSchema,
  reason: z.string().min(10).max(2000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/checklists/rectify-field',
  verifyAuth,
  validate(rectifyFieldSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rectifyFieldSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const response = rectifyField({
        response: body.response,
        fieldId: body.fieldId,
        newValue: body.newValue,
        reason: body.reason,
        rectifiedByUid: callerUid,
        now: body.now ? new Date(body.now) : new Date(),
      });
      return res.json({ response });
    } catch (err) {
      if (err instanceof RectificationError) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      logger.error?.('checklistBuilder.rectify.error', err);
      captureRouteError(err, 'checklistBuilder.rectify');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. apply-signature
// ────────────────────────────────────────────────────────────────────────

const applySignatureSchema = z.object({
  response: responseSchema,
  role: z.enum(SIGNATURE_ROLES),
  signaturePng: z.string().min(40).max(1_000_000), // base64 PNG
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/checklists/apply-signature',
  verifyAuth,
  validate(applySignatureSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof applySignatureSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const response = applySignature({
        response: body.response,
        role: body.role,
        signedByUid: callerUid,
        signaturePng: body.signaturePng,
        now: body.now ? new Date(body.now) : new Date(),
      });
      return res.json({ response });
    } catch (err) {
      logger.error?.('checklistBuilder.applySignature.error', err);
      captureRouteError(err, 'checklistBuilder.applySignature');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. lock-response
// ────────────────────────────────────────────────────────────────────────

const lockResponseSchema = z.object({
  response: responseSchema,
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/checklists/lock-response',
  verifyAuth,
  validate(lockResponseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof lockResponseSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const response = lockResponse(
        body.response,
        body.now ? new Date(body.now) : new Date(),
      );
      return res.json({ response });
    } catch (err) {
      logger.error?.('checklistBuilder.lock.error', err);
      captureRouteError(err, 'checklistBuilder.lock');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
