// Praeventio Guard — Protocols (IPER + PREXOR + TMERT) HTTP surface.
//
// Stateless compute endpoints over engines under `src/services/protocols/`:
//
//   POST /:projectId/protocols/iper      { input }    → IperResult
//   POST /:projectId/protocols/prexor    { measurements } → PrexorResult
//   POST /:projectId/protocols/tmert     { input }    → TmertResult
//
// Pure compute — no Firestore writes. Canonical Chilean health protocols:
// - IPER 5×5 risk matrix (probability × severity)
// - PREXOR auditory exposure (DS 594 — exchange rate 3 dB)
// - TMERT musculoskeletal disorders (Protocolo MINSAL 2012)
//
// Persistence surface (B-protocols — "TMERT/PREXOR invisibles": engines had
// no persistence/UI). Mirrors the ergonomic_assessments append-only
// semantics, but writes happen SERVER-SIDE via the Admin SDK (the
// `protocol_assessments` collection is default-denied for clients — see
// firestore.rules + security_spec.md):
//
//   POST /:projectId/protocols/tmert/assessments   { input, taskName, workerId? }
//   POST /:projectId/protocols/prexor/assessments  { measurements, taskName, workerId? }
//   GET  /:projectId/protocols/assessments[?protocol=TMERT|PREXOR]
//
// The persisted `result` is ALWAYS recomputed server-side from the raw
// inputs — a client-supplied verdict is never trusted — and
// `metadata.author` is stamped from the verified token (F3
// identity-from-token). Every write emits an audit_logs row.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  calculateIper,
  type IperInput,
} from '../../services/protocols/iper.js';
import {
  calculatePrexor,
  type PrexorMeasurement,
} from '../../services/protocols/prexor.js';
import {
  evaluateTmert,
  type TmertInput,
} from '../../services/protocols/tmert.js';

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
// 1. iper
// ────────────────────────────────────────────────────────────────────────

const iperSchema = z.object({
  input: z.object({
    probability: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    controlEffectiveness: z.enum(['none', 'low', 'medium', 'high']).optional(),
  }) as unknown as z.ZodType<IperInput>,
});

