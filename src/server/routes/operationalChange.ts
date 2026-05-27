// Praeventio Guard — Bloque 3.17: Management of Change (MOC) HTTP surface
// (persistence-backed).
//
// Mirror del patrón loneWorker.ts + correctiveActions.ts: este router
// expone una superficie ADAPTER-BACKED para `OperationalChangeAdapter`
// (Firestore), complementaria al router pure-compute existente en
// `src/server/routes/changeMgmt.ts`.
//
// La diferencia es deliberada:
//   - `changeMgmt.ts` (`/:projectId/change-mgmt/*`) — pure compute.
//     Cliente provee el `change` completo en el body, server lo computa
//     y devuelve. Sin persistencia.
//   - `operationalChange.ts` (`/:projectId/moc/*`) — adapter-backed.
//     Server persiste declaraciones + acks vía `OperationalChangeAdapter`,
//     y permite listar pending/recientes desde Firestore.
//
// Endpoints:
//   POST /:projectId/moc/declare              { kind, whatChanged, previousValue, newValue, rationale, impact, affectedWorkerUids, declaredByRole, effectiveFrom, referenceDocumentId? }
//   GET  /:projectId/moc/pending-acks         → lista MOCs pendientes para el caller
//   POST /:projectId/moc/:mocId/acknowledge   → caller confirma lectura (server-side identity: workerUid = caller)
//   GET  /:projectId/moc/list[?kind=...&limit=N] → listado reciente (admin overview)
//   POST /:projectId/moc/:mocId/close         → admin marca implementado (requiere 100% ack)
//
// Anti-blame notes (alineado con ADR 0019 + directiva firma biométrica):
//   • declare: declaredByUid = caller. Role validado por el engine
//     (APPROVER_ROLES). Si el role no es elegible → 400.
//   • acknowledge: workerUid forzado al caller. Un trabajador solo puede
//     acknowledgar para sí mismo. Idempotente: re-ack del mismo worker
//     no duplica.
//   • close: cualquier project-member puede cerrar SI 100% de los workers
//     afectados ya acknowledgaron. Esto es un guardrail para que el MOC
//     no se marque implementado sin la cobertura legal completa.

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
  declareChange,
  acknowledgeChange,
  summarizeAcknowledgments,
  ChangeValidationError,
  type OperationalChange,
  type ChangeKind,
  type ChangeImpact,
} from '../../services/changeMgmt/operationalChangeService.js';
import { OperationalChangeAdapter } from '../../services/changeMgmt/operationalChangeFirestoreAdapter.js';

const router = Router();

const KINDS: readonly ChangeKind[] = [
  'supervisor',
  'procedure',
  'equipment',
  'shift',
  'work_zone',
  'mandatory_epp',
  'applicable_norm',
  'critical_control',
  'other',
];
const IMPACTS: readonly ChangeImpact[] = ['low', 'medium', 'high'];

