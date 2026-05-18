// Praeventio Guard — Auditoría Express Bundle (PDF index) HTTP surface.
//
// Sprint 39 Fase F.1 — single stateless endpoint over the builder under
// `src/services/audit/expressBundleBuilder.ts`:
//
//   POST /:projectId/express-bundle/build
//     body: { projectName, generatedBy: { fullName, role }, data }
//     200:  { manifest: { generatedAt, complianceSnapshot, summary, indexPdfBase64 } }
//
// Pure compute — no Firestore writes. Caller takes the base64-decoded
// PDF + the rest of the source files and assembles the final ZIP via
// the existing Cloud Function (Admin SDK + Storage write-once).
//
// Server-side identity overrides:
//   - generatedBy.uid forced from authenticated callerUid.
//   - generatedAt forced to server clock (clients cannot backdate).
//   - projectId from URL takes precedence over body.

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
  buildExpressBundleManifest,
  type ExpressBundleInput,
} from '../../services/audit/expressBundleBuilder.js';

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

const DOC_STATUSES = ['vigente', 'vencido', 'pendiente_firma'] as const;
const TRAINING_STATUSES = ['vigente', 'vencido'] as const;
const IPER_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const TRAFFIC_LIGHT = ['green', 'yellow', 'red'] as const;
const LEGAL_CATEGORIES = ['committee', 'training', 'process', 'document', 'medical', 'epp'] as const;
const LEGAL_URGENCY = ['critical', 'recommended'] as const;

const bundleDocSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  status: z.enum(DOC_STATUSES),
  storageUrl: z.string().min(1).max(2000).optional(),
});

const bundleIperSchema = z.object({
  id: z.string().min(1).max(200),
  risk: z.string().min(1).max(500),
  severity: z.enum(IPER_SEVERITIES),
  mitigation: z.string().min(0).max(2000).optional(),
});

const bundleTrainingSchema = z.object({
  id: z.string().min(1).max(200),
  course: z.string().min(1).max(500),
  workerName: z.string().min(1).max(500),
  workerRut: z.string().min(1).max(50),
  validUntil: z.string().min(10).optional(),
  status: z.enum(TRAINING_STATUSES),
});

const bundleEppItemSchema = z.object({
  label: z.string().min(1).max(500),
  receivedAt: z.string().min(10),
  expiresAt: z.string().min(10).optional(),
});

const bundleEppSchema = z.object({
  workerName: z.string().min(1).max(500),
  workerRut: z.string().min(1).max(50),
  items: z.array(bundleEppItemSchema).max(100),
});

const bundleWorkerSchema = z.object({
  uid: z.string().min(1).max(200),
  fullName: z.string().min(1).max(500),
  rut: z.string().min(1).max(50),
  role: z.string().min(1).max(200),
  startDate: z.string().min(10).optional(),
});

const bundlePhotoSchema = z.object({
  id: z.string().min(1).max(200),
  caption: z.string().min(0).max(1000),
  storageUrl: z.string().min(1).max(2000),
  takenAt: z.string().min(10),
});

const bundleAuditLogSchema = z.object({
  action: z.string().min(1).max(200),
  timestamp: z.string().min(10),
  userId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const legalRequirementSchema = z.object({
  ruleId: z.string().min(1).max(200),
  category: z.enum(LEGAL_CATEGORIES),
  recommendation: z.string().min(1).max(2000),
  legalCitation: z.string().min(1).max(500),
  urgency: z.enum(LEGAL_URGENCY),
  suggestedDeadline: z.string().min(0).max(500).optional(),
});

const categoryStatusSchema = z.object({
  category: z.string().min(1).max(100),
  light: z.enum(TRAFFIC_LIGHT),
  summary: z.string().min(0).max(1000),
  criticalItemIds: z.array(z.string().min(1).max(200)).max(200),
  warningCount: z.number().int().nonnegative().max(10_000),
});

const complianceSnapshotSchema = z.object({
  overall: z.enum(TRAFFIC_LIGHT),
  byCategory: z.array(categoryStatusSchema).max(50),
  score: z.number().min(0).max(100),
  computedAt: z.string().min(10),
});

const buildSchema = z.object({
  projectName: z.string().min(1).max(500),
  generatedBy: z.object({
    fullName: z.string().min(1).max(500),
    role: z.string().min(1).max(200),
  }),
  data: z.object({
    documents: z.array(bundleDocSchema).max(10_000),
    iperMatrix: z.array(bundleIperSchema).max(10_000),
    trainings: z.array(bundleTrainingSchema).max(50_000),
    eppAssignments: z.array(bundleEppSchema).max(50_000),
    activeWorkers: z.array(bundleWorkerSchema).max(50_000),
    applicableProtocols: z.array(legalRequirementSchema).max(500),
    photoEvidences: z.array(bundlePhotoSchema).max(50_000),
    recentAuditLogs: z.array(bundleAuditLogSchema).max(50_000),
    complianceSnapshot: complianceSnapshotSchema,
  }),
});

router.post(
  '/:projectId/express-bundle/build',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const input: ExpressBundleInput = {
        projectId,
        projectName: body.projectName,
        generatedBy: {
          uid: callerUid,
          fullName: body.generatedBy.fullName,
          role: body.generatedBy.role,
        },
        generatedAt: new Date(),
        data: body.data as ExpressBundleInput['data'],
      };
      const manifest = await buildExpressBundleManifest(input);
      return res.json({
        manifest: {
          generatedAt: manifest.generatedAt,
          complianceSnapshot: manifest.complianceSnapshot,
          summary: manifest.summary,
          indexPdfBase64: manifest.indexPdf.toString('base64'),
        },
      });
    } catch (err) {
      logger.error?.('expressBundle.build.error', err);
      captureRouteError(err, 'expressBundle.build');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
