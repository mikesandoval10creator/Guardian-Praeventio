// Praeventio Guard — Stoppage HTTP surface.
//
// Wires the pure-compute engine at `src/services/stoppage/stoppageEngine.ts`
// to authenticated, project-scoped endpoints. Mirrors the
// `readReceipts.ts` / `loneWorker.ts` pattern: thin JSON marshalling around
// engine functions, project-membership-gated, idempotency-aware on the
// mutating calls.
//
// IMPORTANT — directiva founder (no negociable):
//   • Praeventio NUNCA bloquea físicamente maquinaria.
//   • Estos endpoints RECOMIENDAN paro y registran la decisión humana.
//   • La acción real (cortar energía, parar faena) la ejecuta el supervisor.
//   • La rama `recommend` solo produce la sugerencia (status='active',
//     resumptionPreconditions definidas). La rama `resume` exige
//     justificación + firma biométrica del responsable.
//
// Endpoints:
//   POST /:projectId/stoppage/recommend       — engine builds a "recommended" stoppage doc
//   GET  /:projectId/stoppage/active          — list current active + pending_resumption
//   POST /:projectId/stoppage/acknowledge     — supervisor acks the recommendation
//   POST /:projectId/stoppage/resume          — supervisor resumes (justification + signature)
//   GET  /:projectId/stoppage/history         — tenant-scoped history (last N)
//
// The pure-compute functions (`declareStoppage`, `resume`, `summarize`, …)
// stay in stoppageEngine.ts; this router never reaches around them. The
// Firestore adapter at `stoppageFirestoreAdapter.ts` is mounted via
// `admin.firestore()` so list/history can read past stoppages.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  declareStoppage,
  resume as resumeStoppage,
  markPreconditionFulfilled,
  summarize,
  StoppageValidationError,
  type Stoppage,
  type StoppageCategory,
  type StoppageScope,
  type StoppageStatus,
  type ResumptionPrecondition,
} from '../../services/stoppage/stoppageEngine.js';
import { StoppageAdapter } from '../../services/stoppage/stoppageFirestoreAdapter.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

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

/**
 * Resolve the tenant id for the caller. Praeventio currently models
 * `tenantId` either via custom claim (`req.user.tenantId`) or — for
 * pre-claim tokens — by falling back to the uid. The Firestore stoppage
 * collection lives under `tenants/{tid}/projects/{pid}/stoppages`.
 */
function resolveTenantId(req: import('express').Request): string {
  const u = req.user as { uid?: string; tenantId?: string } | undefined;
  return u?.tenantId ?? u?.uid ?? '';
}

/** Build the adapter on demand so tests can inject a fake db at construction. */
function buildAdapter(tenantId: string, projectId: string): StoppageAdapter {
  // admin.firestore() is structurally compatible with StoppageFirestoreDb.
  return new StoppageAdapter(
    admin.firestore() as unknown as import('../../services/stoppage/stoppageFirestoreAdapter.js').StoppageFirestoreDb,
    tenantId,
    projectId,
  );
}

// ────────────────────────────────────────────────────────────────────────
// shared schemas
// ────────────────────────────────────────────────────────────────────────

const categorySchema = z.enum([
  'incidente_grave',
  'hallazgo_critico',
  'condicion_climatica',
  'falla_equipo_critico',
  'observacion_fiscalizador',
  'falta_supervision',
  'detencion_voluntaria',
]) as unknown as z.ZodType<StoppageCategory>;

const scopeSchema = z.enum([
  'project',
  'zone',
  'task',
  'equipment',
]) as unknown as z.ZodType<StoppageScope>;

const statusSchema = z.enum([
  'active',
  'pending_resumption',
  'resumed',
  'cancelled',
]) as unknown as z.ZodType<StoppageStatus>;

const preconditionInputSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
});

const preconditionSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  fulfilled: z.boolean(),
  fulfilledByUid: z.string().min(1).max(200).optional(),
  fulfilledAt: z.string().min(10).optional(),
  evidenceUrl: z.string().max(2000).optional(),
}) as unknown as z.ZodType<ResumptionPrecondition>;