router.post(
  '/:projectId/protocols/iper',
  verifyAuth,
  validate(iperSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof iperSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculateIper(body.input);
      return res.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('IPER:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.iper.error', err);
      captureRouteError(err, 'protocols.iper');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. prexor
// ────────────────────────────────────────────────────────────────────────

const prexorSchema = z.object({
  measurements: z.array(z.object({
    durationHours: z.number().min(0).max(24),
    levelDbA: z.number().min(0).max(200),
  })).max(1000) as unknown as z.ZodType<PrexorMeasurement[]>,
});

router.post(
  '/:projectId/protocols/prexor',
  verifyAuth,
  validate(prexorSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof prexorSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculatePrexor(body.measurements);
      return res.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('PREXOR:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.prexor.error', err);
      captureRouteError(err, 'protocols.prexor');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. tmert
// ────────────────────────────────────────────────────────────────────────

const tmertConditionsSchema = z.object({
  A: z.boolean(),
  B: z.boolean(),
  C: z.boolean(),
});

const tmertSchema = z.object({
  input: z.object({
    repetitividad: tmertConditionsSchema,
    fuerza: tmertConditionsSchema,
    posturaForzada: tmertConditionsSchema,
    otros: tmertConditionsSchema,
    exposureHoursPerDay: z.number().min(0).max(24),
  }) as unknown as z.ZodType<TmertInput>,
});

router.post(
  '/:projectId/protocols/tmert',
  verifyAuth,
  validate(tmertSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof tmertSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = evaluateTmert(body.input);
      return res.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('TMERT:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.tmert.error', err);
      captureRouteError(err, 'protocols.tmert');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. Assessment persistence (TMERT + PREXOR) — append-only project history
// ────────────────────────────────────────────────────────────────────────

const ASSESSMENTS_COLLECTION = 'protocol_assessments';
const PROTOCOL_KINDS = ['TMERT', 'PREXOR'] as const;
type ProtocolKind = (typeof PROTOCOL_KINDS)[number];

// Shared metadata for a persisted assessment. `taskName` is the puesto de
// trabajo / tarea evaluada (the unit the MINSAL protocols evaluate);
// `workerId` is optional because both protocols can evaluate a GES (grupo de
// exposición similar) rather than a single worker.
const assessmentMetaShape = {
  taskName: z.string().min(1).max(200),
  workerId: z.string().min(1).max(128).optional(),
};

const tmertAssessmentSchema = z.object({
  input: z.object({
    repetitividad: tmertConditionsSchema,
    fuerza: tmertConditionsSchema,
    posturaForzada: tmertConditionsSchema,
    otros: tmertConditionsSchema,
    exposureHoursPerDay: z.number().min(0).max(24),
  }) as unknown as z.ZodType<TmertInput>,
  ...assessmentMetaShape,
});

const prexorAssessmentSchema = z.object({
  measurements: z
    .array(
      z.object({
        durationHours: z.number().min(0).max(24),
        levelDbA: z.number().min(0).max(200),
      }),
    )
    .min(1)
    .max(1000) as unknown as z.ZodType<PrexorMeasurement[]>,
  ...assessmentMetaShape,
});

interface PersistArgs {
  req: import('express').Request;
  res: import('express').Response;
  protocol: ProtocolKind;
  projectId: string;
  callerUid: string;
  taskName: string;
  workerId?: string;
  inputs: unknown;
  result: Record<string, unknown>;
  auditSummary: Record<string, unknown>;
}

async function persistAssessment({
  req,
  res,
  protocol,
  projectId,
  callerUid,
  taskName,
  workerId,
  inputs,
  result,
  auditSummary,
}: PersistArgs) {
  // Server-stamped fields: author comes from the verified token, computedAt
  // from the server clock. Nothing client-supplied can spoof either.
  const docBody = {
    projectId,
    protocol,
    taskName,
    workerId: workerId ?? null,
    inputs,
    result,
    computedAt: new Date().toISOString(),
    metadata: {
      author: callerUid,
      signedAt: null,
    },
  };
  const ref = await admin
    .firestore()
    .collection(ASSESSMENTS_COLLECTION)
    .add(docBody);

  // Audit-log invariant (CLAUDE.md #3/#14): awaited; the helper swallows
  // Firestore failures internally (logs at ERROR + returns false) so an
  // audit hiccup can never 5xx the already-persisted assessment.
  await auditServerEvent(
    req,
    `protocols.${protocol.toLowerCase()}.assessment_recorded`,
    'protocols',
    {
      assessmentId: ref.id,
      taskName,
      workerId: workerId ?? null,
      ...auditSummary,
    },
    { projectId },
  );

  return res.status(201).json({ id: ref.id, result });
}

router.post(
  '/:projectId/protocols/tmert/assessments',
  verifyAuth,
  validate(tmertAssessmentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof tmertAssessmentSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = evaluateTmert(body.input);
      return await persistAssessment({
        req,
        res,
        protocol: 'TMERT',
        projectId,
        callerUid,
        taskName: body.taskName,
        workerId: body.workerId,
        inputs: body.input,
        result: result as unknown as Record<string, unknown>,
        auditSummary: {
          overallRisk: result.overallRisk,
          factorsAtRisk: result.factorsAtRisk,
          requiresMedicalEvaluation: result.requiresMedicalEvaluation,
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('TMERT:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.tmert.assessment.error', err);
      captureRouteError(err, 'protocols.tmert.assessment');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/protocols/prexor/assessments',
  verifyAuth,
  validate(prexorAssessmentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof prexorAssessmentSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculatePrexor(body.measurements);
      return await persistAssessment({
        req,
        res,
        protocol: 'PREXOR',
        projectId,
        callerUid,
        taskName: body.taskName,
        workerId: body.workerId,
        inputs: body.measurements,
        result: result as unknown as Record<string, unknown>,
        auditSummary: {
          riskLevel: result.riskLevel,
          dosePercent: result.dosePercent,
          exceedsLegalLimit: result.exceedsLegalLimit,
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('PREXOR:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.prexor.assessment.error', err);
      captureRouteError(err, 'protocols.prexor.assessment');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. Per-project assessment history (member read, via Admin SDK)
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/protocols/assessments', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!(await guard(callerUid, projectId, res))) return undefined;

  const rawProtocol = req.query.protocol;
  let protocol: ProtocolKind | null = null;
  if (rawProtocol !== undefined) {
    if (
      typeof rawProtocol !== 'string' ||
      !PROTOCOL_KINDS.includes(rawProtocol as ProtocolKind)
    ) {
      return res.status(400).json({ error: 'invalid_protocol' });
    }
    protocol = rawProtocol as ProtocolKind;
  }

  try {
    let query = admin
      .firestore()
      .collection(ASSESSMENTS_COLLECTION)
      .where('projectId', '==', projectId);
    if (protocol) query = query.where('protocol', '==', protocol);
    const snap = await query.orderBy('computedAt', 'desc').limit(100).get();
    const assessments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ assessments });
  } catch (err) {
    logger.error?.('protocols.assessments.list.error', err);
    captureRouteError(err, 'protocols.assessments.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
