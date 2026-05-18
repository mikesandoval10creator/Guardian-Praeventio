// Praeventio Guard — Vendor / Contractor Onboarding HTTP surface.
//
// Sprint K 2da tanda §35, §40, §42-45 + accreditation tracker.
//
// 5 stateless endpoints (pure compute over caller-supplied inputs — no
// Firestore writes; the engines under `services/vendorOnboarding/` are
// deterministic and reads/writes belong to the existing vendor stores):
//
//   POST /:projectId/vendors/onboarding/evaluate-stage
//   POST /:projectId/vendors/:vendorId/onboarding/missing-mandatory
//   POST /:projectId/vendors/onboarding/build-client-bundle
//   POST /:projectId/vendors/:vendorId/accreditation/summarize
//   POST /:projectId/vendors/:vendorId/accreditation/should-escalate

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
  evaluateOnboardingStage,
  listMissingMandatory,
  buildClientRequirementsBundle,
  type VendorRequirement,
  type VendorRequirementCompliance,
  type VendorOnboardingState,
} from '../../services/vendorOnboarding/vendorOnboardingFlow.js';
import {
  summarizeAccreditation,
  shouldEscalateObservation,
  type AccreditationObservation,
} from '../../services/vendorOnboarding/vendorAccreditationTracker.js';

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
// Schema fragments — mirror engine types verbatim.
// ────────────────────────────────────────────────────────────────────────

const REQUIREMENT_KINDS = [
  'document',
  'certification',
  'insurance',
  'safety_policy',
  'epp_inventory',
  'control_inventory',
] as const;

const COMPLIANCE_STATUSES = [
  'pending',
  'submitted',
  'approved',
  'rejected',
  'expired',
] as const;

const OBSERVATION_KINDS = [
  'documentation',
  'epp_quality',
  'training_compliance',
  'site_behavior',
  'incident',
] as const;

const OBSERVATION_SEVERITIES = ['minor', 'major', 'critical'] as const;

const requirementSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(300),
  kind: z.enum(REQUIREMENT_KINDS),
  mandatory: z.boolean(),
  clientSpecific: z.string().min(1).max(120).optional(),
  expiresAfterMonths: z.number().positive().max(120).optional(),
}) as unknown as z.ZodType<VendorRequirement>;

const complianceSchema = z.object({
  vendorId: z.string().min(1).max(120),
  requirementId: z.string().min(1).max(120),
  status: z.enum(COMPLIANCE_STATUSES),
  submittedAt: z.string().min(10).optional(),
  reviewedByUid: z.string().min(1).max(120).optional(),
  reviewedAt: z.string().min(10).optional(),
  reason: z.string().max(2000).optional(),
  expiresAt: z.string().min(10).optional(),
}) as unknown as z.ZodType<VendorRequirementCompliance>;

const onboardingStateSchema = z.object({
  vendorId: z.string().min(1).max(120),
  legalName: z.string().min(1).max(300),
  invitedAt: z.string().min(10),
  docsUploadedAt: z.string().min(10).optional(),
  docsValidatedAt: z.string().min(10).optional(),
  siteWalkAt: z.string().min(10).optional(),
  accreditedAt: z.string().min(10).optional(),
  rejectedAt: z.string().min(10).optional(),
  rejectionReason: z.string().max(2000).optional(),
}) as unknown as z.ZodType<VendorOnboardingState>;

const observationSchema = z.object({
  id: z.string().min(1).max(120),
  vendorId: z.string().min(1).max(120),
  observedByUid: z.string().min(1).max(120),
  kind: z.enum(OBSERVATION_KINDS),
  severity: z.enum(OBSERVATION_SEVERITIES),
  description: z.string().min(1).max(2000),
  observedAt: z.string().min(10),
  resolvedAt: z.string().min(10).optional(),
  resolvedByUid: z.string().min(1).max(120).optional(),
  resolutionNotes: z.string().max(2000).optional(),
}) as unknown as z.ZodType<AccreditationObservation>;

// ────────────────────────────────────────────────────────────────────────
// Endpoint 1 — evaluate onboarding stage
// ────────────────────────────────────────────────────────────────────────

const evaluateStageSchema = z.object({
  state: onboardingStateSchema,
  compliance: z.array(complianceSchema).max(500),
  requirements: z.array(requirementSchema).max(200),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/vendors/onboarding/evaluate-stage',
  verifyAuth,
  validate(evaluateStageSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evaluateStageSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const stage = evaluateOnboardingStage(
        body.state,
        body.compliance,
        body.requirements,
        body.now ?? new Date().toISOString(),
      );
      return res.json({ stage });
    } catch (err) {
      logger.error?.('vendorOnboarding.evaluateStage.error', err);
      captureRouteError(err, 'vendorOnboarding.evaluateStage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Endpoint 2 — list missing mandatory requirements for a vendor
// ────────────────────────────────────────────────────────────────────────

const missingMandatorySchema = z.object({
  compliance: z.array(complianceSchema).max(500),
  requirements: z.array(requirementSchema).max(200),
});

router.post(
  '/:projectId/vendors/:vendorId/onboarding/missing-mandatory',
  verifyAuth,
  validate(missingMandatorySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, vendorId } = req.params;
    const body = req.body as z.infer<typeof missingMandatorySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const requirements = listMissingMandatory(
        vendorId,
        body.compliance,
        body.requirements,
      );
      return res.json({ requirements });
    } catch (err) {
      logger.error?.('vendorOnboarding.missingMandatory.error', err);
      captureRouteError(err, 'vendorOnboarding.missingMandatory');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Endpoint 3 — build per-client requirement bundle (§45)
// ────────────────────────────────────────────────────────────────────────

const buildBundleSchema = z.object({
  clientId: z.string().min(1).max(120),
  baseRequirements: z.array(requirementSchema).max(200),
  clientSpecificRequirements: z.array(requirementSchema).max(200),
});

router.post(
  '/:projectId/vendors/onboarding/build-client-bundle',
  verifyAuth,
  validate(buildBundleSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildBundleSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const requirements = buildClientRequirementsBundle(
        body.clientId,
        body.baseRequirements,
        body.clientSpecificRequirements,
      );
      return res.json({ requirements });
    } catch (err) {
      logger.error?.('vendorOnboarding.buildClientBundle.error', err);
      captureRouteError(err, 'vendorOnboarding.buildClientBundle');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Endpoint 4 — summarize accreditation observations
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  observations: z.array(observationSchema).max(500),
});

router.post(
  '/:projectId/vendors/:vendorId/accreditation/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, vendorId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const status = summarizeAccreditation(vendorId, body.observations);
      return res.json({ status });
    } catch (err) {
      logger.error?.('vendorOnboarding.summarizeAccreditation.error', err);
      captureRouteError(err, 'vendorOnboarding.summarizeAccreditation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// Endpoint 5 — decide whether to escalate an observation
// ────────────────────────────────────────────────────────────────────────

const escalateSchema = z.object({
  observation: observationSchema,
  history: z.array(observationSchema).max(500),
  windowDays: z.number().int().positive().max(365).optional(),
});

router.post(
  '/:projectId/vendors/:vendorId/accreditation/should-escalate',
  verifyAuth,
  validate(escalateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof escalateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const shouldEscalate = shouldEscalateObservation(
        body.observation,
        body.history,
        body.windowDays,
      );
      return res.json({ shouldEscalate });
    } catch (err) {
      logger.error?.('vendorOnboarding.shouldEscalate.error', err);
      captureRouteError(err, 'vendorOnboarding.shouldEscalate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