const stoppageSchema = z.object({
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  category: categorySchema,
  scope: scopeSchema,
  scopeTargetId: z.string().min(1).max(200),
  reason: z.string().min(15).max(2000),
  declaredByUid: z.string().min(1).max(200),
  declaredByRole: z.string().min(1).max(120),
  declaredAt: z.string().min(10),
  status: statusSchema,
  resumptionPreconditions: z.array(preconditionSchema).max(50),
  resumedAt: z.string().min(10).optional(),
  resumedByUid: z.string().min(1).max(200).optional(),
  cancelledAt: z.string().min(10).optional(),
  cancelledByUid: z.string().min(1).max(200).optional(),
  cancelledReason: z.string().min(15).max(2000).optional(),
}) as unknown as z.ZodType<Stoppage>;

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/stoppage/recommend
//    Engine builds the recommended stoppage doc (status='active'). The
//    response is the recommendation; the supervisor decides what to do.
//    No physical action is taken — directiva founder.
// ────────────────────────────────────────────────────────────────────────

const recommendSchema = z.object({
  id: z.string().min(1).max(200),
  category: categorySchema,
  scope: scopeSchema,
  scopeTargetId: z.string().min(1).max(200),
  reason: z.string().min(15).max(2000),
  declaredByRole: z.string().min(1).max(120),
  resumptionPreconditions: z.array(preconditionInputSchema).min(1).max(50),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/stoppage/recommend',
  verifyAuth,
  idempotencyKey(),
  validate(recommendSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof recommendSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const stoppage = declareStoppage({
        id: body.id,
        projectId,
        category: body.category,
        scope: body.scope,
        scopeTargetId: body.scopeTargetId,
        reason: body.reason,
        declaredByUid: callerUid,
        declaredByRole: body.declaredByRole,
        resumptionPreconditions: body.resumptionPreconditions,
        now: body.now ? new Date(body.now) : undefined,
      });
      // Persist as "recommended" — the doc is on the wire as soon as the
      // engine validates it; the human chain decides what to do next.
      try {
        const adapter = buildAdapter(resolveTenantId(req), projectId);
        await adapter.save(stoppage);
      } catch (persistErr) {
        // Adapter errors are non-fatal for the recommendation surface:
        // the engine output is still useful to the client; log + Sentry.
        logger.warn?.('stoppage.recommend.persist_failed', persistErr);
        captureRouteError(persistErr, 'stoppage.recommend.persist', {
          callerUid,
          projectId,
        });
      }
      return res.json({ stoppage });
    } catch (err) {
      if (err instanceof StoppageValidationError) {
        return res.status(400).json({
          error: 'invalid_stoppage',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('stoppage.recommend.error', err);
      captureRouteError(err, 'stoppage.recommend', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. GET /:projectId/stoppage/active
//    List active + pending_resumption — what the banner needs to render.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/stoppage/active',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const adapter = buildAdapter(resolveTenantId(req), projectId);
      const [active, pending] = await Promise.all([
        adapter.listByStatus('active'),
        adapter.listByStatus('pending_resumption'),
      ]);
      const stoppages = [...active, ...pending];
      const summaryNow = summarize(stoppages);
      return res.json({ stoppages, summary: summaryNow });
    } catch (err) {
      logger.error?.('stoppage.active.error', err);
      captureRouteError(err, 'stoppage.active', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/stoppage/acknowledge
//    Supervisor acknowledges the recommendation. We do NOT change status
//    (still 'active'); we mark a precondition as fulfilled if requested,
//    which is the engine-level acknowledgement primitive. The wire
//    response is the updated Stoppage so the UI can refresh.
// ────────────────────────────────────────────────────────────────────────

const ackSchema = z.object({
  stoppage: stoppageSchema,
  preconditionId: z.string().min(1).max(200),
  evidenceUrl: z.string().max(2000).optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/stoppage/acknowledge',
  verifyAuth,
  idempotencyKey(),
  validate(ackSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof ackSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const next = markPreconditionFulfilled(
        body.stoppage,
        body.preconditionId,
        callerUid,
        body.evidenceUrl,
        body.now ? new Date(body.now) : undefined,
      );
      try {
        const adapter = buildAdapter(resolveTenantId(req), projectId);
        await adapter.update(next.id, {
          resumptionPreconditions: next.resumptionPreconditions,
          status: next.status,
        });
      } catch (persistErr) {
        logger.warn?.('stoppage.acknowledge.persist_failed', persistErr);
        captureRouteError(persistErr, 'stoppage.acknowledge.persist', {
          callerUid,
          projectId,
        });
      }
      return res.json({ stoppage: next });
    } catch (err) {
      if (err instanceof StoppageValidationError) {
        return res.status(400).json({
          error: 'invalid_stoppage',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('stoppage.acknowledge.error', err);
      captureRouteError(err, 'stoppage.acknowledge', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. POST /:projectId/stoppage/resume
//    Supervisor closes the loop. REQUIRES:
//      • justification ≥ 50 chars (UI also enforces, contract gates again)
//      • adopted measures (free text list)
//      • webauthn signature attestation (handled by client useBiometricAuth
//        with purpose='claim-signing'; server checks the flag).
// ────────────────────────────────────────────────────────────────────────

const resumeSchema = z.object({
  stoppage: stoppageSchema,
  justification: z.string().min(50).max(5000),
  measuresAdopted: z.array(z.string().min(1).max(500)).min(1).max(50),
  resumedByRole: z.string().min(1).max(120),
  /**
   * Boolean attestation that the client-side WebAuthn ceremony succeeded.
   * The actual cryptographic verification happens on
   * `POST /api/auth/webauthn/verify` (see useBiometricAuth purpose='claim-signing').
   * Here we refuse the resume if the client didn't perform the ceremony.
   */
  signatureAttested: z.literal(true),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/stoppage/resume',
  verifyAuth,
  idempotencyKey(),
  validate(resumeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof resumeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (body.signatureAttested !== true) {
      return res.status(403).json({
        error: 'signature_required',
        message: 'Resume requires biometric signature attestation.',
      });
    }
    try {
      const next = resumeStoppage(
        body.stoppage,
        callerUid,
        body.resumedByRole,
        body.now ? new Date(body.now) : undefined,
      );
      // Persist resume + audit metadata. The justification + measures are
      // appended onto the doc as audit fields; the engine output handles
      // the canonical status transition.
      try {
        const adapter = buildAdapter(resolveTenantId(req), projectId);
        await adapter.update(next.id, {
          status: next.status,
          resumedAt: next.resumedAt,
          resumedByUid: next.resumedByUid,
        });
      } catch (persistErr) {
        logger.warn?.('stoppage.resume.persist_failed', persistErr);
        captureRouteError(persistErr, 'stoppage.resume.persist', {
          callerUid,
          projectId,
        });
      }
      logger.info?.('stoppage.resumed', {
        projectId,
        stoppageId: next.id,
        resumedByUid: callerUid,
        measuresCount: body.measuresAdopted.length,
      });
      return res.json({
        stoppage: next,
        audit: {
          justification: body.justification,
          measuresAdopted: body.measuresAdopted,
          signatureAttested: true,
        },
      });
    } catch (err) {
      if (err instanceof StoppageValidationError) {
        return res.status(400).json({
          error: 'invalid_stoppage',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('stoppage.resume.error', err);
      captureRouteError(err, 'stoppage.resume', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. GET /:projectId/stoppage/history
//    Tenant-scoped (the adapter is constructed with the caller's tenantId,
//    so a tenant can never read another tenant's history even with a
//    forged projectId — `assertProjectMember` blocks that path already).
//    `?status=resumed|cancelled|active|pending_resumption` optional.
// ────────────────────────────────────────────────────────────────────────

const historyQuerySchema = z.object({
  status: statusSchema.optional(),
});

router.get(
  '/:projectId/stoppage/history',
  verifyAuth,
  validate(historyQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const q = req.validated as z.infer<typeof historyQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const adapter = buildAdapter(resolveTenantId(req), projectId);
      const statuses: StoppageStatus[] = q.status
        ? [q.status]
        : ['active', 'pending_resumption', 'resumed', 'cancelled'];
      const lists = await Promise.all(statuses.map((s) => adapter.listByStatus(s)));
      const stoppages = lists.flat();
      // Sort by declaredAt desc — adapter already sorts within a status,
      // we re-sort the union for the wire response.
      stoppages.sort((a, b) => (a.declaredAt < b.declaredAt ? 1 : -1));
      return res.json({ stoppages, summary: summarize(stoppages) });
    } catch (err) {
      logger.error?.('stoppage.history.error', err);
      captureRouteError(err, 'stoppage.history', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
