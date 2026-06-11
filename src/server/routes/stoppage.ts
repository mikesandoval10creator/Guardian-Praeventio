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
//
//   POST /:projectId/stoppage/resolve            (arista B4 — STATEFUL)
//     body: { stoppageId, verdict: justificada|no_justificada, comment? }
//     Approver-role gated (claim from the verified token). Reads + updates
//     projects/{pid}/stoppages/{id} inside a transaction (idempotent —
//     re-resolving returns 409 and never duplicates the prize). On verdict
//     'justificada' the declarer is structurally rewarded: a positive
//     observation (canonical PositiveObservationsAdapter path) + XP
//     (POINT_VALUES.stoppage_justified via gamificationBackend.awardPoints).
//     200:  { stoppage, recognition: { recipientUid, xpAwarded, observationId } | null }

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
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  declareStoppage,
  markPreconditionFulfilled,
  resume,
  cancelStoppage,
  resolveStoppage,
  isApproverRole,
  summarize,
  StoppageValidationError,
  type Stoppage,
  type StoppageCategory,
  type StoppageScope,
  type StoppageStatus,
} from '../../services/stoppage/stoppageEngine.js';
import { awardPoints } from '../../services/gamificationBackend.js';
import { POINT_VALUES } from '../../services/gamification/pointValues.js';
import { PositiveObservationsAdapter } from '../../services/positiveObservations/positiveObservationsFirestoreAdapter.js';

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

// ────────────────────────────────────────────────────────────────────────
// 6. resolve — veredicto post-cierre + premio estructural (arista B4)
// ────────────────────────────────────────────────────────────────────────
//
// Unlike the stateless endpoints above, /resolve is SERVER-AUTHORITATIVE:
// the stoppage is read from Firestore (projects/{pid}/stoppages/{id} — the
// path the client stoppageStore persists to), never trusted from the body.
// Otherwise a caller could fabricate a "justified stoppage" payload and farm
// XP/recognitions for arbitrary uids.

/** Same pattern as positiveObservations.ts — projectId → tenantId lookup. */
async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  const members = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .where('uid', '==', callerUid)
    .limit(1)
    .get();
  if (!members.empty) {
    const tid = members.docs[0]?.data()?.tenantId;
    if (typeof tid === 'string') return tid;
  }
  return null;
}

class StoppageNotFoundError extends Error {}

const resolveSchema = z.object({
  stoppageId: z.string().min(1).max(200),
  verdict: z.enum(['justificada', 'no_justificada']),
  comment: z.string().min(1).max(2000).optional(),
});

const POSITIVE_OBS_MAX_DESCRIPTION = 2000;

router.post(
  '/:projectId/stoppage/resolve',
  verifyAuth,
  validate(resolveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    // Server-authoritative role: comes from the VERIFIED token claim stamped
    // by verifyAuth — never from the request body (a body role would let any
    // member self-promote into verdict authority).
    const callerRole = req.user!.role ?? 'worker';
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof resolveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (!isApproverRole(callerRole)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const db = admin.firestore();
    const stoppageRef = db
      .collection('projects')
      .doc(projectId)
      .collection('stoppages')
      .doc(body.stoppageId);

    try {
      // Read-modify-write on the same doc → transaction (CLAUDE.md #19).
      // The engine throws ALREADY_RESOLVED inside the txn, so two concurrent
      // resolvers cannot both commit a verdict (idempotent prize).
      const resolved = await db.runTransaction(async (txn) => {
        const snap = await txn.get(stoppageRef);
        if (!snap.exists) throw new StoppageNotFoundError(body.stoppageId);
        const next = resolveStoppage(
          snap.data() as Stoppage,
          body.verdict,
          callerUid,
          callerRole,
          body.comment,
        );
        txn.update(stoppageRef, { resolution: next.resolution });
        return next;
      });

      // Prize — only for a JUSTIFIED stoppage, and never self-awarded (the
      // resolver cannot reward a stoppage they declared themselves).
      let recognition:
        | { recipientUid: string; xpAwarded: number; observationId: string | null }
        | null = null;
      if (
        resolved.resolution!.verdict === 'justificada' &&
        resolved.declaredByUid !== callerUid
      ) {
        try {
          // 1. Positive observation through the canonical adapter (§214-215).
          //    Deterministic doc id keyed by stoppage → idempotent at the
          //    persistence level too.
          const observationId = `stoppage-justified-${resolved.id}`;
          let observationWritten = false;
          const tenantId = await resolveTenantId(callerUid, projectId, db);
          if (tenantId) {
            const adapter = new PositiveObservationsAdapter(db, tenantId, projectId);
            const description =
              // Spanish-CL user-facing copy (CLAUDE.md #2).
              `Paralización justificada: detuvo los trabajos ante un riesgo real (${resolved.reason}). Reconocimiento automático por ejercer la autoridad de detención.`.slice(
                0,
                POSITIVE_OBS_MAX_DESCRIPTION,
              );
            await adapter.save({
              id: observationId,
              observedWorkerUid: resolved.declaredByUid,
              observerUid: callerUid,
              observerRole: callerRole,
              kind: 'safe_behavior',
              description,
              observedAt: resolved.declaredAt,
              location: `${resolved.scope}:${resolved.scopeTargetId}`,
              shared: true,
            });
            observationWritten = true;
          } else {
            logger.warn?.('stoppage.resolve.tenantNotFound', { projectId });
          }
          // 2. XP through the canonical server-side gamification path.
          await awardPoints(
            resolved.declaredByUid,
            POINT_VALUES.stoppage_justified,
            'stoppage_justified',
          );
          recognition = {
            recipientUid: resolved.declaredByUid,
            xpAwarded: POINT_VALUES.stoppage_justified,
            observationId: observationWritten ? observationId : null,
          };
        } catch (err) {
          // The verdict (legal act) already committed — a prize failure is
          // severe but must not 5xx the resolution. Surfaced via logs/Sentry.
          logger.error?.('stoppage.resolve.prizeFailed', err);
          captureRouteError(err, 'stoppage.resolve.prize');
        }
      }

      // Audit trail (CLAUDE.md #3/#14) — awaited, non-blocking on failure.
      try {
        await auditServerEvent(
          req,
          'stoppage.resolve',
          'stoppage',
          {
            stoppageId: resolved.id,
            verdict: resolved.resolution!.verdict,
            declaredByUid: resolved.declaredByUid,
            recognitionAwarded: recognition !== null,
            xpAwarded: recognition?.xpAwarded ?? 0,
          },
          { projectId },
        );
      } catch (err) {
        logger.error?.('audit_event_failed', err);
      }

      return res.json({ stoppage: resolved, recognition });
    } catch (err) {
      if (err instanceof StoppageNotFoundError) {
        return res.status(404).json({ error: 'stoppage_not_found' });
      }
      if (err instanceof StoppageValidationError && err.code === 'ALREADY_RESOLVED') {
        return res.status(409).json({ error: 'already_resolved' });
      }
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('stoppage.resolve.error', err);
      captureRouteError(err, 'stoppage.resolve');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
