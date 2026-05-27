// Praeventio Guard — Stoppage (Paralización + Reanudación) HTTP surface.
//
// Sprint 39 I.1 — stateless ops over the engine under
// `src/services/stoppage/stoppageEngine.ts`:
//
//   POST /:projectId/stoppage/declare
//     body: declareInput  // declaredByUid forced from caller
//     200:  { stoppage }
//
//   POST /:projectId/stoppage/mark-precondition-fulfilled
//     body: { stoppage, preconditionId, evidenceUrl? }  // verifierUid = caller
//     200:  { stoppage }
//
//   POST /:projectId/stoppage/resume
//     body: { stoppage, resumedByRole }  // resumedByUid = caller
//     200:  { stoppage }
//
//   POST /:projectId/stoppage/cancel
//     body: { stoppage, reason }  // cancelledByUid = caller
//     200:  { stoppage }
//
//   POST /:projectId/stoppage/summarize
//     body: { stoppages: Stoppage[] }
//     200:  { summary }

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
  declareStoppage,
  markPreconditionFulfilled,
  resume,
  cancelStoppage,
  summarize,
  StoppageValidationError,
  type Stoppage,
  type StoppageCategory,
  type StoppageScope,
  type StoppageStatus,
} from '../../services/stoppage/stoppageEngine.js';

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

const CATEGORIES = [
  'incidente_grave',
  'hallazgo_critico',
  'condicion_climatica',
  'falla_equipo_critico',
  'observacion_fiscalizador',
  'falta_supervision',
  'detencion_voluntaria',
] as const satisfies readonly StoppageCategory[];

const SCOPES = ['project', 'zone', 'task', 'equipment'] as const satisfies readonly StoppageScope[];
const STATUSES = ['active', 'pending_resumption', 'resumed', 'cancelled'] as const satisfies readonly StoppageStatus[];

const preconditionSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  fulfilled: z.boolean(),
  fulfilledByUid: z.string().min(1).max(200).optional(),
  fulfilledAt: z.string().min(10).max(64).optional(),
  evidenceUrl: z.string().min(1).max(2000).optional(),
});

const stoppageSchema = z.object({
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  category: z.enum(CATEGORIES),
  scope: z.enum(SCOPES),
  scopeTargetId: z.string().min(1).max(200),
  reason: z.string().min(1).max(5000),
  declaredByUid: z.string().min(1).max(200),
  declaredByRole: z.string().min(1).max(200),
  declaredAt: z.string().min(10).max(64),
  status: z.enum(STATUSES),
  resumptionPreconditions: z.array(preconditionSchema).max(1000),
  resumedAt: z.string().min(10).max(64).optional(),
  resumedByUid: z.string().min(1).max(200).optional(),
  cancelledAt: z.string().min(10).max(64).optional(),
  cancelledByUid: z.string().min(1).max(200).optional(),
  cancelledReason: z.string().max(5000).optional(),
}) as unknown as z.ZodType<Stoppage>;

function asEngineError(err: unknown): { code: number; body: { error: string } } | null {
  if (err instanceof StoppageValidationError) {
    return { code: 400, body: { error: err.message } };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 1. declare
// ────────────────────────────────────────────────────────────────────────

const declareSchema = z.object({
  id: z.string().min(1).max(200),
  category: z.enum(CATEGORIES),
  scope: z.enum(SCOPES),
  scopeTargetId: z.string().min(1).max(200),
  reason: z.string().min(1).max(5000),
  declaredByRole: z.string().min(1).max(200),
  resumptionPreconditions: z
    .array(z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(500) }))
    .min(1)
    .max(100),
});

router.post(
  '/:projectId/stoppage/declare',
  verifyAuth,
  validate(declareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof declareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const stoppage = declareStoppage({
        ...body,
        projectId,
        declaredByUid: callerUid,
      });
      return res.json({ stoppage });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('stoppage.declare.error', err);
      captureRouteError(err, 'stoppage.declare');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. mark-precondition-fulfilled
// ────────────────────────────────────────────────────────────────────────

const markPreconditionSchema = z.object({
  stoppage: stoppageSchema,
  preconditionId: z.string().min(1).max(200),
  evidenceUrl: z.string().min(1).max(2000).optional(),
});

router.post(
  '/:projectId/stoppage/mark-precondition-fulfilled',
  verifyAuth,
  validate(markPreconditionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof markPreconditionSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const stoppage = markPreconditionFulfilled(
        body.stoppage,
        body.preconditionId,
        callerUid,
        body.evidenceUrl,
      );
      return res.json({ stoppage });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('stoppage.markPrecondition.error', err);
      captureRouteError(err, 'stoppage.markPrecondition');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. resume
// ────────────────────────────────────────────────────────────────────────

const resumeSchema = z.object({
  stoppage: stoppageSchema,
  resumedByRole: z.string().min(1).max(200),
});

router.post(
  '/:projectId/stoppage/resume',
  verifyAuth,
  validate(resumeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof resumeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const stoppage = resume(body.stoppage, callerUid, body.resumedByRole);
      return res.json({ stoppage });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('stoppage.resume.error', err);
      captureRouteError(err, 'stoppage.resume');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. cancel
// ────────────────────────────────────────────────────────────────────────

const cancelSchema = z.object({
  stoppage: stoppageSchema,
  reason: z.string().min(15).max(5000),
});

router.post(
  '/:projectId/stoppage/cancel',
  verifyAuth,
  validate(cancelSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof cancelSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const stoppage = cancelStoppage(body.stoppage, callerUid, body.reason);
      return res.json({ stoppage });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('stoppage.cancel.error', err);
      captureRouteError(err, 'stoppage.cancel');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. summarize
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({
  stoppages: z.array(stoppageSchema).max(10_000),
});

router.post(
  '/:projectId/stoppage/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarize(body.stoppages);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('stoppage.summarize.error', err);
      captureRouteError(err, 'stoppage.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
