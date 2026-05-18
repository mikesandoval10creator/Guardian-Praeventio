// Praeventio Guard — Portable worker history HTTP surface.
//
// Three stateless endpoints over the engine under
// `src/services/workerHistory/portableHistoryExporter.ts`:
//
//   POST /:projectId/worker-history/build-portable
//     body: { worker, options }
//     200:  { history: PortableWorkerHistory }
//
//   POST /:projectId/worker-history/redact-pii
//     body: { history, level }
//     200:  { history: PortableWorkerHistory }
//
//   POST /:projectId/worker-history/serialize
//     body: { history, format }   // 'json' | 'markdown'
//     200:  { export: SerializedExport }
//
// Pure compute — no Firestore writes. ADR 0012 compliant: medical data
// only flows when `includeMedical=true` AND `redactionLevel='medical'`,
// AND the supervisor's body.options.requestedBy reflects the caller's
// authenticated identity (forced server-side).

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
  buildPortableHistory,
  redactPII,
  serializeAsJson,
  serializeAsMarkdown,
  type WorkerData,
  type BuildOptions,
  type PortableWorkerHistory,
  type RedactionLevel,
} from '../../services/workerHistory/portableHistoryExporter.js';

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

const REDACTION_LEVELS: readonly RedactionLevel[] = ['public', 'employer', 'medical'];
const ROLES = ['self', 'employer', 'physician', 'inspector'] as const;

const identitySchema = z.object({
  fullName: z.string().min(1).max(500),
  rut: z.string().min(7).max(20),
  birthYear: z.number().int().min(1900).max(2100).optional(),
  email: z.string().min(1).max(500).optional(),
});

const spanSchema = z.object({
  employerName: z.string().min(1).max(500),
  startDate: z.string().min(10),
  endDate: z.string().min(10).nullable(),
  position: z.string().min(1).max(500),
  industry: z.string().min(1).max(200),
});

const trainingSchema = z.object({
  trainingCode: z.string().min(1).max(200),
  trainingName: z.string().min(1).max(500),
  obtainedAt: z.string().min(10),
  expiresAt: z.string().min(10).nullable(),
  issuer: z.string().min(1).max(500),
  hours: z.number().nonnegative().max(10_000),
});

const certSchema = z.object({
  certificationCode: z.string().min(1).max(200),
  certificationName: z.string().min(1).max(500),
  obtainedAt: z.string().min(10),
  expiresAt: z.string().min(10).nullable(),
  issuer: z.string().min(1).max(500),
  folio: z.string().min(1).max(200).optional(),
});

const eppSchema = z.object({
  eppCategory: z.string().min(1).max(200),
  eppModel: z.string().min(1).max(500),
  deliveredAt: z.string().min(10),
  nextReplacementAt: z.string().min(10).nullable(),
});

const exposureSchema = z.object({
  agent: z.string().min(1).max(200),
  totalHours: z.number().nonnegative().max(1_000_000),
  year: z.number().int().min(1900).max(2100),
  averageMeasurement: z.number().optional(),
  measurementUnit: z.string().min(1).max(50).optional(),
});

const medicalSchema = z.object({
  category: z.string().min(1).max(200),
  summary: z.string().min(1).max(5000),
  recordedAt: z.string().min(10),
  source: z.string().min(1).max(500).optional(),
});

const workerDataSchema = z.object({
  identity: identitySchema,
  employmentSpans: z.array(spanSchema).max(500),
  completedTrainings: z.array(trainingSchema).max(2000),
  certifications: z.array(certSchema).max(500),
  eppHistory: z.array(eppSchema).max(5000),
  exposureLog: z.array(exposureSchema).max(2000),
  medicalContext: z.array(medicalSchema).max(500).optional(),
}) as unknown as z.ZodType<WorkerData>;

// ────────────────────────────────────────────────────────────────────────
// 1. build-portable
// ────────────────────────────────────────────────────────────────────────

const buildSchema = z.object({
  worker: workerDataSchema,
  options: z.object({
    includeMedical: z.boolean().optional(),
    redactionLevel: z.enum(REDACTION_LEVELS as readonly [RedactionLevel, ...RedactionLevel[]]),
    exportedAt: z.string().min(10),
    requestedBy: z.object({
      role: z.enum(ROLES),
    }),
  }),
});

router.post(
  '/:projectId/worker-history/build-portable',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const options: BuildOptions = {
        includeMedical: body.options.includeMedical,
        redactionLevel: body.options.redactionLevel,
        exportedAt: body.options.exportedAt,
        requestedBy: {
          uid: callerUid,
          role: body.options.requestedBy.role,
        },
      };
      const history = buildPortableHistory(body.worker, options);
      return res.json({ history });
    } catch (err) {
      logger.error?.('workerHistory.buildPortable.error', err);
      captureRouteError(err, 'workerHistory.buildPortable');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. redact-pii
// ────────────────────────────────────────────────────────────────────────

const historySchema = z.unknown() as unknown as z.ZodType<PortableWorkerHistory>;

const redactSchema = z.object({
  history: historySchema,
  level: z.enum(REDACTION_LEVELS as readonly [RedactionLevel, ...RedactionLevel[]]),
});

router.post(
  '/:projectId/worker-history/redact-pii',
  verifyAuth,
  validate(redactSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof redactSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const history = redactPII(body.history, body.level);
      return res.json({ history });
    } catch (err) {
      logger.error?.('workerHistory.redactPii.error', err);
      captureRouteError(err, 'workerHistory.redactPii');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. serialize
// ────────────────────────────────────────────────────────────────────────

const serializeSchema = z.object({
  history: historySchema,
  format: z.enum(['json', 'markdown']),
});

router.post(
  '/:projectId/worker-history/serialize',
  verifyAuth,
  validate(serializeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof serializeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const out =
        body.format === 'json'
          ? serializeAsJson(body.history)
          : serializeAsMarkdown(body.history);
      return res.json({ export: out });
    } catch (err) {
      logger.error?.('workerHistory.serialize.error', err);
      captureRouteError(err, 'workerHistory.serialize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
