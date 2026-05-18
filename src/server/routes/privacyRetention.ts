// Praeventio Guard — Privacy Retention HTTP surface.
//
// Sprint 44 §125-128: política de retención + consent + separación PII
// médica. 4 stateless endpoints over the engine under
// `src/services/privacyRetention/dataRetentionPolicy.ts`:
//
//   POST /:projectId/privacy/decide-retention
//     body: { record, options? }
//     200:  { decision: RetentionDecision }
//
//   POST /:projectId/privacy/check-consent
//     body: { artifact|null, options }
//     200:  { check: ConsentCheck }
//
//   POST /:projectId/privacy/pii-bucket
//     body: { sensitivity }
//     200:  { bucket: { storagePathPrefix, firestoreCollectionPrefix,
//                       requiresMedicalRoleClaim } }
//
//   POST /:projectId/privacy/sensitivity-for-category
//     body: { category }
//     200:  { sensitivity: PiiSensitivity }
//
// Engine is fully deterministic — no Firestore writes. Caller decides
// what to do with the resulting decision (purge vs archive, etc.).

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
  decideRetention,
  checkConsent,
  piiBucketFor,
  sensitivityForCategory,
  type DataCategory,
  type Jurisdiction,
  type ConsentPurpose,
  type ConsentArtifact,
  type DataRecord,
  type RetentionRule,
  type PiiSensitivity,
} from '../../services/privacyRetention/dataRetentionPolicy.js';

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

// ────────────────────────────────────────────────────────────────────────
// Engine enums — kept in sync with dataRetentionPolicy.ts.
// ────────────────────────────────────────────────────────────────────────

const DATA_CATEGORIES = [
  'incident',
  'medical_aptitude',
  'medical_diagnosis',
  'training_record',
  'epp_assignment',
  'attendance',
  'audit_log',
  'sensor_telemetry',
  'consent_artifact',
  'communication_log',
  'document_version',
] as const satisfies readonly DataCategory[];

const JURISDICTIONS = [
  'CL',
  'AR',
  'PE',
  'MX',
  'BR',
  'US',
  'EU',
  'UK',
  'CA',
  'AU',
  'JP',
  'KR',
  'IN',
] as const satisfies readonly Jurisdiction[];

const CONSENT_PURPOSES = [
  'data_processing_basic',
  'medical_data_share_mutual',
  'biometric_authentication',
  'photo_evidence_capture',
  'gps_location_tracking',
  'analytics_telemetry',
  'marketing_communications',
] as const satisfies readonly ConsentPurpose[];

const PII_SENSITIVITIES = [
  'public',
  'internal',
  'sensitive',
  'medical',
] as const satisfies readonly PiiSensitivity[];

const SIGNATURE_METHODS = [
  'webauthn',
  'biometric',
  'click_through',
  'paper_then_uploaded',
] as const;

// ────────────────────────────────────────────────────────────────────────
// 1. decide-retention
// ────────────────────────────────────────────────────────────────────────

const dataRecordSchema = z.object({
  id: z.string().min(1).max(200),
  category: z.enum(DATA_CATEGORIES),
  jurisdiction: z.enum(JURISDICTIONS),
  createdAt: z.string().min(10),
  legalHold: z.boolean().optional(),
  retentionOverrideDays: z.number().int().nonnegative().max(36_500).optional(),
}) as unknown as z.ZodType<DataRecord>;

const retentionRuleSchema = z.object({
  category: z.enum(DATA_CATEGORIES),
  jurisdiction: z.enum(JURISDICTIONS),
  activeDays: z.number().int().positive().max(36_500),
  totalDays: z.number().int().positive().max(36_500),
}) as unknown as z.ZodType<RetentionRule>;

const decideRetentionSchema = z.object({
  record: dataRecordSchema,
  options: z
    .object({
      now: z.string().min(10).optional(),
      customRules: z.array(retentionRuleSchema).max(200).optional(),
    })
    .optional(),
});

router.post(
  '/:projectId/privacy/decide-retention',
  verifyAuth,
  validate(decideRetentionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof decideRetentionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = decideRetention(body.record, {
        now: body.options?.now ? new Date(body.options.now) : undefined,
        customRules: body.options?.customRules,
      });
      return res.json({ decision });
    } catch (err) {
      logger.error?.('privacyRetention.decideRetention.error', err);
      captureRouteError(err, 'privacyRetention.decideRetention');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. check-consent
// ────────────────────────────────────────────────────────────────────────

const consentArtifactSchema = z.object({
  subjectUid: z.string().min(1).max(120),
  purpose: z.enum(CONSENT_PURPOSES),
  grantedAt: z.string().min(10),
  revokedAt: z.string().min(10).optional(),
  legalTextVersion: z.string().min(1).max(64),
  signatureMethod: z.enum(SIGNATURE_METHODS),
}) as unknown as z.ZodType<ConsentArtifact>;

const checkConsentSchema = z.object({
  artifact: consentArtifactSchema.nullable(),
  options: z.object({
    now: z.string().min(10).optional(),
    currentLegalTextVersion: z.string().min(1).max(64),
    graceDays: z.number().int().nonnegative().max(365).optional(),
  }),
});

router.post(
  '/:projectId/privacy/check-consent',
  verifyAuth,
  validate(checkConsentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof checkConsentSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const check = checkConsent(body.artifact ?? null, {
        now: body.options.now ? new Date(body.options.now) : undefined,
        currentLegalTextVersion: body.options.currentLegalTextVersion,
        graceDays: body.options.graceDays,
      });
      return res.json({ check });
    } catch (err) {
      logger.error?.('privacyRetention.checkConsent.error', err);
      captureRouteError(err, 'privacyRetention.checkConsent');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. pii-bucket — routing decision for storage / firestore
// ────────────────────────────────────────────────────────────────────────

const piiBucketSchema = z.object({
  sensitivity: z.enum(PII_SENSITIVITIES),
});

router.post(
  '/:projectId/privacy/pii-bucket',
  verifyAuth,
  validate(piiBucketSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof piiBucketSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const bucket = piiBucketFor(body.sensitivity);
      return res.json({ bucket });
    } catch (err) {
      logger.error?.('privacyRetention.piiBucket.error', err);
      captureRouteError(err, 'privacyRetention.piiBucket');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. sensitivity-for-category — canonical mapping (so adapters don't
//    re-derive it). ADR 0012 medical double-lock relies on this.
// ────────────────────────────────────────────────────────────────────────

const sensitivityForCategorySchema = z.object({
  category: z.enum(DATA_CATEGORIES),
});

router.post(
  '/:projectId/privacy/sensitivity-for-category',
  verifyAuth,
  validate(sensitivityForCategorySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof sensitivityForCategorySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const sensitivity = sensitivityForCategory(body.category);
      return res.json({ sensitivity });
    } catch (err) {
      logger.error?.('privacyRetention.sensitivityForCategory.error', err);
      captureRouteError(err, 'privacyRetention.sensitivityForCategory');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