async function resolveTenantId(
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ────────────────────────────────────────────────────────────────────────
// 1. declare — admin/supervisor declares a new operational change.
//    Persisted via OperationalChangeAdapter.save().
// ────────────────────────────────────────────────────────────────────────

const declareSchema = z.object({
  id: z.string().min(1).max(200).optional(),
  kind: z.enum(KINDS as readonly [ChangeKind, ...ChangeKind[]]),
  whatChanged: z.string().min(1).max(2000),
  previousValue: z.string().min(0).max(2000),
  newValue: z.string().min(0).max(2000),
  rationale: z.string().min(20).max(5000),
  impact: z.enum(IMPACTS as readonly [ChangeImpact, ...ChangeImpact[]]),
  affectedWorkerUids: z.array(z.string().min(1).max(200)).max(10_000),
  declaredByRole: z.string().min(1).max(200),
  effectiveFrom: z.string().min(10),
  referenceDocumentId: z.string().min(1).max(200).optional(),
});

router.post(
  '/:projectId/moc/declare',
  verifyAuth,
  idempotencyKey(),
  validate(declareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof declareSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const change = declareChange({
        ...body,
        projectId,
        declaredByUid: callerUid,
      });
      const adapter = new OperationalChangeAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      await adapter.save(change);
      return res.status(201).json({ change });
    } catch (err) {
      if (err instanceof ChangeValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('operationalChange.declare.error', err);
      captureRouteError(err, 'operationalChange.declare', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. pending-acks — lists recent changes where the caller is in
//    affectedWorkerUids AND has not yet acknowledged.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/moc/pending-acks',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new OperationalChangeAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const recent = await adapter.listRecent(undefined, 100);
      const pending = recent.filter(
        (c) =>
          !c.revertedAt &&
          c.affectedWorkerUids.includes(callerUid) &&
          !c.acknowledgments.some((a) => a.workerUid === callerUid),
      );
      return res.json({ pending });
    } catch (err) {
      logger.error?.('operationalChange.pendingAcks.error', err);
      captureRouteError(err, 'operationalChange.pendingAcks', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. acknowledge — caller confirms reading. workerUid forced to caller.
//    Idempotente: re-ack del mismo worker no duplica.
// ────────────────────────────────────────────────────────────────────────

const ackSchema = z.object({
  ackedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/moc/:mocId/acknowledge',
  verifyAuth,
  idempotencyKey(),
  validate(ackSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, mocId } = req.params;
    const body = req.body as z.infer<typeof ackSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new OperationalChangeAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const current = await adapter.getById(mocId);
      if (!current) return res.status(404).json({ error: 'moc_not_found' });

      // Use engine to validate (will throw NOT_IN_AUDIENCE / CHANGE_REVERTED).
      const ackedAt = body.ackedAt ?? new Date().toISOString();
      acknowledgeChange(current, callerUid, ackedAt);

      const updated = await adapter.addAcknowledgment(mocId, callerUid, ackedAt);
      if (!updated) return res.status(404).json({ error: 'moc_not_found' });
      return res.json({ change: updated });
    } catch (err) {
      if (err instanceof ChangeValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('operationalChange.acknowledge.error', err);
      captureRouteError(err, 'operationalChange.acknowledge', {
        callerUid,
        projectId,
        mocId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. list — admin overview. Filtra por kind opcional + limit.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/moc/list',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const kindParam =
        typeof req.query.kind === 'string' ? req.query.kind : undefined;
      const kind: ChangeKind | undefined = kindParam && (KINDS as readonly string[]).includes(kindParam)
        ? (kindParam as ChangeKind)
        : undefined;
      const limitParam =
        typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
      const limitN =
        Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 500
          ? limitParam
          : 50;
      const adapter = new OperationalChangeAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const items = await adapter.listRecent(kind, limitN);
      const summaries = items.map((c) => summarizeAcknowledgments(c));
      return res.json({ items, summaries });
    } catch (err) {
      logger.error?.('operationalChange.list.error', err);
      captureRouteError(err, 'operationalChange.list', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. close — admin marca el MOC como implementado.
//    GUARDRAIL: requiere 100% ack coverage (todos los affected confirmaron).
//    Persiste `implementedAt` + `implementedBy` via merge sobre el doc.
// ────────────────────────────────────────────────────────────────────────

const closeSchema = z.object({
  closingNote: z.string().min(0).max(2000).optional(),
});

router.post(
  '/:projectId/moc/:mocId/close',
  verifyAuth,
  idempotencyKey(),
  validate(closeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, mocId } = req.params;
    const body = req.body as z.infer<typeof closeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new OperationalChangeAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const current = await adapter.getById(mocId);
      if (!current) return res.status(404).json({ error: 'moc_not_found' });
      if (current.revertedAt) {
        return res.status(400).json({
          error: 'validation_error',
          code: 'CHANGE_REVERTED',
          message: 'cannot close a reverted MOC',
        });
      }
      const summary = summarizeAcknowledgments(current);
      if (summary.coveragePercent < 100) {
        return res.status(409).json({
          error: 'ack_coverage_incomplete',
          code: 'ACK_COVERAGE_INCOMPLETE',
          message: `MOC cannot be closed until 100% of affected workers acknowledge (${summary.acknowledged}/${summary.totalAffected})`,
          pendingWorkerUids: summary.pendingWorkerUids,
        });
      }
      const closedAt = new Date().toISOString();
      await admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/operational_changes`,
        )
        .doc(mocId)
        .set(
          {
            implementedAt: closedAt,
            implementedBy: callerUid,
            closingNote: body.closingNote ?? null,
          },
          { merge: true },
        );
      return res.json({
        ok: true,
        mocId,
        implementedAt: closedAt,
        implementedBy: callerUid,
      });
    } catch (err) {
      logger.error?.('operationalChange.close.error', err);
      captureRouteError(err, 'operationalChange.close', {
        callerUid,
        projectId,
        mocId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
