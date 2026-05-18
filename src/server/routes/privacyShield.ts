// Praeventio Guard — Privacy Shield HTTP surface.
//
// PII classifier + compliance gap detector + retention reaper. Encodes
// Ley 19.628 + GDPR Art. 9 special-category requirements + Ley 16.744
// art. 76 + Decreto 466 retention defaults.
//
// 3 stateless endpoints over the engine under
// `src/services/privacyShield/piiClassifier.ts`:
//
//   POST /:projectId/privacy-shield/classify-field
//     body: { field }
//     200:  { report: ClassificationReport }
//
//   POST /:projectId/privacy-shield/detect-gaps
//     body: { fields }
//     200:  { gaps: ComplianceGap[] }
//
//   POST /:projectId/privacy-shield/reap-expired
//     body: { records, nowIso? }
//     200:  { result: RetentionReaperResult }
//
// Pure compute — no Firestore writes. Caller persists classifications
// + applies reaper output.
//
// Complementary to privacyRetention (#378). This service classifies
// individual fields by PiiCategory; privacyRetention decides retention
// by DataCategory + jurisdiction.

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
  classifyField,
  detectGaps,
  reapExpiredRecords,
  type DataField,
  type ExpirableRecord,
} from '../../services/privacyShield/piiClassifier.js';

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

const PII_CATEGORIES = [
  'identity',
  'contact',
  'health',
  'biometric',
  'financial',
  'judicial',
  'location',
  'observation',
] as const;

const dataFieldSchema = z.object({
  fieldPath: z.string().min(1).max(500),
  category: z.enum(PII_CATEGORIES),
  encrypted: z.boolean(),
  authorizedRoles: z.array(z.string().min(1).max(120)).max(50).optional(),
}) as unknown as z.ZodType<DataField>;

const expirableRecordSchema = z.object({
  id: z.string().min(1).max(200),
  category: z.enum(PII_CATEGORIES),
  createdAt: z.string().min(10),
}) as unknown as z.ZodType<ExpirableRecord>;

// ────────────────────────────────────────────────────────────────────────
// 1. classify-field
// ────────────────────────────────────────────────────────────────────────

const classifyFieldSchema = z.object({
  field: dataFieldSchema,
});

router.post(
  '/:projectId/privacy-shield/classify-field',
  verifyAuth,
  validate(classifyFieldSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof classifyFieldSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = classifyField(body.field);
      return res.json({ report });
    } catch (err) {
      logger.error?.('privacyShield.classifyField.error', err);
      captureRouteError(err, 'privacyShield.classifyField');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. detect-gaps
// ────────────────────────────────────────────────────────────────────────

const detectGapsSchema = z.object({
  fields: z.array(dataFieldSchema).max(2000),
});

router.post(
  '/:projectId/privacy-shield/detect-gaps',
  verifyAuth,
  validate(detectGapsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof detectGapsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const gaps = detectGaps(body.fields);
      return res.json({ gaps });
    } catch (err) {
      logger.error?.('privacyShield.detectGaps.error', err);
      captureRouteError(err, 'privacyShield.detectGaps');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. reap-expired
// ────────────────────────────────────────────────────────────────────────

const reapExpiredSchema = z.object({
  records: z.array(expirableRecordSchema).max(10_000),
  nowIso: z.string().min(10).optional(),
});

router.post(
  '/:projectId/privacy-shield/reap-expired',
  verifyAuth,
  validate(reapExpiredSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof reapExpiredSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = reapExpiredRecords(body.records, body.nowIso);
      return res.json({ result });
    } catch (err) {
      logger.error?.('privacyShield.reapExpired.error', err);
      captureRouteError(err, 'privacyShield.reapExpired');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
