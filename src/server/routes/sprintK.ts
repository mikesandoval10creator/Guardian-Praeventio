// Praeventio Guard â€” Sprint K endpoints bridge.
//
// Endpoints HTTP que exponen los servicios Sprint L/K al frontend.
// PatrÃ³n consistente con insights.ts: verifyAuth + projectMember +
// adapter por demand.
//
//   GET  /api/sprint-k/:projectId/vulnerability/latest
//   GET  /api/sprint-k/:projectId/sif/pending-review
//   POST /api/sprint-k/:projectId/sif/:id/executive-review
//   GET  /api/sprint-k/:projectId/positive-observations/worker/:workerUid
//   POST /api/sprint-k/:projectId/positive-observations
//   GET  /api/sprint-k/:projectId/waste/inventory
//   GET  /api/sprint-k/:projectId/visitors/active
//
// Cada handler reusa los adapters ya construidos.

import { createHash } from 'node:crypto';
import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { VulnerabilityAdapter } from '../../services/vulnerability/vulnerabilityFirestoreAdapter.js';
import { SIFAdapter } from '../../services/sif/sifFirestoreAdapter.js';
import { WasteAdapter } from '../../services/environmental/wasteFirestoreAdapter.js';
import { VisitorAdapter } from '../../services/visitors/visitorFirestoreAdapter.js';
import { LessonsAdapter } from '../../services/lessonsLearned/lessonsFirestoreAdapter.js';
import { CorrectiveActionsAdapter } from '../../services/correctiveActions/correctiveActionsFirestoreAdapter.js';
import { LotoAdapter } from '../../services/loto/lotoFirestoreAdapter.js';
import { EquipmentAdapter } from '../../services/equipment/equipmentFirestoreAdapter.js';
// workPermits engine + adapter ya no se usan aquí — F.15 vive en
// src/server/routes/workPermits.ts (2026-05-18).
import {
  rankSuppliersByScore,
  scoreSupplier,
  type SupplierKpis,
  type SupplierRecord,
  type ScoredSupplier,
} from '../../services/suppliers/supplierScoring.js';
// residualRiskEngine ya no se usa en el monolito — los endpoints viven
// en src/server/routes/residualRisk.ts (2026-05-18).
import {
  buildDataConfidenceReport,
  type ConfidenceInputs,
  type DataConfidenceReport,
} from '../../services/dataConfidence/dataConfidencePanel.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';

const router = Router();

/**
 * Codex P2 PR #317: utilidad compartida para coercer scores que vienen
 * de Firestore a un entero 0-100. Cualquier valor fuera de rango se
 * "clampa" — el motor F.2 garantiza esto pero datos legacy pueden
 * haberse guardado con floats o valores >100 (ej. proyectos migrados
 * desde la métrica antigua).
 */
function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const claims = (await admin.auth().getUser(callerUid)).customClaims ?? {};
  if (typeof claims.tenantId === 'string' && claims.tenantId.length > 0) {
    return claims.tenantId;
  }
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
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Vulnerability map
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/vulnerability/latest', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new VulnerabilityAdapter(admin.firestore() as any, g.tenantId, projectId);
    const latest = await adapter.getLatest();
    return res.json({ snapshot: latest });
  } catch (err) {
    logger.error?.('sprintK.vulnerability.latest.error', err);
    captureRouteError(err, 'sprintK.vulnerability.latest');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SIF precursors
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/sif/pending-review', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new SIFAdapter(admin.firestore() as any, g.tenantId, projectId);
    const pending = await adapter.listPendingExecutiveReview();
    return res.json({ precursors: pending });
  } catch (err) {
    logger.error?.('sprintK.sif.pending.error', err);
    captureRouteError(err, 'sprintK.sif.pending');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const sifReviewSchema = z.object({
  reviewedByUid: z.string().min(1),
  reviewedAt: z.string().min(10),
  reviewNotes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/sif/:id/executive-review',
  verifyAuth,
  validate(sifReviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof sifReviewSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new SIFAdapter(admin.firestore() as any, g.tenantId, projectId);
      await adapter.recordExecutiveReview(
        id,
        body.reviewedByUid,
        body.reviewedAt,
        body.reviewNotes,
      );
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.sif.review.error', err);
      captureRouteError(err, 'sprintK.sif.review');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// §214-215 Positive Observations migrado a src/server/routes/positiveObservations.ts (2026-05-18).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Waste inventory
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/waste/inventory', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new WasteAdapter(admin.firestore() as any, g.tenantId, projectId);
    const [stock, pendingManifests, permits] = await Promise.all([
      adapter.listInStock(),
      adapter.listManifestsPendingReception(),
      adapter.listPermits(),
    ]);
    return res.json({ wastes: stock, pendingManifests, permits });
  } catch (err) {
    logger.error?.('sprintK.waste.error', err);
    captureRouteError(err, 'sprintK.waste');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Visitors
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/visitors/active', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new VisitorAdapter(admin.firestore() as any, g.tenantId, projectId);
    const list = await adapter.listActive();
    return res.json({ visitors: list });
  } catch (err) {
    logger.error?.('sprintK.visitors.error', err);
    captureRouteError(err, 'sprintK.visitors');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// F.12 Lessons Learned migrado a src/server/routes/lessonsLearned.ts (2026-05-18).
// Las rutas /:projectId/lessons (GET + POST) viven ahora en su propio router
// dedicado; se monta antes que este monolito en server.ts.

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Corrective actions
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/corrective-actions', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new CorrectiveActionsAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    // Codex P2 round 3 (PR #309): accept the full F.4 status set so
    // the page's "En curso" and "Reabiertas" filters can actually
    // fetch records. The adapter signature was widened in tandem.
    const status =
      typeof req.query.status === 'string' ? req.query.status : 'open';
    type AnyStatus =
      | 'open'
      | 'in_progress'
      | 'closed'
      | 'verified'
      | 'reopened';
    const ALL_STATUSES: ReadonlySet<AnyStatus> = new Set([
      'open',
      'in_progress',
      'closed',
      'verified',
      'reopened',
    ]);
    const validStatus: AnyStatus = ALL_STATUSES.has(status as AnyStatus)
      ? (status as AnyStatus)
      : 'open';
    const [byStatus, systemic] = await Promise.all([
      adapter.listByStatus(validStatus),
      adapter.listSystemic(),
    ]);
    return res.json({ actions: byStatus, systemic });
  } catch (err) {
    logger.error?.('sprintK.correctiveActions.list.error', err);
    captureRouteError(err, 'sprintK.correctiveActions.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Codex P2 round 4 (PR #309): persist scheduled effectiveness review.
// Otherwise the F.4 "Programar review" CTA has no observable effect:
// page only logged, panel doesn't mutate, F.11 cron sees nothing.
const scheduleReviewSchema = z.object({
  actionId: z.string().min(1),
  reviewAt: z.string().min(10),
});

router.post(
  '/:projectId/corrective-actions/:actionId/effectiveness-review',
  verifyAuth,
  validate(scheduleReviewSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, actionId } = req.params;
    const body = req.body as z.infer<typeof scheduleReviewSchema>;
    if (body.actionId !== actionId) {
      return res.status(400).json({ error: 'actionId_mismatch' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new CorrectiveActionsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      // The legacy adapter doesn't have a `setEffectivenessReviewAt`
      // method — write directly. Path matches the adapter's PATH().
      await admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/corrective_actions`,
        )
        .doc(actionId)
        .set(
          {
            effectivenessReviewAt: body.reviewAt,
            effectivenessReviewScheduledBy: callerUid,
            effectivenessReviewScheduledAt: new Date().toISOString(),
          },
          { merge: true },
        );
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.correctiveActions.scheduleReview.error', err);
      captureRouteError(err, 'sprintK.correctiveActions.scheduleReview');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const correctiveActionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(3).max(4000),
  level: z
    .enum([
      'elimination',
      'engineering',
      'administrative',
      'training',
      'epp',
      'supervision',
      'communication',
    ])
    .optional(),
  status: z.enum(['open', 'closed', 'verified']),
  isSystemic: z.boolean(),
  sourceCause: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/corrective-actions',
  verifyAuth,
  validate(correctiveActionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof correctiveActionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new CorrectiveActionsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      await adapter.save(body);
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('sprintK.correctiveActions.create.error', err);
      captureRouteError(err, 'sprintK.correctiveActions.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LOTO digital
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/loto', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new LotoAdapter(admin.firestore() as any, g.tenantId, projectId);
    const equipmentId =
      typeof req.query.equipmentId === 'string' ? req.query.equipmentId : null;
    const applications = equipmentId
      ? await adapter.listForEquipment(equipmentId)
      : await adapter.listActive();
    return res.json({ applications });
  } catch (err) {
    logger.error?.('sprintK.loto.list.error', err);
    captureRouteError(err, 'sprintK.loto.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Equipment
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/equipment', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new EquipmentAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    const status =
      typeof req.query.status === 'string' ? req.query.status : 'operativo';
    const equipment = await adapter.listByStatus(status as any);
    return res.json({ equipment });
  } catch (err) {
    logger.error?.('sprintK.equipment.list.error', err);
    captureRouteError(err, 'sprintK.equipment.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Data Quality (Fase F.9) — pre-IA gap detector
// ─────────────────────────────────────────────────────────────────────
//
// Lee colecciones canónicas del proyecto (workers, projects, EPP
// assignments, documents, incidents, machines, trainings) y corre el
// scanner determinístico `scanAll()`. Devuelve un `DataQualityReport`
// con score 0-100 + breakdown por dominio + top gaps para el panel
// `<DataQualityCard>`.
//
// El scanner no requiere proyecto context — es puramente data-driven.
// Pero scopeamos los reads por projectId para que cada faena vea solo
// sus propios gaps.

router.get('/:projectId/data-quality', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { scanAll, pickTopGaps } = await import(
      '../../services/dataQuality/incompletenessScanner.js'
    );

    const db = admin.firestore();

    // Best-effort parallel reads. Each query wrapped so one failure
    // doesn't blank the whole report — the user sees partial data
    // and can still drill into the populated domains.
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.dataQuality.read.${label}.failed`, err);
        return [];
      }
    };

    // Codex P2 (PR #309): collection paths matched the UI writes.
    //
    // - workers       → nested `projects/{projectId}/workers`
    //                   (LaborManagementModal.tsx line 42)
    // - documents     → top-level `project_documents` filtered by projectId
    //                   (ProjectDocuments.tsx line 103)
    // - assets        → top-level `assets` filtered by projectId
    //                   (MaquinariaManager.tsx line 70)
    // - training      → top-level `training` filtered by projectId
    //                   (Training.tsx line 141)
    // - incidents     → top-level `incidents` filtered by projectId (idem)
    // - epp_assignments → nested fallback (no top-level writer found)
    //
    // Earlier this endpoint scanned everything under
    // `projects/{projectId}/...` which always returned empty arrays for
    // the three top-level collections — the data-quality card reported
    // a clean 100 even when the project had hundreds of documents/assets
    // with real gaps.
    const projectRef = db.collection('projects').doc(projectId);
    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const [
      workers,
      epps,
      documents,
      incidents,
      machines,
      trainings,
      thisProject,
    ] = await Promise.all([
      safeRead('workers', async () =>
        (await projectRef.collection('workers').get()).docs.map(
          (d) => ({ id: d.id, ...d.data() }),
        ),
      ),
      safeRead('epps', async () =>
        (await projectRef.collection('epp_assignments').get()).docs.map(
          (d) => ({ id: d.id, ...d.data() }),
        ),
      ),
      safeRead('documents', async () =>
        (await byProject('project_documents').get()).docs.map(
          (d) => ({ id: d.id, ...d.data() }),
        ),
      ),
      safeRead('incidents', async () => {
        // Codex P2 round 3 (PR #309): scanIncidents looks for
        // `description` and `rootCauseCategory`, but the existing
        // close flow (backgroundTriggers.ts:385) writes `rootCause`
        // as a STRING, and the bundle endpoint also reads `summary`
        // as a narrative alias. Normalize both at the boundary so
        // the scanner doesn't falsely flag missing fields when the
        // narrative/RCA actually exists.
        const snap = await byProject('incidents').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ...data,
            description: data.description ?? data.summary,
            // Accept any of: explicit category, string rootCause, or
            // object-shape rootCause.primaryCauseKind. Casts via
            // unknown because Firestore data is untyped.
            rootCauseCategory:
              data.rootCauseCategory ??
              (typeof data.rootCause === 'string'
                ? data.rootCause
                : (data.rootCause as { primaryCauseKind?: string } | undefined)?.primaryCauseKind),
          };
        });
      }),
      safeRead('machines', async () => {
        // Codex P2 round 2 (PR #309): MaquinariaManager.tsx writes
        // assets with `name` + `nextMaintenance`. The scanner
        // (`scanMachines`) checks `code` + `nextMaintenanceAt`. Without
        // normalization every asset shows as missing both fields and
        // the score collapses falsely. Map at the edge.
        const snap = await byProject('assets').get();
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ...data,
            code: data.code ?? data.name,
            nextMaintenanceAt: data.nextMaintenanceAt ?? data.nextMaintenance,
          };
        });
      }),
      safeRead('trainings', async () => {
        // Codex P2 round 2 + 4 (PR #309): trainings live in THREE
        // sources:
        //   1. Top-level `training` collection (Training.tsx)
        //   2. Nested `projects/{id}/trainings` (TrainingRecommendations.tsx)
        //   3. Nested `projects/{id}/training_assignments` (the live
        //      collection that `runConsistencyAudit.ts` treats as active
        //      training data)
        // Union all three so the F.9 scanner sees every record. De-dupe
        // by id with first-wins precedence (top-level → nested →
        // assignments) since the same training can be referenced from
        // multiple paths.
        const [topSnap, nestedSnap, assignSnap] = await Promise.all([
          byProject('training').get(),
          projectRef.collection('trainings').get(),
          projectRef.collection('training_assignments').get(),
        ]);
        const map = new Map<string, Record<string, unknown>>();
        for (const d of topSnap.docs) {
          map.set(d.id, { id: d.id, ...d.data() });
        }
        for (const d of nestedSnap.docs) {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }
        for (const d of assignSnap.docs) {
          if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() });
        }
        return Array.from(map.values());
      }),
      safeRead('project', async () => {
        const snap = await projectRef.get();
        return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
      }),
    ]);

    const report = scanAll({
      workers: workers as any,
      projects: thisProject as any,
      eppAssignments: epps as any,
      documents: documents as any,
      incidents: incidents as any,
      machines: machines as any,
      trainings: trainings as any,
    });

    const topGaps = pickTopGaps(report, 10);

    return res.json({ report, topGaps });
  } catch (err) {
    logger.error?.('sprintK.dataQuality.error', err);
    captureRouteError(err, 'sprintK.dataQuality');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Incident evidence bundle (Fase F.3)
// ─────────────────────────────────────────────────────────────────────
//
// Construye el "expediente automático" de un incidente: cruza
// incidents, audit_logs y los registros vinculados para producir un
// `IncidentBundleManifest` con score de completitud + gaps detectados.
// El caller (fiscalizador, abogado, SUSESO) ve de un vistazo qué falta
// para cerrar el caso.
//
// Este endpoint deja explícito el contrato — los feeds más caros
// (evidencia foto/video, EPP/training del trabajador afectado,
// custody chain) viajan en sub-PRs siguientes. La versión actual
// popula incident + audit_log y deja arrays vacíos honestos para los
// demás, que el scorer entonces clasifica como gaps. Eso es
// honestidad arquitectónica: el panel muestra el bundle real con sus
// huecos reales, no un 100% falso.

router.get(
  '/:projectId/incidents/:incidentId/bundle',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, incidentId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { buildIncidentBundle, normalizeSeverity } = await import(
        '../../services/incidentBundle/incidentEvidenceBundle.js'
      );

      const db = admin.firestore();

      // 1. Incident itself. Stored top-level by IncidentReport.tsx,
      //    filtered by projectId.
      const incidentDoc = await db
        .collection('incidents')
        .doc(incidentId)
        .get();
      if (!incidentDoc.exists) {
        return res.status(404).json({ error: 'incident_not_found' });
      }
      const incidentData = incidentDoc.data() ?? {};
      // Cross-tenant safety: the docId is global; assert the incident
      // belongs to the project the caller can read.
      //
      // Codex P2 round 2 (PR #309): a legacy / partially-imported
      // incident may not carry a `projectId` field. The earlier check
      // `if (incidentData.projectId && ...)` short-circuited on the
      // missing field and let the caller see ANY tenant's incident
      // bundle. Tighten: require the field AND match it. Records
      // without projectId can't be authorized through this route.
      if (
        typeof incidentData.projectId !== 'string' ||
        incidentData.projectId !== projectId
      ) {
        return res.status(403).json({ error: 'cross_project_forbidden' });
      }

      // Codex P2 round 3 (PR #309): the legal evidence bundle must
      // never fabricate timestamps. Previously we fell back to
      // `new Date().toISOString()` when both `occurredAt` and
      // `createdAt` were missing — that silently invented a
      // "ocurred at right now" claim for a legacy incident, which
      // would be perjury in a SUSESO submission. Reject explicitly
      // and let the caller fix the upstream record.
      const occurredAt =
        typeof incidentData.occurredAt === 'string'
          ? incidentData.occurredAt
          : typeof incidentData.createdAt === 'string'
            ? incidentData.createdAt
            : null;
      if (!occurredAt) {
        return res.status(422).json({
          error: 'incident_missing_timestamp',
          detail:
            'El incidente no tiene `occurredAt` ni `createdAt`. Corregir el registro origen antes de construir el expediente.',
        });
      }
      const reportedAt =
        typeof incidentData.reportedAt === 'string'
          ? incidentData.reportedAt
          : occurredAt;

      const severity =
        normalizeSeverity(String(incidentData.severity ?? 'medium')) ?? 'medium';

      // 2. Audit log entries scoped to this incident AND project.
      //
      // Codex P2 round 3 (PR #309): audit_logs is a global collection;
      // filtering only by `details.incidentId` would surface rows from
      // OTHER tenants/projects that happen to reference the same
      // incidentId (collision possible since incidentId is per-tenant
      // not globally unique in the legacy schema). Scope to projectId
      // too. The audit-log writer (audit.ts route) stamps `projectId`
      // at the top level when known.
      const auditSnap = await db
        .collection('audit_logs')
        .where('details.incidentId', '==', incidentId)
        .where('projectId', '==', projectId)
        .limit(200)
        .get()
        .catch((err) => {
          logger.warn?.('sprintK.bundle.audit.fetch_failed', err);
          return null;
        });
      const auditLog =
        auditSnap?.docs.map((d) => {
          const data = d.data();
          const ts =
            data.timestamp?.toDate?.()?.toISOString() ??
            (typeof data.timestamp === 'string'
              ? data.timestamp
              : new Date().toISOString());
          return {
            at: ts,
            actorUid: String(data.userId ?? 'unknown'),
            actorRole: String(data.actorRole ?? 'unknown'),
            action: String(data.action ?? 'unknown'),
            context: typeof data.details === 'object' ? data.details : undefined,
          };
        }) ?? [];

      const manifest = buildIncidentBundle({
        incident: {
          id: incidentDoc.id,
          projectId,
          occurredAt,
          severity,
          summary: String(
            incidentData.summary ?? incidentData.description ?? incidentDoc.id,
          ),
          location: incidentData.location ?? undefined,
          reportedByUid: String(
            incidentData.reportedByUid ?? incidentData.userId ?? 'unknown',
          ),
          reportedAt,
        },
        // Empty arrays — these are the OUTSTANDING data sources to be
        // wired in sub-PRs. The bundle's gap detector reports them as
        // missing, which is the honest signal we want surfacing.
        affectedWorkers: [],
        evidence: [],
        appliedControls: [],
        requiredEpp: [],
        requiredTrainings: [],
        normativeRefs: [],
        // Codex P2 round 2 + 3 (PR #309): if the incident doc already
        // carries a `rootCause` payload, preserve it so the bundle
        // scorer doesn't emit a false `no_root_cause_assigned` gap
        // and tank completeness.
        //
        // The field can be either:
        // - STRING (set by backgroundTriggers.ts:385 on close flow)
        // - OBJECT (set by F.4 rootCauseClassifier)
        //
        // Map both shapes into the builder input. Strings become a
        // minimal { analyzed: true, primaryCauseKind: stringValue }
        // so the gap detector recognizes the analysis happened.
        rootCause: ((): typeof undefined | {
          analyzed: boolean;
          primaryCauseKind?: string;
          contributingFactors?: string[];
          pendingOwnerUid?: string;
          pendingDueDate?: string;
        } => {
          const rc = incidentData.rootCause;
          if (typeof rc === 'string' && rc.trim().length > 0) {
            return { analyzed: true, primaryCauseKind: rc };
          }
          if (typeof rc === 'object' && rc !== null) {
            const obj = rc as Record<string, unknown>;
            return {
              analyzed: Boolean(obj.analyzed ?? true),
              primaryCauseKind:
                typeof obj.primaryCauseKind === 'string'
                  ? obj.primaryCauseKind
                  : undefined,
              contributingFactors: Array.isArray(obj.contributingFactors)
                ? (obj.contributingFactors as string[])
                : undefined,
              pendingOwnerUid:
                typeof obj.pendingOwnerUid === 'string'
                  ? obj.pendingOwnerUid
                  : undefined,
              pendingDueDate:
                typeof obj.pendingDueDate === 'string'
                  ? obj.pendingDueDate
                  : undefined,
            };
          }
          return undefined;
        })(),
        auditLog,
      });

      return res.json({ manifest });
    } catch (err) {
      logger.error?.('sprintK.bundle.error', err);
      captureRouteError(err, 'sprintK.bundle');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Inbox del prevencionista (Fase F.8)
// ─────────────────────────────────────────────────────────────────────
//
// Agrega N feeds heterogéneos en una única lista ordenada por urgencia,
// reusando los adapters Sprint K/L ya wireados (corrective actions, SIF,
// equipment) + la collection legacy `audit_logs`/`incidents` para los
// canales que el plan F.8 lista pero aún no tienen su propio adapter
// (documents_pending_approval, repeating_risk_alerts, workers_onboarding).
//
// Output: { items: InboxItem[], summary: InboxSummary } — listo para
// renderizar con <InboxPrevencionistaPanel>.

router.get('/:projectId/inbox', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { aggregateInbox, summarizeInbox } = await import(
      '../../services/inbox/inboxAggregator.js'
    );

    const correctiveAdapter = new CorrectiveActionsAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    const sifAdapter = new SIFAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );

    // Best-effort parallel fetch. Each adapter is wrapped so one failure
    // doesn't blank out the whole inbox — the user still gets the feeds
    // that succeeded.
    //
    // Codex P2 round 4 (PR #309): include `in_progress` and `reopened`
    // statuses too — they're unresolved work that belongs in the
    // prevencionista's queue exactly like `open`. The F.4 status model
    // and the corrective-actions center page already load all 5; the
    // inbox was lagging.
    const [openActions, inProgressActions, reopenedActions, sifPending] = await Promise.all([
      correctiveAdapter.listByStatus('open').catch((err) => {
        logger.warn?.('sprintK.inbox.corrective.open.fetch_failed', err);
        return [] as Awaited<ReturnType<typeof correctiveAdapter.listByStatus>>;
      }),
      correctiveAdapter.listByStatus('in_progress').catch((err) => {
        logger.warn?.('sprintK.inbox.corrective.in_progress.fetch_failed', err);
        return [] as Awaited<ReturnType<typeof correctiveAdapter.listByStatus>>;
      }),
      correctiveAdapter.listByStatus('reopened').catch((err) => {
        logger.warn?.('sprintK.inbox.corrective.reopened.fetch_failed', err);
        return [] as Awaited<ReturnType<typeof correctiveAdapter.listByStatus>>;
      }),
      sifAdapter.listPendingExecutiveReview().catch((err) => {
        logger.warn?.('sprintK.inbox.sif.fetch_failed', err);
        return [] as Awaited<
          ReturnType<typeof sifAdapter.listPendingExecutiveReview>
        >;
      }),
    ]);

    // Codex P2 (PR #309): filter corrective actions by responsibleUid
    // so the prevencionista's inbox shows their OWN pending work, not
    // every action in the project. Extended F.4 records carry
    // `responsibleUid`; legacy weakActionDetector records don't —
    // those collapse into the inbox by default (the safer fallback,
    // since "unassigned" actions need someone to claim them).
    const unresolvedActions = [...openActions, ...inProgressActions, ...reopenedActions];
    const actionsForCaller = unresolvedActions.filter((a) => {
      const extra = a as unknown as { responsibleUid?: string };
      // If the record has an explicit responsibleUid, only include it
      // when it matches the caller. Otherwise include it (legacy data
      // that needs assignment + a prevencionista to triage it).
      if (typeof extra.responsibleUid === 'string' && extra.responsibleUid.length > 0) {
        return extra.responsibleUid === callerUid;
      }
      return true;
    });

    const items = aggregateInbox(
      {
        documentsPending: [],
        incidentsPending: [],
        correctiveActionsOpen: actionsForCaller.map((a) => {
          // Promote legacy weakActionDetector shape to the dueDate/
          // daysOverdue projection the inbox wants. Legacy actions
          // don't carry dueDate; we synthesize a conservative window
          // (created + 30d) so the inbox doesn't classify everything
          // overdue. Records that already have dueDate (F.4 shape)
          // override via the spread inside the helper.
          const extra = a as unknown as { dueDate?: string };
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          const synthDue = new Date(Date.now() + thirtyDaysMs).toISOString();
          return {
            id: a.id,
            label: a.description.slice(0, 80),
            dueDate: extra.dueDate ?? synthDue,
          };
        }),
        eppPendingValidation: [],
        workersPendingOnboarding: [],
        repeatingRiskAlerts: [],
        dataQualityGaps: [],
        sifPrecursorsPending: sifPending.map((p) => ({
          id: p.id,
          kind: p.kind,
          // SIFPrecursor carries `rationale: string[]` (the justification
          // chain of triggers). Join into a short summary for the inbox
          // card — the user clicks "Revisión ejecutiva" to see the full
          // detail anyway.
          summary: Array.isArray(p.rationale) ? p.rationale.join(' · ') : '',
          createdAt: p.occurredAt,
        })),
        legalObligationsDueSoon: [],
        exceptionsExpiringSoon: [],
        responsibleUid: callerUid,
      },
      // Sprint 40 Codex pre-empt: the aggregator throws on `now`-less
      // calls in dev only. Server-side we always pass `new Date()` so
      // the urgency calc is deterministic relative to wall-clock.
      { now: new Date() },
    );

    const summary = summarizeInbox(items, new Date().toISOString());

    return res.json({ items, summary });
  } catch (err) {
    logger.error?.('sprintK.inbox.error', err);
    captureRouteError(err, 'sprintK.inbox');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fase F.5 — Firma de Recepción Digital con QR
// ─────────────────────────────────────────────────────────────────────
//
// Cierra el wire end-to-end del flujo F.5:
//   1) POST /qr-signature/challenge — supervisor genera challenge HMAC
//      (server firma con QR_SIG_SECRET). El payload incluye TTL corto
//      (5 min default, cap 30 min) y un nonce 16-byte para anti-replay.
//      El challenge se PERSISTE en
//      `tenants/{tid}/projects/{pid}/qr_signature_challenges/{challengeId}`
//      para que /acknowledge pueda re-leerlo y verificar el HMAC
//      server-side (NUNCA confiamos en el client para re-enviar el
//      challenge firmado; eso permitiría adivinar `challengeId` y forjar
//      firmas).
//   2) POST /qr-signature/acknowledge — al finalizar el escaneo + firma
//      biométrica del trabajador, persistimos la confirmación en
//      `tenants/{tid}/projects/{pid}/qr_acknowledgements/{challengeId}`.
//      La escritura es ATÓMICA via Firestore transaction:
//         a) lee el challenge → 401 si no existe
//         b) verifica HMAC + TTL via verifyChallenge() (timing-safe)
//         c) si ya existe ack en la misma transacción → return existing
//            (idempotente); si no, crea con create() para que dos
//            scans simultáneos no se pisen.
//      El doc ack DENORMALIZA `itemId`, `kind`, `supervisorUid` y
//      `signatureHex` del challenge — el challenge puede rotarse o
//      caducar, pero la auditoría queda autocontenida en el ack.
//
// Directiva del usuario (product_signing_no_blocking_directives_2026-05-06):
// el documento queda con la empresa firmado, NO empujamos a
// SUSESO/MINSAL/SII. Generamos el comprobante; la entrega al organismo
// la hace la empresa.

const qrSignatureKindEnum = z.enum([
  'epp_delivery',
  'safety_talk',
  'document_read',
  'training_completion',
  'permit_acknowledgement',
  'inspection_handover',
]);

// Codex P2 (PR #313, line 1108): /qr-signature/challenge solo puede ser
// invocado por roles que crean firmas de recepción — supervisor de
// faena, prevencionista (HSE pro) o admin del tenant. Workers no pueden
// emitir challenges por su cuenta (de hacerlo se autoasignarían
// entregas de EPP sin supervisor presente). Mantiene la directiva
// "supervisor es quien firma + cita la entrega".
const QR_SIG_CHALLENGE_ROLES = new Set([
  'supervisor',
  'prevencionista',
  'admin',
]);

function callerHasSupervisorRole(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && QR_SIG_CHALLENGE_ROLES.has(u.role)) {
    return true;
  }
  // Tenant-scoped role claim: tenants[tenantId].role — algunas org
  // estructuras emiten el role a nivel tenant. Soportamos ambas formas.
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (tenants && typeof tenants === 'object' && typeof u.tenantId === 'string') {
    const t = tenants[u.tenantId];
    if (t && typeof t.role === 'string' && QR_SIG_CHALLENGE_ROLES.has(t.role)) {
      return true;
    }
  }
  return false;
}

router.post(
  '/:projectId/qr-signature/challenge',
  verifyAuth,
  validate(
    z.object({
      itemId: z.string().min(1),
      kind: qrSignatureKindEnum,
      ttlMinutes: z.number().int().min(1).max(30).optional(),
    }),
  ),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as {
      itemId: string;
      kind: z.infer<typeof qrSignatureKindEnum>;
      ttlMinutes?: number;
    };
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 (PR #313, line 1108): role gate antes de mintear el
    // challenge HMAC. assertProjectMember ya verificó pertenencia al
    // proyecto; aquí filtramos el role específico.
    if (!callerHasSupervisorRole(req)) {
      return res
        .status(403)
        .json({ error: 'forbidden_role', allowed: Array.from(QR_SIG_CHALLENGE_ROLES) });
    }
    try {
      const { buildChallenge } = await import(
        '../../services/qrSignature/qrSignatureService.js'
      );
      const nodeCrypto = await import('node:crypto');
      const secret = process.env.QR_SIG_SECRET ?? '';
      if (secret.length < 16) {
        return res
          .status(500)
          .json({ error: 'qr_signature_secret_not_configured' });
      }
      const challenge = buildChallenge(
        {
          challengeId: nodeCrypto.randomUUID(),
          itemId: body.itemId,
          kind: body.kind,
          projectId,
          initiatedByUid: callerUid,
          nonceHex: nodeCrypto.randomBytes(16).toString('hex'),
          ttlMinutes: body.ttlMinutes,
        },
        secret,
      );
      // Codex P1 (PR #313, line 1166): PERSIST el challenge — sin esto
      // /acknowledge no puede verificar el HMAC server-side y cualquiera
      // con un challengeId adivinado forjaría firmas válidas.
      const db = admin.firestore();
      const challengePath = `tenants/${g.tenantId}/projects/${projectId}/qr_signature_challenges`;
      await db
        .collection(challengePath)
        .doc(challenge.challengeId)
        .set({
          ...challenge,
          // Audit fields — quién lo emitió + cuándo.
          createdAt: new Date().toISOString(),
          createdByCallerUid: callerUid,
        });
      return res.status(201).json({ challenge });
    } catch (err) {
      logger.error?.('sprintK.qrSignature.challenge.error', err);
      captureRouteError(err, 'sprintK.qrSignature.challenge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/qr-signature/acknowledge',
  verifyAuth,
  validate(
    z.object({
      challengeId: z.string().min(1),
      workerUid: z.string().min(1),
      biometricUsed: z.boolean().optional(),
      signedAt: z.string().min(10),
    }),
  ),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as {
      challengeId: string;
      workerUid: string;
      biometricUsed?: boolean;
      signedAt: string;
    };
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { verifyChallenge } = await import(
        '../../services/qrSignature/qrSignatureService.js'
      );
      const secret = process.env.QR_SIG_SECRET ?? '';
      if (secret.length < 16) {
        return res
          .status(500)
          .json({ error: 'qr_signature_secret_not_configured' });
      }
      const db = admin.firestore();
      const challengeRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/qr_signature_challenges`)
        .doc(body.challengeId);
      const ackRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/qr_acknowledgements`)
        .doc(body.challengeId);

      // Codex P1 (PR #313, line 1166) + P2 #4 (line 1182):
      // Toda la verificación + escritura va en UNA transacción. Esto:
      //  1) Cierra la race condition entre check-existe → write (dos
      //     scans concurrentes ya no pueden ambos pasar el check y
      //     escribir; Firestore aborta la 2da txn).
      //  2) Asegura que el challenge existe + verifica HMAC ANTES de
      //     emitir el ack.
      // verifyChallenge() re-computa el HMAC con QR_SIG_SECRET y
      // compara constant-time (constantTimeEqual interno). Si el
      // challenge fue tampered / expiró / no existe → 401.
      const txnResult = await db.runTransaction(async (txn) => {
        const challengeSnap = await txn.get(challengeRef);
        if (!challengeSnap.exists) {
          return { kind: 'unauthorized' as const, reason: 'challenge_not_found' };
        }
        const challengeData = challengeSnap.data() as
          | import('../../services/qrSignature/qrSignatureService.js').QrSignatureChallenge
          | undefined;
        if (!challengeData) {
          return { kind: 'unauthorized' as const, reason: 'challenge_malformed' };
        }
        // Project mismatch (defense-in-depth: route param vs stored payload).
        if (challengeData.projectId !== projectId) {
          return { kind: 'unauthorized' as const, reason: 'challenge_project_mismatch' };
        }
        // Verify HMAC + TTL (timing-safe internal).
        const verification = verifyChallenge({
          challenge: challengeData,
          serverSecret: secret,
        });
        if (!verification.valid) {
          return {
            kind: 'unauthorized' as const,
            reason: `challenge_${verification.reason ?? 'invalid'}`,
          };
        }
        // Idempotency: if ack already exists, return it (don't overwrite).
        const ackSnap = await txn.get(ackRef);
        if (ackSnap.exists) {
          return {
            kind: 'idempotent' as const,
            acknowledgement: ackSnap.data(),
          };
        }
        // Codex P2 #3 (PR #313, line 1176): denormalize challenge fields
        // (itemId, kind, signatureHex, supervisorUid) into the ack
        // document so audit/forensic exports remain self-contained even
        // if the challenge doc is rotated/deleted.
        const acknowledgement = {
          challengeId: body.challengeId,
          itemId: challengeData.itemId,
          kind: challengeData.kind,
          supervisorUid: challengeData.initiatedByUid,
          challengeSignatureHex: challengeData.signatureHex,
          challengeExpiresAt: challengeData.expiresAt,
          workerUid: body.workerUid,
          acknowledgedByCallerUid: callerUid,
          biometricUsed: Boolean(body.biometricUsed),
          signedAt: body.signedAt,
          recordedAt: new Date().toISOString(),
        };
        // create() throws if doc exists — txn already guarded that, but
        // belt-and-suspenders: any race outside txn (somehow) aborts.
        txn.create(ackRef, acknowledgement);
        return { kind: 'created' as const, acknowledgement };
      });

      if (txnResult.kind === 'unauthorized') {
        return res
          .status(401)
          .json({ error: 'invalid_challenge', reason: txnResult.reason });
      }
      if (txnResult.kind === 'idempotent') {
        return res.status(200).json({ acknowledgement: txnResult.acknowledgement });
      }
      return res.status(201).json({ acknowledgement: txnResult.acknowledgement });
    } catch (err) {
      logger.error?.('sprintK.qrSignature.acknowledge.error', err);
      captureRouteError(err, 'sprintK.qrSignature.acknowledge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// F.26 Maturity Index migrado a src/server/routes/maturity.ts (2026-05-18).

// F.15 Work Permits (GET) migrado a src/server/routes/workPermits.ts (2026-05-18).

// F.21 Pre-Shift Risk Panel migrado a src/server/routes/preShiftRisk.ts (2026-05-18).


// F.13 Radar de Riesgos Repetidos migrado a src/server/routes/riskRadar.ts
// (2026-05-18). El router dedicado se monta antes que este monolito.

// F.15 Work Permits (POST + sign + close) migrado a src/server/routes/workPermits.ts (2026-05-18).

// F.20 Drills Manager migrado a src/server/routes/drillsManager.ts (2026-05-18).

// ─────────────────────────────────────────────────────────────────────
// Fase F.7 — Minuta automática Comité Paritario (CPHS)
// ─────────────────────────────────────────────────────────────────────
//
// Construye el "borrador estructurado mensual" que el CPHS revisa antes
// de firmar el acta definitiva. Cruza incidentes del período, acciones
// correctivas (F.4), capacitaciones impartidas, inspecciones realizadas
// y score semáforo (F.2) en un MarkDown determinístico vía
// `buildMonthlyMinuteDraft` (sin LLM — la pasada Gemini opcional para
// pulir redacción queda fuera de scope F.7).
//
// El servicio es puro y testable; el endpoint solo orquesta las
// lecturas Firestore + mapea al shape `MonthlyInputs` que el motor
// espera. Si cualquiera de los feeds falla por permisos / colección
// inexistente, el endpoint sigue produciendo el borrador con datos
// parciales — el campo `completenessScore` del draft alerta al
// prevencionista de qué falta antes de aprobar.

router.get('/:projectId/cphs/draft-minute', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { buildMonthlyMinuteDraft } = await import(
      '../../services/cphs/cphsMinuteAutogenerator.js'
    );

    const db = admin.firestore();

    // Período: último mes calendario completo (UTC). El CPHS sesiona
    // sobre el mes anterior; usar UTC evita off-by-one por zona horaria
    // del servidor cuando estamos cerca del cambio de mes.
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    // "YYYY-MM" del mes que cubre el borrador (mes anterior al actual).
    const periodLabel = `${monthStart.getUTCFullYear()}-${String(
      monthStart.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    // Best-effort wrapper — cada feed envuelto para que un fallo de
    // permisos o colección ausente no blanquee el borrador completo.
    // El draft producido refleja honestamente los datos disponibles.
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.cphs.${label}.fetch_failed`, err);
        return [];
      }
    };

    // Resolve project metadata for the minute header (companyName).
    // The Project doc lives top-level under `projects/{id}` — same
    // path used by ProjectContext + every other Sprint K endpoint.
    let companyName = 'Empresa';
    let expectedAttendees: string[] = [];

    // Codex P2 PR #317 round 2: source-of-truth para asistentes es
    // `cphs_committees` (escrito por `services/cphs/cphsService.ts`
    // cuando el prevencionista constituye el comité). El project doc
    // sólo guarda overrides ad-hoc (proyectos sin módulo CPHS formal).
    // Estrategia: primero pedimos el comité ACTIVO del proyecto y
    // mapeamos `members[].fullName`; si no existe, caemos al lookup
    // legacy en el doc del proyecto (cphsAttendees / cphsMembers).
    try {
      const committeesSnap = await db
        .collection('cphs_committees')
        .where('projectId', '==', projectId)
        .where('status', '==', 'active')
        .limit(5)
        .get();
      if (!committeesSnap.empty) {
        // Concat members[].fullName from every active committee del proyecto.
        // Normal es 1, pero defensivo por si quedan duplicados de migraciones.
        const seen = new Set<string>();
        const collected: string[] = [];
        for (const doc of committeesSnap.docs) {
          const data = doc.data() as { members?: unknown };
          if (!Array.isArray(data.members)) continue;
          for (const m of data.members) {
            if (!m || typeof m !== 'object') continue;
            const full = (m as { fullName?: unknown }).fullName;
            if (typeof full === 'string' && full.length > 0 && !seen.has(full)) {
              seen.add(full);
              collected.push(full);
            }
          }
        }
        if (collected.length > 0) {
          expectedAttendees = collected;
        }
      }
    } catch (err) {
      logger.warn?.('sprintK.cphs.committees.fetch_failed', err);
      // No-op: caemos al lookup legacy en el doc del proyecto abajo.
    }
    // Codex P2 PR #317: el draft anterior hard-codeaba
    // complianceTrafficLightScore=0 — eso pintaba 🔴 0/100 en todos
    // los borradores y disparaba un "Plan de mejora cumplimiento" falso
    // para proyectos que en realidad estaban verdes. Ahora leemos el
    // campo `complianceScore` que `projects/{id}` ya mantiene
    // (mismo dato consumido por insights.role_view); si no existe
    // (proyecto nuevo / F.2 aún no corrió), pasamos `undefined` al
    // motor y el draft omite la sección con un mensaje explícito
    // ("no disponible") en vez de un cero engañoso.
    let complianceTrafficLightScore: number | undefined;
    try {
      const projDoc = await db.collection('projects').doc(projectId).get();
      const projData = projDoc.exists ? projDoc.data() : null;
      if (projData) {
        if (
          typeof projData.companyName === 'string' &&
          projData.companyName.length > 0
        ) {
          companyName = projData.companyName;
        } else if (
          typeof projData.name === 'string' &&
          projData.name.length > 0
        ) {
          companyName = projData.name;
        }
        // Legacy fallback (Codex P2 PR #317 round 2): SOLO si el
        // lookup anterior a `cphs_committees` no devolvió miembros.
        // Aceptamos shapes ad-hoc del project doc:
        //   - `cphsAttendees: string[]` (display names)
        //   - `cphsMembers:   Array<{ displayName?: string; fullName?: string }>`
        // Si absent, we leave the array empty and the draft's
        // completeness score will flag it.
        if (expectedAttendees.length === 0) {
          if (Array.isArray(projData.cphsAttendees)) {
            expectedAttendees = projData.cphsAttendees.filter(
              (v: unknown): v is string =>
                typeof v === 'string' && v.length > 0,
            );
          } else if (Array.isArray(projData.cphsMembers)) {
            expectedAttendees = projData.cphsMembers
              .map((m: unknown) => {
                if (!m || typeof m !== 'object') return '';
                // Aceptamos `fullName` (shape canónico del módulo CPHS)
                // o `displayName` (legacy del project doc).
                const candidate =
                  (m as { fullName?: unknown }).fullName ??
                  (m as { displayName?: unknown }).displayName;
                return typeof candidate === 'string' ? candidate : '';
              })
              .filter((s: string) => s.length > 0);
          }
        }
        // Best-effort compliance score lookup. Aceptamos formato número
        // (0-100) o objeto cache `{ score, computedAt }`. Cualquier
        // otro shape → undefined (template lo omite).
        const rawScore = projData.complianceScore;
        if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
          complianceTrafficLightScore = clampScore(rawScore);
        } else if (
          rawScore &&
          typeof rawScore === 'object' &&
          typeof (rawScore as { score?: unknown }).score === 'number'
        ) {
          complianceTrafficLightScore = clampScore(
            (rawScore as { score: number }).score,
          );
        }
      }
    } catch (err) {
      logger.warn?.('sprintK.cphs.project.fetch_failed', err);
    }

    // ── Incidents (último mes completo) ──
    // `incidents` es top-level filtrado por `projectId`. Aceptamos
    // tanto `occurredAt` como `createdAt` como timestamp del evento
    // (cohabitación legacy + nuevo writer). Filtramos cliente-side
    // sobre los del proyecto para evitar requerir índice compuesto
    // `(projectId, occurredAt)` que algunos despliegues no tienen.
    //
    // Codex P2 PR #317: el .limit(500) sobre una colección sin orden
    // explícito puede devolver registros document-id-ordered y omitir
    // los recientes (el mes que el CPHS necesita). Pedimos ordenado
    // por `occurredAt desc` para que la "tail" más reciente caiga
    // siempre dentro de los 500 — luego filtramos al mes objetivo.
    //
    // Codex P2 PR #317 round 2:
    //   1. `orderBy('occurredAt')` filtra a documentos que tengan ese
    //      campo, y los incidentes legacy / capturados vía SafetyFeed
    //      sólo tienen `createdAt`. Si el query ordenado vuelve vacío
    //      (caso típico: proyecto con sólo registros createdAt-only),
    //      caemos al query sin orden — el catch original sólo cubría
    //      FAILED_PRECONDITION, no el "0 docs porque el campo no existe".
    //   2. El writer canónico de la app (SafetyFeed + Telemetry) crea
    //      `NodeType.INCIDENT` en la colección `nodes`, no en
    //      `/incidents`. Leemos ambas colecciones y deduplicamos por id
    //      para que el draft refleje todos los incidentes que el resto
    //      del sistema considera reales. La normalización del shape
    //      (severity / description / rootCause) maneja la diferencia
    //      entre `nodes` (severity en metadata.criticidad) e `incidents`
    //      (severity al top-level).
    // Si Firestore lanza FAILED_PRECONDITION (índice (projectId,
    // occurredAt) no creado en este despliegue), caemos al query
    // sin orderBy + filtro client-side. El catch del safeRead no nos
    // sirve para distinguir índice-faltante de error real; lo hacemos
    // inline. TODO: cursor-based pagination para proyectos con >500
    // incidentes/mes (extremadamente raro en práctica — el promedio
    // está bajo 20).
    const incidents = await safeRead<Record<string, unknown>>(
      'incidents',
      async () => {
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();

        // (a) Read /incidents (legacy / API writer).
        const baseIncidentsQuery = db
          .collection('incidents')
          .where('projectId', '==', projectId);
        let incidentsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          const orderedSnap = await baseIncidentsQuery
            .orderBy('occurredAt', 'desc')
            .limit(500)
            .get();
          // Si el ordered devuelve vacío puede ser porque la colección
          // legacy guarda sólo `createdAt`. Sin un segundo query no
          // distinguimos "0 incidentes reales" de "0 con campo
          // occurredAt"; el costo de un read extra a una collection
          // ya consultada es despreciable y nos asegura no perder
          // documentos createdAt-only.
          if (orderedSnap.empty) {
            incidentsSnap = await baseIncidentsQuery.limit(500).get();
          } else {
            incidentsSnap = orderedSnap;
          }
        } catch (orderErr) {
          // Índice compuesto faltante: degradamos a query sin orderBy
          // (mismo comportamiento que tenía esta ruta antes del fix).
          // El draft saldrá igual cuando el proyecto tiene <500
          // incidentes totales — que es el caso normal.
          logger.warn?.(
            'sprintK.cphs.incidents.orderBy_failed_fallback_unordered',
            orderErr,
          );
          incidentsSnap = await baseIncidentsQuery.limit(500).get();
        }

        // (b) Read /nodes filtered to NodeType.INCIDENT — fuente real
        //     del SafetyFeed/Telemetry/CPHS alert trigger. El enum
        //     `NodeType.INCIDENT` se persiste literal como 'Incidente'
        //     en `nodes[].type` (ver src/types/index.ts).
        let nodeIncidentsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          nodeIncidentsSnap = await db
            .collection('nodes')
            .where('projectId', '==', projectId)
            .where('type', '==', 'Incidente')
            .limit(500)
            .get();
        } catch (nodesErr) {
          logger.warn?.(
            'sprintK.cphs.incidents.nodes_query_failed',
            nodesErr,
          );
          nodeIncidentsSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        // Normalize node-shape to incident-shape: la severidad vive
        // en `metadata.criticidad` ('Baja'|'Media'|'Alta'|'Crítica');
        // la fecha del evento es `createdAt` (string ISO) — el nodo
        // no expone `occurredAt`. Esto pasa por `normSeverity` abajo
        // que ya tolera tanto las claves español como inglés.
        const nodeIncidents: Record<string, unknown>[] =
          nodeIncidentsSnap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            const metadata =
              (data.metadata as Record<string, unknown> | undefined) ?? {};
            const criticidad =
              typeof metadata.criticidad === 'string'
                ? metadata.criticidad
                : typeof data.severity === 'string'
                  ? data.severity
                  : undefined;
            return {
              id: d.id,
              ...data,
              severity: criticidad ?? data.severity,
              // El motor usa `description` como label; nodes lo
              // tienen al top-level, pero algunos legacy sólo en
              // metadata.context — fallback defensivo.
              description:
                typeof data.description === 'string'
                  ? data.description
                  : typeof (metadata.context as unknown) === 'string'
                    ? (metadata.context as string)
                    : typeof data.title === 'string'
                      ? data.title
                      : 'Sin descripción',
            };
          });

        const incidentDocs: Record<string, unknown>[] = incidentsSnap.docs.map(
          (d) => ({
            id: d.id,
            ...(d.data() as Record<string, unknown>),
          }),
        );

        // Dedupe by id — un proyecto puede tener ambos shapes (writer
        // legacy + writer nuevo) durante la transición; preferimos el
        // shape canónico de `incidents` cuando hay colisión.
        const byId = new Map<string, Record<string, unknown>>();
        for (const n of nodeIncidents) byId.set(String(n.id), n);
        for (const i of incidentDocs) byId.set(String(i.id), i);
        const combined = Array.from(byId.values());

        return combined.filter((doc) => {
          // Aceptamos `occurredAt` (writer canónico /incidents) o
          // `createdAt` (legacy + nodes). NO descartamos por falta de
          // `occurredAt` — esa era la regresión que Codex flagged.
          const ts =
            (typeof doc.occurredAt === 'string' ? doc.occurredAt : null) ??
            (typeof doc.createdAt === 'string' ? doc.createdAt : null);
          if (!ts) return false;
          const t = Date.parse(ts);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        });
      },
    );

    // ── Corrective actions ── (full set: open + in_progress + closed +
    //    verified + verified_effective + reopened). El servicio acepta
    //    todos los status; el motor cphs los proyecta al enum de la
    //    minuta (open|closed|verified|verified_effective).
    //
    // Codex P2 PR #317:
    //   1. Incluimos `verified_effective` (F.11 terminal state) — antes
    //      quedaba fuera y `closedActionsCount` subreportaba PDCA real.
    //   2. Aumentamos el limit por status a 1000 (vs default 200 del
    //      adapter) — para proyectos con backlog grande, 200 truncaba
    //      acciones legítimas del período y la minuta perdía evidencia.
    //      1000 cubre prácticamente el 100% de casos reales; para
    //      cuadrillas/sitios con backlogs >1000 abiertos en un sólo
    //      status, el indicador subreporta pero el resto del draft es
    //      honest — el cursor-based pagination queda en TODO sub-PR.
    const ACTIONS_PAGE = 1000;
    const correctiveActions = await safeRead<Record<string, unknown>>(
      'correctiveActions',
      async () => {
        const adapter = new CorrectiveActionsAdapter(
          db as any,
          g.tenantId,
          projectId,
        );
        const [
          openA,
          inProgressA,
          closedA,
          verifiedA,
          verifiedEffectiveA,
          reopenedA,
        ] = await Promise.all([
          adapter.listByStatus('open', ACTIONS_PAGE).catch(() => []),
          adapter
            .listByStatus('in_progress', ACTIONS_PAGE)
            .catch(() => []),
          adapter.listByStatus('closed', ACTIONS_PAGE).catch(() => []),
          adapter.listByStatus('verified', ACTIONS_PAGE).catch(() => []),
          adapter
            .listByStatus('verified_effective', ACTIONS_PAGE)
            .catch(() => []),
          adapter.listByStatus('reopened', ACTIONS_PAGE).catch(() => []),
        ]);
        return [
          ...openA,
          ...inProgressA,
          ...closedA,
          ...verifiedA,
          ...verifiedEffectiveA,
          ...reopenedA,
        ] as unknown as Record<string, unknown>[];
      },
    );

    // ── Trainings impartidas. Top-level `training` collection
    //    filtrada por `projectId`. ──
    //
    // Codex P2 PR #317: el writer de Training.tsx escribe
    // `status: 'scheduled'` + `date: ISO` al crear la sesión y la
    // muta a `'completed'` al cerrar (vía `updateDoc`). El draft
    // CPHS mensual debe contar SOLO sesiones efectivamente impartidas
    // en el mes objetivo — no las agendadas a futuro ni las
    // canceladas. Filtramos client-side por `status === 'completed'`
    // Y por `date` dentro de la ventana mensual (mismo periodo que
    // los incidentes), para evitar inflar el indicador con
    // capacitaciones legacy de meses anteriores.
    //
    // Codex P2 PR #317 round 2:
    //   1. El `.limit(500)` sin orderBy podía devolver una "ventana"
    //      document-id-ordered y omitir las sesiones recientes — el
    //      mismo problema que vimos en incidents. Pedimos
    //      `orderBy('date', 'desc')` para que la cola más reciente
    //      siempre caiga adentro, y degradamos a query sin orden si
    //      falta el índice compuesto.
    //   2. Filtramos por `completedAt` cuando existe (writer nuevo),
    //      y caemos a `date` SÓLO como compat — pero exigimos que la
    //      fecha de schedule también caiga en la ventana del mes, para
    //      no contar sesiones agendadas previo al mes que se
    //      completaron en otro periodo. Es la mejor heurística sin
    //      backfill: el sub-PR siguiente actualiza Training.tsx para
    //      escribir `completedAt: serverTimestamp()` al cerrar (ver
    //      handleCompleteVideo) y a partir de ahí el draft preferirá
    //      ese timestamp.
    const trainings = await safeRead<Record<string, unknown>>(
      'trainings',
      async () => {
        const baseQuery = db
          .collection('training')
          .where('projectId', '==', projectId);
        let snap: FirebaseFirestore.QuerySnapshot;
        try {
          snap = await baseQuery
            .orderBy('date', 'desc')
            .limit(500)
            .get();
        } catch (orderErr) {
          // Índice compuesto faltante: degradamos a query sin orderBy
          // (mismo comportamiento previo). Para proyectos con <500
          // trainings totales esto sigue siendo correcto; el riesgo
          // sólo aparece con backlogs masivos sin índice.
          logger.warn?.(
            'sprintK.cphs.trainings.orderBy_failed_fallback_unordered',
            orderErr,
          );
          snap = await baseQuery.limit(500).get();
        }
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();
        const all: Record<string, unknown>[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
        return all.filter((doc) => {
          if (doc.status !== 'completed') return false;
          // Preferimos `completedAt` (writer nuevo) — ese es el
          // timestamp REAL de cuándo se impartió. Si no existe,
          // caemos a `date` (writer legacy: fecha de schedule).
          // Sólo contamos el training si el timestamp resultante
          // cae en la ventana del mes objetivo.
          const ts =
            (typeof doc.completedAt === 'string'
              ? doc.completedAt
              : null) ??
            (typeof doc.date === 'string' ? doc.date : null);
          if (!ts) return false;
          const t = Date.parse(ts);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        });
      },
    );

    // ── Inspections realizadas. ──
    //
    // Codex P2 PR #317 round 2: el writer canónico de la app
    // (`SafetyInspection.tsx` + `AddAuditModal.tsx`) crea
    // `NodeType.AUDIT` en la colección `nodes` (no en `/audits`).
    // Antes la ruta sólo leía `/audits`, así que proyectos con flujo
    // estándar obtenían `inspectionsCompleted: 0` aunque el dashboard
    // mostraba inspecciones reales. Además, cualquier audit histórico
    // o futuro inflaba el contador porque no había filtro por estado
    // ni por ventana mensual.
    //
    // Cambios:
    //   1. Leemos AMBAS colecciones: `nodes` (type='Auditoría' literal
    //      del enum, ver src/types/index.ts) y `/audits` (legacy).
    //   2. Filtramos al mismo `[monthStart, monthEnd)` que incidentes
    //      y trainings — sólo cuentan inspecciones EJECUTADAS en el
    //      período del borrador, no programadas para más tarde.
    //   3. Filtramos por estado: 'Completado' (writer SafetyInspection)
    //      o equivalentes ('completed', 'ejecutada'). El writer
    //      AddAuditModal escribe `metadata.status: 'Planificada'`
    //      cuando se agenda; ese estado NO debe contar.
    //   4. Dedupe por id para tolerar despliegues mixtos.
    const inspections = await safeRead<Record<string, unknown>>(
      'inspections',
      async () => {
        const startMs = monthStart.getTime();
        const endMs = monthEnd.getTime();

        // (a) Read /nodes filtered to NodeType.AUDIT (canonical writer).
        let nodesSnap: FirebaseFirestore.QuerySnapshot;
        try {
          nodesSnap = await db
            .collection('nodes')
            .where('projectId', '==', projectId)
            .where('type', '==', 'Auditoría')
            .limit(500)
            .get();
        } catch (nodesErr) {
          logger.warn?.(
            'sprintK.cphs.inspections.nodes_query_failed',
            nodesErr,
          );
          nodesSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        // (b) Read /audits (legacy collection).
        let auditsSnap: FirebaseFirestore.QuerySnapshot;
        try {
          auditsSnap = await db
            .collection('audits')
            .where('projectId', '==', projectId)
            .limit(500)
            .get();
        } catch (auditsErr) {
          logger.warn?.(
            'sprintK.cphs.inspections.audits_query_failed',
            auditsErr,
          );
          auditsSnap = {
            docs: [],
          } as unknown as FirebaseFirestore.QuerySnapshot;
        }

        const isCompletedStatus = (raw: unknown): boolean => {
          if (typeof raw !== 'string') return false;
          const s = raw.toLowerCase();
          return (
            s === 'completado' ||
            s === 'completada' ||
            s === 'completed' ||
            s === 'ejecutada' ||
            s === 'ejecutado'
          );
        };

        const isInPeriod = (raw: unknown): boolean => {
          if (typeof raw !== 'string') return false;
          const t = Date.parse(raw);
          return Number.isFinite(t) && t >= startMs && t < endMs;
        };

        // Normalize node-shape to inspection-shape: estado / fecha
        // viven en `metadata.status` y `metadata.date` (writers
        // SafetyInspection/AddAuditModal), y la fecha de creación
        // del documento es `createdAt` (string ISO escrito por
        // useRiskEngine o un serverTimestamp).
        const fromNodes: Record<string, unknown>[] = nodesSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const metadata =
              (data.metadata as Record<string, unknown> | undefined) ?? {};
            const status =
              (metadata.status as unknown) ?? (data.status as unknown);
            const dateField =
              (metadata.date as unknown) ??
              (data.completedAt as unknown) ??
              (data.createdAt as unknown);
            return {
              id: d.id,
              status,
              date: dateField,
              raw: data,
            };
          })
          .filter(
            (doc) =>
              isCompletedStatus(doc.status) && isInPeriod(doc.date),
          );

        const fromAudits: Record<string, unknown>[] = auditsSnap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            const status =
              (data.status as unknown) ??
              ((data.metadata as Record<string, unknown> | undefined)
                ?.status as unknown);
            const dateField =
              (data.completedAt as unknown) ??
              (data.date as unknown) ??
              (data.createdAt as unknown) ??
              ((data.metadata as Record<string, unknown> | undefined)
                ?.date as unknown);
            return {
              id: d.id,
              status,
              date: dateField,
              raw: data,
            };
          })
          .filter(
            (doc) =>
              isCompletedStatus(doc.status) && isInPeriod(doc.date),
          );

        // Dedupe by id — un proyecto puede tener ambos shapes durante
        // la transición; preferimos el shape canónico de `audits`
        // cuando hay colisión.
        const byId = new Map<string, Record<string, unknown>>();
        for (const n of fromNodes) byId.set(String(n.id), n);
        for (const a of fromAudits) byId.set(String(a.id), a);
        return Array.from(byId.values());
      },
    );

    // ── Map al shape `MonthlyInputs` del servicio ──

    // Severity normalization: incident docs pueden traer 'low'|'medium'|
    // 'high'|'critical' literalmente, o variantes ('baja'|'alta'|'1'..).
    // Mapeamos al enum estricto del servicio; default 'medium'.
    const normSeverity = (
      raw: unknown,
    ): 'low' | 'medium' | 'high' | 'critical' => {
      const s = String(raw ?? '').toLowerCase();
      if (
        s === 'critical' ||
        s === 'critico' ||
        s === 'crítico' ||
        s === '4'
      )
        return 'critical';
      if (s === 'high' || s === 'alta' || s === 'alto' || s === '3')
        return 'high';
      if (s === 'low' || s === 'baja' || s === 'bajo' || s === '1') return 'low';
      return 'medium';
    };

    const incidentsInput = incidents.map((i: Record<string, unknown>) => ({
      id: String(i.id ?? 'unknown'),
      severity: normSeverity(i.severity),
      description:
        typeof i.description === 'string' && i.description.length > 0
          ? i.description
          : typeof i.summary === 'string' && i.summary.length > 0
            ? i.summary
            : 'Sin descripción',
      // rootCauseKnown: aceptamos el flag explícito o derivamos de la
      // presencia de cualquier shape de `rootCause` (string o objeto).
      rootCauseKnown:
        i.rootCauseKnown === true ||
        (typeof i.rootCause === 'string' && i.rootCause.length > 0) ||
        (typeof i.rootCause === 'object' && i.rootCause !== null),
    }));

    const correctiveActionsInput = correctiveActions.map(
      (a: Record<string, unknown>) => {
        const rawStatus = String(a.status ?? 'open');
        // Map al enum aceptado por el servicio. `reopened` (F.4 nuevo)
        // se proyecta a 'open' para la minuta — sigue siendo trabajo
        // abierto desde la óptica del CPHS.
        const status:
          | 'open'
          | 'in_progress'
          | 'closed'
          | 'verified'
          | 'verified_effective' =
          rawStatus === 'closed'
            ? 'closed'
            : rawStatus === 'verified'
              ? 'verified'
              : rawStatus === 'verified_effective'
                ? 'verified_effective'
                : rawStatus === 'in_progress'
                  ? 'in_progress'
                  : 'open';
        return {
          id: String(a.id ?? 'unknown'),
          status,
          dueDate: typeof a.dueDate === 'string' ? a.dueDate : undefined,
          label:
            typeof a.description === 'string' && a.description.length > 0
              ? a.description.slice(0, 200)
              : 'Acción sin descripción',
        };
      },
    );

    const trainingsInput = trainings.map((t: Record<string, unknown>) => ({
      title:
        typeof t.title === 'string' && t.title.length > 0
          ? t.title
          : typeof t.name === 'string' && t.name.length > 0
            ? t.name
            : 'Capacitación',
      participantsCount: (() => {
        if (typeof t.participantsCount === 'number') return t.participantsCount;
        if (Array.isArray(t.participants)) return t.participants.length;
        if (Array.isArray(t.attendees)) return t.attendees.length;
        return 0;
      })(),
    }));

    // Codex P2 PR #317:
    //   - `complianceTrafficLightScore` ahora viene del campo
    //     `projects/{id}.complianceScore` (cacheado por la F.2
    //     pipeline). Si no existe en el doc del proyecto, pasamos
    //     `undefined` para que el motor omita la sección con
    //     "no disponible" en vez de pintar 🔴 0/100 engañoso.
    //   - `legalRecommendations` queda como `[]` por ahora — wiring
    //     real al `legalRuleEngine.getCriticalRequirements(profile)`
    //     requiere un `ProjectProfile` que el módulo de proyectos aún
    //     no expone consistentemente; sub-PR siguiente cuando F.2 y
    //     B.10 estén ambos cableados al doc del proyecto.
    const draft = buildMonthlyMinuteDraft({
      projectId,
      period: periodLabel,
      companyName,
      incidents: incidentsInput,
      correctiveActions: correctiveActionsInput,
      trainingsCompleted: trainingsInput,
      inspectionsCompleted: inspections.length,
      complianceTrafficLightScore,
      legalRecommendations: [],
      expectedAttendees,
    });

    return res.json({ draft });
  } catch (err) {
    logger.error?.('sprintK.cphs.draftMinute.error', err);
    captureRouteError(err, 'sprintK.cphs.draftMinute');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// F.16 Worker Readiness migrado a src/server/routes/workerReadiness.ts (2026-05-18).

// ─────────────────────────────────────────────────────────────────────
// §74-78 — Brigada de Emergencia + Recursos
// ─────────────────────────────────────────────────────────────────────
//
// Cierra el ciclo "respuesta a emergencias":
//   - Brigade de emergencia con roles (jefe / primeros auxilios /
//     fuego / evacuación / comunicaciones)
//   - Recursos (extintores, kits, AED, eyewash, fire hose, ducha
//     emergencia, kit derrames) con QR + inspección periódica
//   - Snapshot agregado: coverage + readiness + needing-attention
//
// Path firestore: tenants/{tid}/projects/{pid}/emergency_brigade/{id}
//   - Documento "_members" guarda la lista de brigadistas
//   - Documento "_resources" guarda la lista de recursos
//   - Documento "_inspections" guarda historial de inspecciones
//
// El servicio `emergencyBrigadeService` es pure — solo agregaciones.
// Aquí persistimos el state, allá calculamos el report.

import {
  buildBrigadeCoverageReport,
  buildResourceReadinessReport,
  type BrigadeMember,
  type BrigadeRole,
  type EmergencyResource,
} from '../../services/emergencyBrigade/emergencyBrigadeService.js';

const brigadeRoleEnum = z.enum([
  'brigade_chief',
  'first_aid',
  'fire_response',
  'evacuation_coordinator',
  'communications',
]);

const resourceKindEnum = z.enum([
  'extinguisher',
  'first_aid_kit',
  'aed',
  'eyewash',
  'safety_shower',
  'fire_hose',
  'spill_kit',
]);

// Codex P2 #1 (PR #321, line 5237): training / inspection dates were
// previously typed as `z.string().min(10)`, which accepted any 10+ char
// string (e.g. "not-a-date"). `buildBrigadeCoverageReport` then does
// `Date.parse(trainedAt) + ...` → `NaN`, and the `expiresMs < nowMs`
// check falls through to the `else` branch counting the member as
// actively certified. Result: a junk string makes the brigade look
// covered.
//
// Fix: validate that the string parses to a finite Date AND (for past
// events like trainings / inspections) is not future-dated. Future
// expirations (`nextExpirationAt`) only need to be parseable — by
// definition they are in the future.
const isoPastDate = z
  .string()
  .min(10)
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'invalid_iso_date',
  })
  .refine((s) => Date.parse(s) <= Date.now(), {
    message: 'date_in_future',
  });

const isoDate = z
  .string()
  .min(10)
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: 'invalid_iso_date',
  });

// Codex P2 #2 (PR #321, line 5251): only roles authorized to manage
// emergency-response data may write brigade members / resources /
// inspections. Mirrors the F.5 QR signature role gate
// (`QR_SIG_CHALLENGE_ROLES`). Ordinary workers — who in many projects
// are also project members — must not be able to add brigadists or flip
// a resource to "operational", which would directly move the readiness
// banner.
//
// Codex P2 round 2 #6 (PR #321, line 5168): include `supervisor` —
// the F.5 QR challenge role gate (`QR_SIG_CHALLENGE_ROLES`) already
// includes supervisors, and the inline comment claimed parity with
// that gate. Field supervisors must be able to add brigadists /
// register resources / mark inspections from the new page; without
// `supervisor` here every UI write action returned 403 even though the
// page allowed them through. The original gate already includes
// `brigade_chief` (the role that operates the brigade itself), so the
// union is { admin, prevencionista, supervisor, brigade_chief }.
const BRIGADE_WRITE_ROLES = new Set([
  'admin',
  'prevencionista',
  'supervisor',
  'brigade_chief',
]);

function callerCanWriteBrigade(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && BRIGADE_WRITE_ROLES.has(u.role)) {
    return true;
  }
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (tenants && typeof tenants === 'object' && typeof u.tenantId === 'string') {
    const t = tenants[u.tenantId];
    if (t && typeof t.role === 'string' && BRIGADE_WRITE_ROLES.has(t.role)) {
      return true;
    }
  }
  return false;
}

// Codex P2 #3 (PR #321, line 5261): when adding a brigadist by uid,
// confirm the uid is an actual project member before persisting. A typo
// or fabricated uid would otherwise satisfy required role coverage with
// a nonexistent worker.
//
// Codex P2 round 2 #7 (PR #321, line 5204): the previous revision only
// checked the legacy `projects/{projectId}.members[]` top-level array
// plus `createdBy`. But other production code paths
// (`src/server/routes/emergency.ts` → `sendToProjectSupervisors`)
// already treat `projects/{projectId}/members/{uid}` (subcollection) as
// the canonical member source — many tenants keep memberships there
// rather than duplicating every uid into the array. Without the
// subcollection check, legitimate workers were rejected with
// `worker_not_in_project`. Check BOTH sources before returning false so
// the canonical (subcollection) AND legacy (array) shapes are honored.
async function workerIsProjectMember(
  workerUid: string,
  projectId: string,
): Promise<boolean> {
  const db = admin.firestore();
  // Source 1: legacy top-level array + createdBy (matches
  // assertProjectMember semantics).
  try {
    const snap = await db.collection('projects').doc(projectId).get();
    if (snap.exists) {
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const members = data.members;
      const createdBy = data.createdBy;
      if (Array.isArray(members) && members.includes(workerUid)) return true;
      if (typeof createdBy === 'string' && createdBy === workerUid) return true;
    }
  } catch (err) {
    logger.warn?.(
      'sprintK.emergencyBrigade.workerIsProjectMember.legacyArray.failed',
      err,
    );
    // Fall through to the subcollection check — a partial failure on
    // one source shouldn't deny legitimate workers in the other.
  }
  // Source 2: canonical `projects/{projectId}/members/{uid}`
  // subcollection. Used by emergency.ts and other notification
  // surfaces; many tenants only populate this shape.
  try {
    const memberDoc = await db
      .collection('projects')
      .doc(projectId)
      .collection('members')
      .doc(workerUid)
      .get();
    if (memberDoc.exists) return true;
  } catch (err) {
    logger.warn?.(
      'sprintK.emergencyBrigade.workerIsProjectMember.subcollection.failed',
      err,
    );
  }
  return false;
}

router.get(
  '/:projectId/emergency-brigade',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );

      // Per-domain safe reads. Mirrors the dataQuality pattern so a
      // missing collection (fresh project) doesn't blank the snapshot —
      // empty arrays drive the empty-state UI cleanly.
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.emergencyBrigade.read.${label}.failed`, err);
          return [];
        }
      };

      const [members, resources] = await Promise.all([
        safeRead<BrigadeMember & { id: string }>('members', async () => {
          const snap = await baseRef
            .where('docType', '==', 'member')
            .get();
          return snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              workerUid: String(data.workerUid ?? ''),
              role: (data.role ?? 'brigade_chief') as BrigadeRole,
              trainedAt: String(data.trainedAt ?? ''),
              trainingValidYears:
                typeof data.trainingValidYears === 'number'
                  ? data.trainingValidYears
                  : 2,
              active: data.active !== false,
            };
          });
        }),
        safeRead<EmergencyResource>('resources', async () => {
          const snap = await baseRef
            .where('docType', '==', 'resource')
            .get();
          return snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              kind:
                (data.kind ?? 'extinguisher') as EmergencyResource['kind'],
              location: String(data.location ?? ''),
              lastInspectedAt: String(data.lastInspectedAt ?? ''),
              nextExpirationAt: String(data.nextExpirationAt ?? ''),
              operational: data.operational !== false,
            };
          });
        }),
      ]);

      const brigadeReport = buildBrigadeCoverageReport(members);
      const resourceReport = buildResourceReadinessReport(resources);

      // Readiness rollup: combines brigade coverage + resource health.
      // - green: minimum brigade coverage + ≥1 resource + 0 needing-attention
      // - amber: one of (gap in coverage XOR ≥1 needing-attention)
      // - rose:  both fail OR multiple coverage gaps OR multiple
      //          resources needing attention OR empty inventory
      //
      // Codex P2 #5 (PR #321, line 5209): an empty resource inventory
      // is itself a readiness gap. With three brigadists present but
      // zero registered resources, `needingAttention` is naturally
      // empty (you can't have an expired resource you don't have),
      // which previously evaluated to a GREEN banner saying "recursos
      // al día". For a project that has only added brigadists, that
      // incorrectly marks emergency response as ready. Treat
      // `totalResources === 0` as one extra structural gap so the
      // banner moves to amber (only gap) or rose (with other gaps).
      const coverageGapCount = brigadeReport.uncoveredRoles.length;
      const resourceGapCount = resourceReport.needingAttention.length;
      const emptyInventoryGap = resourceReport.totalResources === 0 ? 1 : 0;
      const totalGaps = coverageGapCount + resourceGapCount + emptyInventoryGap;
      let readinessLevel: 'green' | 'amber' | 'rose';
      if (totalGaps === 0 && brigadeReport.meetsMinimum) {
        readinessLevel = 'green';
      } else if (
        totalGaps === 1 ||
        (totalGaps <= 2 && brigadeReport.meetsMinimum)
      ) {
        readinessLevel = 'amber';
      } else {
        readinessLevel = 'rose';
      }

      return res.json({
        members,
        resources,
        brigade: brigadeReport,
        resourceReadiness: resourceReport,
        readinessLevel,
      });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.snapshot.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.snapshot');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const addBrigadeMemberSchema = z.object({
  workerUid: z.string().min(1).max(120),
  role: brigadeRoleEnum,
  // Codex P2 #1 (PR #321): reject "not-a-date" + future-dated trainings.
  trainedAt: isoPastDate,
  trainingValidYears: z.number().int().min(1).max(10).optional(),
  active: z.boolean().optional(),
});

router.post(
  '/:projectId/emergency-brigade/members',
  verifyAuth,
  validate(addBrigadeMemberSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof addBrigadeMemberSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 #2 (PR #321, line 5251): role gate. guard() only proved
    // the caller is a project member; here we require the caller to be
    // an admin / prevencionista / brigade_chief before mutating brigade
    // data — same pattern as F.5 QR signature challenge.
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    // Codex P2 #3 (PR #321, line 5261): the workerUid being added must
    // actually be a project member. Otherwise a typo or fabricated uid
    // would satisfy required role coverage with a nonexistent worker.
    if (!(await workerIsProjectMember(body.workerUid, projectId))) {
      return res.status(422).json({ error: 'worker_not_in_project' });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      // Codex P2 round 2 #9 (PR #321, line 5382): the previous revision
      // called `baseRef.doc()` which mints a fresh random id every
      // submission. Adding the same worker twice (or once per required
      // role) produced N distinct member documents, and
      // `buildBrigadeCoverageReport` counted them as separate active
      // members — so a single real person could inflate the byRole
      // counter to satisfy the three-member minimum. Fix: derive a
      // deterministic id keyed on `worker:role`, and reject with 409
      // if a member document for that (workerUid, role) pair already
      // exists. The deterministic id also makes the audit trail easier
      // (one worker = one member doc per role across re-trainings).
      const safeUid = body.workerUid.replace(/[^a-zA-Z0-9_-]/g, '_');
      const id = `member-${safeUid}-${body.role}`;
      const doc = baseRef.doc(id);
      const existing = await doc.get();
      if (existing.exists) {
        return res.status(409).json({
          error: 'worker_already_in_role',
          existingId: id,
        });
      }
      await doc.set({
        docType: 'member',
        workerUid: body.workerUid,
        role: body.role,
        trainedAt: body.trainedAt,
        trainingValidYears: body.trainingValidYears ?? 2,
        active: body.active !== false,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
      });
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.addMember.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.addMember');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const addResourceSchema = z.object({
  kind: resourceKindEnum,
  location: z.string().min(1).max(240),
  // Codex P2 #1 (PR #321): inspection date must be a real past ISO
  // date; expiration date must be a real ISO date (may be future).
  lastInspectedAt: isoPastDate,
  nextExpirationAt: isoDate,
  operational: z.boolean().optional(),
});

router.post(
  '/:projectId/emergency-brigade/resources',
  verifyAuth,
  validate(addResourceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof addResourceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 #2 (PR #321, line 5251): role gate for resource writes
    // — flipping a resource's operational state directly moves the
    // readiness signal.
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      const doc = baseRef.doc();
      const id = doc.id;
      await doc.set({
        docType: 'resource',
        kind: body.kind,
        location: body.location,
        lastInspectedAt: body.lastInspectedAt,
        nextExpirationAt: body.nextExpirationAt,
        operational: body.operational !== false,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
      });
      return res.status(201).json({ ok: true, id });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.addResource.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.addResource');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const inspectResourceSchema = z.object({
  // Codex P2 #1 (PR #321): inspection timestamp must parse and not be
  // future-dated; the new expiration may legitimately be in the future.
  inspectedAt: isoPastDate,
  operational: z.boolean(),
  nextExpirationAt: isoDate.optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/emergency-brigade/resources/:id/inspect',
  verifyAuth,
  validate(inspectResourceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof inspectResourceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 #2 (PR #321, line 5251): role gate for resource
    // inspections — `operational: true` resets the readiness signal.
    if (!callerCanWriteBrigade(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(BRIGADE_WRITE_ROLES),
      });
    }
    try {
      const db = admin.firestore();
      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/emergency_brigade`,
      );
      const resourceRef = baseRef.doc(id);
      const snap = await resourceRef.get();
      if (!snap.exists || snap.data()?.docType !== 'resource') {
        return res.status(404).json({ error: 'resource_not_found' });
      }
      // Patch the resource with the latest inspection + audit a separate
      // inspection record so historical inspections survive the next
      // patch.
      const patch: Record<string, unknown> = {
        lastInspectedAt: body.inspectedAt,
        operational: body.operational,
        lastInspectedBy: callerUid,
      };
      if (body.nextExpirationAt) {
        patch.nextExpirationAt = body.nextExpirationAt;
      }
      const auditDoc = baseRef.doc();
      const batch = db.batch();
      batch.set(resourceRef, patch, { merge: true });
      batch.set(auditDoc, {
        docType: 'inspection',
        resourceId: id,
        inspectedAt: body.inspectedAt,
        inspectedBy: callerUid,
        operational: body.operational,
        notes: body.notes ?? null,
        createdAt: new Date().toISOString(),
      });
      await batch.commit();
      return res.status(201).json({ ok: true, inspectionId: auditDoc.id });
    } catch (err) {
      logger.error?.('sprintK.emergencyBrigade.inspect.error', err);
      captureRouteError(err, 'sprintK.emergencyBrigade.inspect');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// §214-215 Positive Observations (listing + balance) migrado a src/server/routes/positiveObservations.ts (2026-05-18).



// ─────────────────────────────────────────────────────────────────────
// Fase F.6 — Modo Sin Señal para Inspecciones (offline-first daily ops)
// ─────────────────────────────────────────────────────────────────────
//
// Bridges the pure `offlineInspectionService` (which is deterministic +
// I/O-free by design) to a project-scoped CRUD surface so the
// inspector/supervisor can persist a session that was originally
// captured offline. The HTTP layer is the *sync* surface — observations
// stay in IndexedDB on the device until the network returns, then the
// client POSTs them here.
//
// Storage path: `tenants/{tid}/projects/{pid}/inspections/{id}`.
// One document per inspection session. Observations live in a subarray
// on the parent doc to keep retrieval cheap (a typical session has
// 10-30 items; arrays scale fine at that size).
//
// Status machine (server-authoritative):
//   in_progress → on start()
//   completed   → on complete() once `completedAt` is recorded
//
// Idempotency:
//   - `POST /inspections` is keyed by client-generated `id`; resending
//     the same id no-ops (merge:true).
//   - `POST /inspections/:id/observations` is keyed by client-generated
//     `observationId`; we de-dup before append so a flaky retry on
//     spotty mobile network never doubles the observation.
//
// Filosofía Praeventio:
//   - Detección Predictiva: el hallazgo se captura aunque NO haya señal.
//   - Respuesta Adaptativa: el server acepta sync diferida sin penalizar.
//   - Consolidación: la inspección completa queda como nodo auditable.

const INSPECTION_STATUSES = ['in_progress', 'completed'] as const;
type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

interface StoredInspectionObservation {
  observationId: string;
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  recordedAt: string;
  recordedBy: string;
}

interface StoredInspection {
  id: string;
  templateId: string;
  responsibleUid: string;
  status: InspectionStatus;
  startedAt: string;
  startedBy: string;
  completedAt?: string;
  observations: StoredInspectionObservation[];
}

router.get('/:projectId/inspections', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const rawStatus =
      typeof req.query.status === 'string' ? req.query.status : 'all';
    // Accept `all` (no filter) plus the canonical statuses; everything
    // else collapses to `all` so a malformed query string still renders
    // a useful list instead of an error.
    const statusFilter: InspectionStatus | 'all' = (
      ['all', ...INSPECTION_STATUSES] as readonly string[]
    ).includes(rawStatus)
      ? (rawStatus as InspectionStatus | 'all')
      : 'all';

    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/inspections`,
    );

    // Codex PR #322 P1 #1: don't swallow filtered-read failures any more.
    // When `statusFilter !== 'all'` we combine an equality filter on
    // `status` with `orderBy('startedAt')`, which needs the composite
    // index `inspections(status ASC, startedAt DESC)`. The index is now
    // declared in firestore.indexes.json, but in projects where it's
    // still building Firestore returns FAILED_PRECONDITION (code 9).
    // We catch that one specific error and fall back to a fetch-then-
    // sort-in-JS path so in-progress/completed inspections remain
    // visible during index propagation. ANY OTHER error is rethrown
    // and surfaces as a 500 to the caller — so we never silently
    // return [] and make rows look "missing" again.
    const mapDocs = (
      snap: admin.firestore.QuerySnapshot,
    ): StoredInspection[] =>
      snap.docs.map((d) => {
        const data = d.data() as Omit<StoredInspection, 'id'>;
        return {
          id: d.id,
          ...data,
          // Defensive: a brand-new doc may not have observations yet
          // (e.g. created via start without any observation appended).
          observations: Array.isArray(data.observations) ? data.observations : [],
        };
      });

    const FAILED_PRECONDITION = 9;
    const isMissingIndexError = (err: unknown): boolean => {
      if (!err || typeof err !== 'object') return false;
      const e = err as { code?: number | string; message?: string };
      if (e.code === FAILED_PRECONDITION || e.code === 'failed-precondition') {
        return true;
      }
      return (
        typeof e.message === 'string' &&
        /requires an index|FAILED_PRECONDITION/i.test(e.message)
      );
    };

    let inspections: StoredInspection[];
    try {
      let q: admin.firestore.Query = baseRef;
      if (statusFilter !== 'all') {
        q = q.where('status', '==', statusFilter);
      }
      // Most recent first; 200 cap mirrors drills endpoint conventions.
      const snap = await q.orderBy('startedAt', 'desc').limit(200).get();
      inspections = mapDocs(snap);
    } catch (err) {
      if (!isMissingIndexError(err)) {
        // Real failure (auth, network, schema) — bubble up instead of
        // swallowing into an empty list (the previous behaviour hid
        // genuine outages from the caller).
        throw err;
      }
      logger.warn?.(
        'sprintK.inspections.list.index_fallback',
        { statusFilter },
      );
      // Index missing or still building: fetch without orderBy (cap
      // raised slightly so the JS-side limit doesn't truncate the
      // newest rows after sort) and sort in JS. Equality filter alone
      // doesn't need a composite index.
      let q: admin.firestore.Query = baseRef;
      if (statusFilter !== 'all') {
        q = q.where('status', '==', statusFilter);
      }
      const snap = await q.limit(500).get();
      inspections = mapDocs(snap)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
        .slice(0, 200);
    }

    return res.json({ inspections });
  } catch (err) {
    logger.error?.('sprintK.inspections.list.error', err);
    captureRouteError(err, 'sprintK.inspections.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const inspectionStartSchema = z.object({
  id: z.string().min(1).max(120),
  templateId: z.string().min(1).max(200),
  responsibleUid: z.string().min(1).max(200),
  startedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections',
  verifyAuth,
  validate(inspectionStartSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof inspectionStartSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(body.id);
      // Idempotent: if the session already exists we don't overwrite
      // the original startedAt/startedBy — the client may retry on
      // flaky 4G and the canonical start ts is the FIRST one.
      const existing = await docRef.get();
      if (existing.exists) {
        const data = existing.data() as Omit<StoredInspection, 'id'>;
        return res
          .status(200)
          .json({ ok: true, inspection: { id: existing.id, ...data } });
      }
      const now = body.startedAt ?? new Date().toISOString();
      const payload: StoredInspection = {
        id: body.id,
        templateId: body.templateId,
        responsibleUid: body.responsibleUid,
        status: 'in_progress',
        startedAt: now,
        startedBy: callerUid,
        observations: [],
      };
      await docRef.set(payload, { merge: true });
      return res.status(201).json({ ok: true, inspection: payload });
    } catch (err) {
      logger.error?.('sprintK.inspections.start.error', err);
      captureRouteError(err, 'sprintK.inspections.start');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const inspectionObservationSchema = z.object({
  observationId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).optional(),
  photoStoragePath: z.string().min(1).max(500).optional(),
  locationLatLng: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  recordedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections/:inspectionId/observations',
  verifyAuth,
  validate(inspectionObservationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, inspectionId } = req.params;
    const body = req.body as z.infer<typeof inspectionObservationSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(inspectionId);

      // Codex PR #322 P1 #2: wrap the read + de-dup + write inside a
      // Firestore transaction so concurrent appends (typical when the
      // offline queue flushes several queued observations in parallel
      // after reconnecting) don't read the same array and overwrite
      // each other. Without the transaction, the second writer's
      // version of `observations` clobbers the first writer's append.
      //
      // Codex PR #322 P2 #2: idempotency now also covers the
      // `inspection_already_completed` path. If a POST succeeds on the
      // server but the client never gets the response, then the same
      // observationId is retried AFTER the inspection has been closed,
      // returning 409 would falsely surface a data-loss error. We
      // detect that case and return 200 with the already-persisted
      // observation. Conversely, a retry that SHARES an observationId
      // but carries DIFFERENT content (different notes, different
      // photoStoragePath, different itemId, different locationLatLng)
      // is an actual id collision — we surface that as 409
      // `observation_id_conflict` instead of silently overwriting.
      type ObservationCommitOutcome =
        | { kind: 'created'; observation: StoredInspectionObservation; status: 201 }
        | { kind: 'duplicate'; observation: StoredInspectionObservation; status: 200 }
        | { kind: 'not_found' }
        | { kind: 'completed_new_id' }
        | { kind: 'id_conflict' };

      const observationsEqual = (
        a: StoredInspectionObservation,
        b: StoredInspectionObservation,
      ): boolean => {
        // Compare only the caller-supplied fields. `recordedAt` and
        // `recordedBy` are server-stamped and shouldn't gate
        // idempotency: a network retry that survives across midnight
        // would otherwise spuriously 409 over a recordedAt drift.
        if ((a.itemId ?? null) !== (b.itemId ?? null)) return false;
        if ((a.notes ?? null) !== (b.notes ?? null)) return false;
        if ((a.photoStoragePath ?? null) !== (b.photoStoragePath ?? null)) {
          return false;
        }
        const aLoc = a.locationLatLng;
        const bLoc = b.locationLatLng;
        if (aLoc && bLoc) {
          if (aLoc.lat !== bLoc.lat || aLoc.lng !== bLoc.lng) return false;
        } else if (Boolean(aLoc) !== Boolean(bLoc)) {
          return false;
        }
        return true;
      };

      const outcome = await db.runTransaction<ObservationCommitOutcome>(
        async (tx) => {
          const snap = await tx.get(docRef);
          if (!snap.exists) {
            return { kind: 'not_found' };
          }
          const existing = snap.data() as Omit<StoredInspection, 'id'>;
          const prev = Array.isArray(existing.observations)
            ? existing.observations
            : [];
          const existingSameId = prev.find(
            (o: StoredInspectionObservation) =>
              o.observationId === body.observationId,
          );

          // Candidate record we'd persist (used for both create + conflict check).
          const candidate: StoredInspectionObservation = {
            observationId: body.observationId,
            recordedAt:
              body.recordedAt ??
              existingSameId?.recordedAt ??
              new Date().toISOString(),
            recordedBy: existingSameId?.recordedBy ?? callerUid,
            ...(body.itemId !== undefined ? { itemId: body.itemId } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.photoStoragePath !== undefined
              ? { photoStoragePath: body.photoStoragePath }
              : {}),
            ...(body.locationLatLng !== undefined
              ? { locationLatLng: body.locationLatLng }
              : {}),
          };

          if (existing.status === 'completed') {
            if (existingSameId) {
              // Retry after completion — already persisted, return 200.
              return { kind: 'duplicate', observation: existingSameId, status: 200 };
            }
            // Genuinely new observation on a closed inspection — reject.
            return { kind: 'completed_new_id' };
          }

          if (existingSameId) {
            if (observationsEqual(existingSameId, candidate)) {
              return {
                kind: 'duplicate',
                observation: existingSameId,
                status: 200,
              };
            }
            return { kind: 'id_conflict' };
          }

          const next = [...prev, candidate];
          tx.set(docRef, { observations: next }, { merge: true });
          return { kind: 'created', observation: candidate, status: 201 };
        },
      );

      if (outcome.kind === 'not_found') {
        return res.status(404).json({ error: 'inspection_not_found' });
      }
      if (outcome.kind === 'completed_new_id') {
        return res.status(409).json({ error: 'inspection_already_completed' });
      }
      if (outcome.kind === 'id_conflict') {
        return res.status(409).json({ error: 'observation_id_conflict' });
      }
      return res
        .status(outcome.status)
        .json({ ok: true, observation: outcome.observation });
    } catch (err) {
      logger.error?.('sprintK.inspections.observation.error', err);
      captureRouteError(err, 'sprintK.inspections.observation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const inspectionCompleteSchema = z.object({
  completedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections/:inspectionId/complete',
  verifyAuth,
  validate(inspectionCompleteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, inspectionId } = req.params;
    const body = req.body as z.infer<typeof inspectionCompleteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(inspectionId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'inspection_not_found' });
      }
      const existing = snap.data() as Omit<StoredInspection, 'id'>;
      if (existing.status === 'completed') {
        // Already completed — return the existing doc; this is also
        // idempotent so the offline queue can retry safely.
        return res
          .status(200)
          .json({ ok: true, inspection: { id: snap.id, ...existing } });
      }
      const completedAt = body.completedAt ?? new Date().toISOString();
      await docRef.set(
        { status: 'completed', completedAt },
        { merge: true },
      );
      return res.status(200).json({
        ok: true,
        inspection: { id: snap.id, ...existing, status: 'completed', completedAt },
      });
    } catch (err) {
      logger.error?.('sprintK.inspections.complete.error', err);
      captureRouteError(err, 'sprintK.inspections.complete');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// §42-44 — Inventario Controles de Ingeniería + Jerarquía ISO 31000
// ────────────────────────────────────────────────────────────────────────
//
// Inventario de controles aplicados según la jerarquía ISO 31000 /
// 45001:
//   elimination > substitution > engineering > administrative > epp
//
// Persistido en
//   tenants/{tid}/projects/{pid}/engineering_controls/{id}
//
// Cada control declara:
//   - level (en la jerarquía)
//   - riskCategory que mitiga
//   - descripción + responsable + frecuencia de verificación (días)
//   - lista de verificaciones realizadas (verifierUid + result + evidence)
//
// La página deriva el estado de vigencia (verde/ámbar/rojo) a partir
// del `lastVerifiedAt + verificationFrequencyDays`. Esta lógica es
// determinística: el motor `engineeringControlsInventory` (servicio
// existente, intacto) calcula la cobertura de riesgos y la auditoría
// de jerarquía a partir del inventario.

type EngControlHierarchyLevel =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'epp';

const ENG_CTRL_LEVELS: ReadonlySet<EngControlHierarchyLevel> = new Set([
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'epp',
]);

interface StoredEngineeringControl {
  id: string;
  level: EngControlHierarchyLevel;
  riskCategory: string;
  name: string;
  description: string;
  responsibleUid: string;
  verificationFrequencyDays: number;
  createdAt: string;
  createdBy: string;
  lastVerifiedAt: string | null;
  verifications: Array<{
    verifierUid: string;
    verifiedAt: string;
    result: 'pass' | 'observation' | 'fail';
    evidence?: string;
  }>;
}

router.get(
  '/:projectId/engineering-controls',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      // Codex P2 (PR #319): surface read failures instead of silently
      // returning `[]`. A missing collection already yields an empty
      // snapshot — a *thrown* error here means Firestore is degraded,
      // permissions changed, or the backend rejected the read. Hiding
      // that as "no controls" lets the UI report the project has nothing
      // inventoried during outages, which is dangerous for a safety
      // surface. We still return 200 + empty list so the page renders,
      // but we attach `warning: 'partial_read_failure'` so the UI can
      // show a degraded-data banner instead of a clean empty state.
      let partialReadFailure = false;
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.engineeringControls.read.${label}.failed`, err);
          partialReadFailure = true;
          return [];
        }
      };

      const db = admin.firestore();
      const colRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
      );

      const rawLevel = typeof req.query.level === 'string' ? req.query.level : 'all';
      // 'admin' is the shorthand used on the frontend; map to 'administrative'.
      const levelParam: 'all' | EngControlHierarchyLevel =
        rawLevel === 'all'
          ? 'all'
          : rawLevel === 'admin'
            ? 'administrative'
            : (ENG_CTRL_LEVELS.has(rawLevel as EngControlHierarchyLevel)
                ? (rawLevel as EngControlHierarchyLevel)
                : 'all');
      const riskCategory =
        typeof req.query.riskCategory === 'string' ? req.query.riskCategory : null;

      const controls = await safeRead('list', async () => {
        const snap = await colRef.get();
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StoredEngineeringControl, 'id'>),
        }));
      });

      // Codex P2 (PR #319, round 2): include `general` (cross-cutting)
      // controls in risk-filtered results. The page contract — and the
      // client-side post-filter in EngineeringControls.tsx — treats
      // `general` controls as applicable to every risk (site-wide
      // signage, housekeeping, etc.). An exact-match server filter would
      // strip them out before the client could keep them, leaving the
      // user with an incomplete inventory under any specific risk chip.
      // Match if the control's category equals the requested one *or*
      // the control is tagged `general`. The level filter still applies
      // unchanged.
      const filtered = controls.filter((c) => {
        if (levelParam !== 'all' && c.level !== levelParam) return false;
        if (
          riskCategory &&
          c.riskCategory !== riskCategory &&
          c.riskCategory !== 'general'
        )
          return false;
        return true;
      });

      return res.json({
        controls: filtered,
        ...(partialReadFailure ? { warning: 'partial_read_failure' } : {}),
      });
    } catch (err) {
      logger.error?.('sprintK.engineeringControls.list.error', err);
      captureRouteError(err, 'sprintK.engineeringControls.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

/**
 * Codex P1 (PR #319): typed error raised inside the create-transaction
 * when the client-supplied control ID already exists. Lets the route
 * map the failure to a 409 with the stable code
 * `engineering_control_duplicate_id` instead of bubbling up as a 500.
 */
class EngineeringControlDuplicateError extends Error {
  readonly controlId: string;
  constructor(controlId: string) {
    super(`engineering control already exists: ${controlId}`);
    this.name = 'EngineeringControlDuplicateError';
    this.controlId = controlId;
  }
}

const engineeringControlCreateSchema = z.object({
  id: z.string().min(1),
  level: z.enum(['elimination', 'substitution', 'engineering', 'administrative', 'epp']),
  riskCategory: z.string().min(1).max(200),
  name: z.string().min(3).max(300),
  description: z.string().min(3).max(4000),
  responsibleUid: z.string().min(1),
  verificationFrequencyDays: z.number().int().positive().max(3650),
});

router.post(
  '/:projectId/engineering-controls',
  verifyAuth,
  validate(engineeringControlCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof engineeringControlCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const doc: StoredEngineeringControl = {
        id: body.id,
        level: body.level,
        riskCategory: body.riskCategory,
        name: body.name,
        description: body.description,
        responsibleUid: body.responsibleUid,
        verificationFrequencyDays: body.verificationFrequencyDays,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
        lastVerifiedAt: null,
        verifications: [],
      };
      const ref = admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
        )
        .doc(body.id);
      // Codex P1 (PR #319): reject duplicate IDs instead of silently
      // overwriting. The ID is client-supplied, so `.set()` would let a
      // colliding ID erase an existing control's `createdAt`,
      // `createdBy`, `lastVerifiedAt` and the whole `verifications`
      // audit history. Run the write inside a transaction that fails
      // when the document already exists, returning 409 with a stable
      // error code (`engineering_control_duplicate_id`) so the frontend
      // can show a "ya existe" message. Note: `.create()` is documented
      // to throw `ALREADY_EXISTS` (gRPC code 6) if the doc exists, but
      // a transaction-based check is more portable across mocked admin
      // SDKs in tests and matches the qr-signature acknowledgement
      // pattern used elsewhere in this file.
      const db = admin.firestore();
      try {
        await db.runTransaction(async (txn) => {
          const existing = await txn.get(ref);
          if (existing.exists) {
            throw new EngineeringControlDuplicateError(body.id);
          }
          txn.create(ref, doc);
        });
      } catch (err) {
        if (err instanceof EngineeringControlDuplicateError) {
          return res.status(409).json({
            error: 'engineering_control_duplicate_id',
            controlId: err.controlId,
          });
        }
        // `txn.create()` itself can throw ALREADY_EXISTS (gRPC code 6)
        // if a parallel writer races us between `txn.get` and `txn.create`.
        // Surface that as 409 too so the contract stays consistent.
        const code = (err as { code?: number | string } | null)?.code;
        if (code === 6 || code === 'ALREADY_EXISTS') {
          return res.status(409).json({
            error: 'engineering_control_duplicate_id',
            controlId: body.id,
          });
        }
        throw err;
      }
      return res.status(201).json({ ok: true, control: doc });
    } catch (err) {
      logger.error?.('sprintK.engineeringControls.create.error', err);
      captureRouteError(err, 'sprintK.engineeringControls.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// Codex P1 (PR #319): the verify schema no longer accepts `verifierUid`
// from the request body. The server derives the verifier identity from
// the authenticated caller (`req.user!.uid`) so a project member cannot
// impersonate a supervisor/manager in the audit trail. Same fix as
// PR #318: never trust client-supplied identity for safety records.
const engineeringControlVerifySchema = z.object({
  result: z.enum(['pass', 'observation', 'fail']),
  evidence: z.string().max(4000).optional(),
});

router.post(
  '/:projectId/engineering-controls/:id/verify',
  verifyAuth,
  validate(engineeringControlVerifySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof engineeringControlVerifySchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
        )
        .doc(id);

      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'control_not_found' });
      }
      const now = new Date().toISOString();
      const entry = {
        // Codex P1 (PR #319): use the authenticated caller, never the
        // request body. The audit trail must reflect who actually did
        // the check, not who the client claims did it.
        verifierUid: callerUid,
        verifiedAt: now,
        result: body.result,
        ...(body.evidence ? { evidence: body.evidence } : {}),
      };
      // FieldValue.arrayUnion keeps history additive — never silently
      // overwrites prior verifications. `lastVerifiedAt` is the canonical
      // timestamp the UI uses to compute vigencia (verde/ámbar/rojo)
      // against `verificationFrequencyDays`.
      //
      // Codex P2 (PR #319): only advance `lastVerifiedAt` when the
      // verification actually passed. Advancing on `observation` or
      // `fail` would let a freshly *failed* control appear "Vigente"
      // (green) right after the failure — because the page derives the
      // green/amber/red status from `lastVerifiedAt + frequency` alone.
      // The failed/observation entries still land in `verifications` so
      // the history is complete; they just don't bump the canonical
      // currency timestamp.
      const updatePayload: {
        verifications: admin.firestore.FieldValue;
        lastVerifiedAt?: string;
      } = {
        verifications: admin.firestore.FieldValue.arrayUnion(entry),
      };
      if (body.result === 'pass') {
        updatePayload.lastVerifiedAt = now;
      }
      await ref.update(updatePayload);
      return res.status(200).json({ ok: true, entry });
    } catch (err) {
      logger.error?.('sprintK.engineeringControls.verify.error', err);
      captureRouteError(err, 'sprintK.engineeringControls.verify');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Sprint K §61-63 — Encuesta de Percepción + Índice de Cultura + Reconocimiento
// ─────────────────────────────────────────────────────────────────────
//
// Endpoints HTTP que exponen el motor determinístico
// `safetyCulturePulse` al frontend. El servicio existía pero no era
// navegable — el ciclo predictivo (Detección → Respuesta →
// Consolidación) quedaba inerte aunque computePulseIndex y
// buildPulseTrend estuvieran listos.
//
// Storage paths:
//   - Survey doc:   tenants/{tid}/projects/{pid}/culture_pulse/{surveyId}
//   - Response:     .../culture_pulse/{surveyId}/responses/{responseDocId}
//
// PRIVACIDAD CRÍTICA (directiva del producto):
//   - Las respuestas NUNCA persisten `responderUid`. El doc carga sólo
//     `responderHash` (SHA-256 del uid+surveyId, primeros 16 hex) que
//     sirve para garantizar "una respuesta por trabajador por encuesta"
//     SIN permitir reconstruir la identidad. Aunque un atacante con
//     acceso a Firestore conozca todos los `responderHash`, no puede
//     recorrer la lista de uids del proyecto y derivar quién respondió
//     qué a menos que ya tenga el uid Y el surveyId — y en ese caso ya
//     tiene auth de admin total, así que la propiedad de anonimato es
//     "anonimato respecto a otros revisores del dashboard / SUSESO /
//     SII". El responderUid NO entra a Firestore en ningún momento.
//   - El endpoint snapshot (`/culture-pulse`) agrega métricas (índice,
//     conteo, top concerns/strengths) y NUNCA expone respuestas
//     individuales.
//   - El endpoint history devuelve sólo (periodo, índice, respuestas).

const PULSE_QUESTION_KEYS = [
  'felt_safe_today',
  'manager_listens',
  'free_to_stop',
  'reported_incident_safely',
  'has_resources_to_be_safe',
] as const;
type PulseQuestionKey = (typeof PULSE_QUESTION_KEYS)[number];

interface StoredPulseSurvey {
  id: string;
  status: 'open' | 'closed';
  /** Ventana en la que se aceptan respuestas. */
  openAt: string;
  closeAt: string;
  /** Plantilla / título — admin lo define al programar. */
  title?: string;
  /** Conteo objetivo de respondedores (para % participación). */
  expectedRespondents?: number;
  createdAt: string;
  createdBy: string;
}

interface StoredPulseResponse {
  /**
   * SHA-256 truncado de `${responderUid}:${surveyId}`. NO permite
   * reconstruir el uid, pero garantiza idempotencia por respondedor
   * (siempre el mismo hash → siempre el mismo docId).
   *
   * NO se persiste `responderUid` en el doc. La directiva de
   * anonimato del producto lo prohíbe explícitamente: aún si el
   * dashboard/SUSESO/SII gana acceso, no puede mapear hash → uid.
   */
  responderHash: string;
  workerRole: string;
  area: string;
  answers: Record<PulseQuestionKey, number>;
  submittedAt: string;
}

function pulseResponderHash(uid: string, surveyId: string): string {
  return createHash('sha256').update(`${uid}:${surveyId}`).digest('hex').slice(0, 32);
}

/**
 * Etiquetas humanas por question key — usadas para top concerns/
 * strengths. Mantenemos castellano (audiencia objetivo: prevencionistas
 * y trabajadores de habla hispana).
 */
const PULSE_QUESTION_LABEL: Record<PulseQuestionKey, string> = {
  felt_safe_today: 'Me sentí seguro hoy',
  manager_listens: 'Mi jefe escucha mis inquietudes',
  free_to_stop: 'Me siento libre de detener un trabajo inseguro',
  reported_incident_safely: 'Puedo reportar incidentes sin miedo',
  has_resources_to_be_safe: 'Tengo los recursos para trabajar seguro',
};

// PRIVACIDAD CRÍTICA — umbral de anonimato. Cuando el conteo de respuestas
// está por debajo de este umbral, el snapshot OMITE per-question averages,
// topConcerns, topStrengths, byQuestion y punitive flag — devolver
// agregados con n<5 puede permitir reconstruir respuestas individuales
// (ej.: con 1 respuesta el promedio ES la respuesta del trabajador; con
// 2-4 respuestas un atacante con conocimiento previo de un solo respondedor
// puede inferir respuestas de los otros). La directiva del producto exige
// que las respuestas sean anónimas, así que suprimimos todo agregado
// derivado hasta que el conteo cruce el umbral.
const PULSE_ANONYMITY_THRESHOLD = 5;

interface CulturePulseSnapshot {
  surveyId: string | null;
  status: 'open' | 'closed' | null;
  openAt: string | null;
  closeAt: string | null;
  cultureIndex: number;
  level: 'low' | 'fair' | 'good' | 'strong';
  totalResponses: number;
  expectedRespondents: number | null;
  participationRate: number | null;
  punitiveCulturedFlagged: boolean;
  byQuestion: Record<PulseQuestionKey, number>;
  topConcerns: Array<{ key: PulseQuestionKey; label: string; score: number }>;
  topStrengths: Array<{ key: PulseQuestionKey; label: string; score: number }>;
  hasResponded: boolean;
  /**
   * Codex P1 #3 (PR #323, line 5304) — Bandera de "agregados suprimidos
   * por anonimato". `true` cuando `totalResponses < PULSE_ANONYMITY_THRESHOLD`
   * y la UI debe mostrar mensaje de "esperando respuestas suficientes para
   * proteger el anonimato". Cuando es `true`, `byQuestion`, `topConcerns`,
   * `topStrengths`, `cultureIndex`, `level`, `participationRate` y
   * `punitiveCulturedFlagged` son valores neutros (cero / vacío / false).
   */
  insufficientResponses?: boolean;
  /** Conteo actual (mismo que `totalResponses`, expuesto explícitamente
   * cuando `insufficientResponses=true` para que la UI lo muestre). */
  currentCount?: number;
  /** Umbral mínimo de respuestas para revelar agregados. */
  threshold?: number;
}

// Codex P1 #2 (PR #323, line 5217) — Detector de FAILED_PRECONDITION
// para los índices compuestos que `/culture-pulse` y
// `/culture-pulse/history` requieren. Una vez los índices se despliegan
// estos fallbacks se vuelven código muerto (las consultas ordenadas
// siempre tendrán éxito), pero los mantenemos para que el dashboard NO
// se quede silenciosamente vacío durante una ventana de propagación.
function isMissingFirestoreIndexError(err: unknown): boolean {
  const code = (err as { code?: string | number } | null)?.code;
  if (code === 9 || code === 'failed-precondition') return true;
  const msg = String((err as Error | null)?.message ?? '');
  return /index/i.test(msg) && /FAILED_PRECONDITION|requires an index/i.test(msg);
}

router.get('/:projectId/culture-pulse', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { computePulseIndex } = await import(
      '../../services/culturePulse/safetyCulturePulse.js'
    );

    const db = admin.firestore();
    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
    );

    const safeRead = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.('sprintK.culturePulse.snapshot.read_failed', err);
        return fallback;
      }
    };

    // Codex P1 #1 + #2 (PR #323, line 5217) — Survey discovery:
    //
    //   #1: Confiar en `survey.status === 'open'` (el doc field) garantiza
    //       que un admin que cerró explícitamente la encuesta NO la siga
    //       viendo como activa. PERO `status` se setea sólo a la creación
    //       y no se flipa automáticamente cuando expira la ventana —
    //       sólo si admin la cierra manualmente. Por lo tanto, además de
    //       filtrar por `status == 'open'`, descartamos a nivel
    //       aplicación las que ya pasaron `closeAt` (las tratamos como
    //       cerradas implícitamente y caemos al snapshot cerrado más
    //       reciente). Esto cubre los dos casos:
    //         - admin la cerró → status flipped → no aparece como activa
    //         - venció la ventana → status sigue 'open' pero filtramos
    //
    //   #2: La consulta `where('status', '==', X).orderBy('openAt'/'closeAt')`
    //       requiere índice compuesto en Firestore. Si el índice todavía
    //       no se desplegó, el snapshot debe degradar al unordered query
    //       y ordenar en JS (no devolver "snapshot vacío" silencioso, que
    //       hace pensar al admin que el sistema está roto). Ver
    //       isMissingFirestoreIndexError + el fallback unordered abajo.
    const fetchSurveyOrdered = async (
      statusFilter: 'open' | 'closed',
      orderField: 'openAt' | 'closeAt',
    ): Promise<admin.firestore.QueryDocumentSnapshot[] | null> => {
      try {
        const snap = await baseRef
          .where('status', '==', statusFilter)
          .orderBy(orderField, 'desc')
          .limit(10) // pull a few — we'll filter expired open surveys client-side
          .get();
        return snap.docs;
      } catch (err) {
        if (!isMissingFirestoreIndexError(err)) {
          logger.warn?.('sprintK.culturePulse.snapshot.read_failed', err);
          return null;
        }
        logger.warn?.(
          'sprintK.culturePulse.snapshot.missing_index_fallback',
          { statusFilter, orderField, err },
        );
        // Unordered fallback: pull everything with this status, sort in JS.
        try {
          const snap = await baseRef.where('status', '==', statusFilter).get();
          const docs = snap.docs;
          docs.sort((a, b) => {
            const av = String(a.get(orderField) ?? '');
            const bv = String(b.get(orderField) ?? '');
            return bv.localeCompare(av); // desc
          });
          return docs.slice(0, 10);
        } catch (innerErr) {
          logger.warn?.(
            'sprintK.culturePulse.snapshot.unordered_fallback_failed',
            innerErr,
          );
          return null;
        }
      }
    };

    const nowIso = new Date().toISOString();
    let surveyDoc: admin.firestore.QueryDocumentSnapshot | null = null;

    // Codex P2 #2 round 2 (PR #323, line 5318) — Prefer the most recent OPEN
    // survey whose window is CURRENTLY LIVE (openAt <= now < closeAt). The
    // query orders by openAt desc, so a future-scheduled survey (status='open'
    // since closeAt is in the future) would otherwise shadow a currently
    // running one. We must require BOTH:
    //   (a) openAt <= nowIso — the survey has actually started
    //   (b) nowIso < closeAt — the survey has not yet expired
    //
    // Without (a), a survey scheduled for next month appears as the active
    // pulse and the UI shows a CTA the respond endpoint then rejects with
    // `survey_not_open` (line 5611), confusing the user.
    const openDocs = await fetchSurveyOrdered('open', 'openAt');
    if (openDocs && openDocs.length > 0) {
      const liveOpen = openDocs.find((d) => {
        const openAt = d.get('openAt');
        const closeAt = d.get('closeAt');
        return (
          typeof openAt === 'string' &&
          typeof closeAt === 'string' &&
          openAt <= nowIso &&
          nowIso < closeAt
        );
      });
      surveyDoc = liveOpen ?? null;
    }

    // Fallback to the most recent closed snapshot (admin-closed OR expired).
    if (!surveyDoc) {
      const closedDocs = await fetchSurveyOrdered('closed', 'closeAt');
      if (closedDocs && closedDocs.length > 0) {
        surveyDoc = closedDocs[0];
      } else {
        // Last-resort fallback: an "open" survey whose window has ALREADY
        // PASSED (closeAt < now) but admin never flipped status — surface it
        // as last snapshot so the dashboard isn't blank. We treat it as
        // 'closed' in the response. We do NOT surface future-scheduled
        // surveys here (openAt > now) because those have never collected
        // responses and a blank "open" banner would be misleading.
        if (openDocs && openDocs.length > 0) {
          const expired = openDocs.find((d) => {
            const closeAt = d.get('closeAt');
            return typeof closeAt === 'string' && closeAt <= nowIso;
          });
          if (expired) surveyDoc = expired;
        }
      }
    }

    const emptySnapshot: CulturePulseSnapshot = {
      surveyId: null,
      status: null,
      openAt: null,
      closeAt: null,
      cultureIndex: 0,
      level: 'low',
      totalResponses: 0,
      expectedRespondents: null,
      participationRate: null,
      punitiveCulturedFlagged: false,
      byQuestion: {
        felt_safe_today: 0,
        manager_listens: 0,
        free_to_stop: 0,
        reported_incident_safely: 0,
        has_resources_to_be_safe: 0,
      },
      topConcerns: [],
      topStrengths: [],
      hasResponded: false,
    };

    if (!surveyDoc) {
      return res.json({ snapshot: emptySnapshot });
    }

    const survey = surveyDoc.data() as Omit<StoredPulseSurvey, 'id'>;
    const surveyId = surveyDoc.id;

    // Codex P1 #1 + P2 #2 round 2 (PR #323, line 5318) — Determine the
    // effective status. Required conditions for "open":
    //   - persisted status === 'open' (admin hasn't explicitly closed)
    //   - openAt has been reached (the wave has started)
    //   - closeAt has NOT been reached (the wave hasn't expired)
    //
    // Without the openAt check, a future-scheduled wave appears as the
    // active pulse with a CTA the respond endpoint then rejects with
    // `survey_not_open`. Without the closeAt check, expired waves keep
    // showing the response CTA. Both must be enforced at read time —
    // never trust the persisted creation-time status alone.
    const effectiveStatus: 'open' | 'closed' =
      survey.status === 'open' &&
      survey.openAt <= nowIso &&
      nowIso < survey.closeAt
        ? 'open'
        : 'closed';

    // Read all responses for aggregation.
    const responsesSnap = await safeRead<admin.firestore.QuerySnapshot | null>(
      () => baseRef.doc(surveyId).collection('responses').get(),
      null,
    );

    const responses =
      responsesSnap?.docs.map((d) => d.data() as StoredPulseResponse) ?? [];

    const callerHash = pulseResponderHash(callerUid, surveyId);
    const responderHashes = new Set(responses.map((r) => r.responderHash));
    const hasResponded = responderHashes.has(callerHash);

    const expectedRespondentsOut: number | null =
      typeof survey.expectedRespondents === 'number'
        ? survey.expectedRespondents
        : null;

    // ──────────────────────────────────────────────────────────────────
    // Codex P1 #3 (PR #323, line 5304) — PRIVACIDAD: umbral de anonimato.
    //
    // Si el conteo de respuestas es menor a PULSE_ANONYMITY_THRESHOLD (5),
    // suprimimos TODO agregado derivado (cultureIndex, level, byQuestion,
    // topConcerns, topStrengths, punitiveCulturedFlagged, participationRate).
    // Estos agregados con n<5 son trivialmente reversibles:
    //   - n=1: el promedio ES la respuesta del trabajador.
    //   - n=2-4: si un atacante conoce a un solo respondedor (ej.: él
    //     mismo respondió), puede restar su respuesta del promedio y
    //     derivar respuestas individuales del resto.
    //   - Un "top concern" con texto identificable (ej.: "supervisor X")
    //     en un grupo de 4 trabajadores re-identifica al disidente.
    //
    // Estado de la encuesta + conteo + flag de anonimato + `hasResponded`
    // SÍ se exponen porque no permiten re-identificación: indican
    // existencia y participación a nivel de actividad, no contenido.
    //
    // La directiva del producto ("Responses MUST be anonymous") aplica
    // por encima del control de acceso (guard sólo verifica membresía
    // de proyecto; cualquier miembro de la cuadrilla puede cargar este
    // snapshot, así que el endpoint no puede asumir que el lector sea
    // alguien autorizado a ver señales identificables).
    // ──────────────────────────────────────────────────────────────────
    if (responses.length < PULSE_ANONYMITY_THRESHOLD) {
      const suppressedSnapshot: CulturePulseSnapshot = {
        surveyId,
        status: effectiveStatus,
        openAt: survey.openAt,
        closeAt: survey.closeAt,
        cultureIndex: 0,
        level: 'low',
        totalResponses: responses.length,
        expectedRespondents: expectedRespondentsOut,
        participationRate: null,
        punitiveCulturedFlagged: false,
        byQuestion: {
          felt_safe_today: 0,
          manager_listens: 0,
          free_to_stop: 0,
          reported_incident_safely: 0,
          has_resources_to_be_safe: 0,
        },
        topConcerns: [],
        topStrengths: [],
        hasResponded,
        insufficientResponses: true,
        currentCount: responses.length,
        threshold: PULSE_ANONYMITY_THRESHOLD,
      };
      return res.json({ snapshot: suppressedSnapshot });
    }

    // n ≥ threshold — safe to surface aggregates.
    const index = computePulseIndex(responses);

    // Top concerns: questions with lowest avg. Top strengths: top.
    const ranked = (Object.keys(index.byQuestion) as PulseQuestionKey[])
      .map((k) => ({ key: k, label: PULSE_QUESTION_LABEL[k], score: index.byQuestion[k] }))
      .filter((r) => r.score > 0); // 0 only happens for empty surveys
    const sortedAsc = [...ranked].sort((a, b) => a.score - b.score);
    const sortedDesc = [...ranked].sort((a, b) => b.score - a.score);

    const participationRate =
      typeof survey.expectedRespondents === 'number' && survey.expectedRespondents > 0
        ? Math.min(1, responses.length / survey.expectedRespondents)
        : null;

    const snapshot: CulturePulseSnapshot = {
      surveyId,
      status: effectiveStatus,
      openAt: survey.openAt,
      closeAt: survey.closeAt,
      cultureIndex: index.cultureIndex,
      level: index.level,
      totalResponses: index.totalResponses,
      expectedRespondents: expectedRespondentsOut,
      participationRate,
      punitiveCulturedFlagged: index.punitiveCulturedFlagged,
      byQuestion: index.byQuestion,
      topConcerns: sortedAsc.slice(0, 5),
      topStrengths: sortedDesc.slice(0, 5),
      hasResponded,
    };

    return res.json({ snapshot });
  } catch (err) {
    logger.error?.('sprintK.culturePulse.snapshot.error', err);
    captureRouteError(err, 'sprintK.culturePulse.snapshot');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const culturePulseScheduleSchema = z
  .object({
    surveyId: z
      .string()
      .min(3)
      .max(120)
      // Restrict to filesystem-safe characters to avoid surprising
      // Firestore behaviour with `/` (sub-collection escape).
      .regex(/^[a-zA-Z0-9_-]+$/),
    openAt: z.string().min(10),
    closeAt: z.string().min(10),
    title: z.string().min(1).max(200).optional(),
    expectedRespondents: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.openAt < v.closeAt, {
    message: 'closeAt must be after openAt',
    path: ['closeAt'],
  });

// Codex P2 (PR #323, line 5343) — schedule de encuesta es admin-only.
// El UI sólo expone "Nueva encuesta" si `isAdmin`, pero la ruta sólo
// chequeaba membresía de proyecto vía `guard`, así que cualquier worker
// autenticado podía POSTear directo y alterar el dashboard de cultura
// (crear encuestas falsas, manipular conteos, "responder" la propia).
// Replicamos el patrón de PR #313/#319 P1 #1: `callerHasSupervisorRole`
// incluye admin/prevencionista/supervisor — el conjunto autorizado a
// programar olas de pulso de cultura.
const CULTURE_PULSE_SCHEDULE_ROLES = Array.from(QR_SIG_CHALLENGE_ROLES);

router.post(
  '/:projectId/culture-pulse/survey',
  verifyAuth,
  validate(culturePulseScheduleSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof culturePulseScheduleSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    // Codex P2 (PR #323, line 5343) — role gate después de guard
    // (guard ya verificó membresía/tenant). Sin esto, cualquier worker
    // del proyecto podía crear/borrar encuestas vía POST directo.
    if (!callerHasSupervisorRole(req)) {
      return res
        .status(403)
        .json({ error: 'forbidden_role', allowed: CULTURE_PULSE_SCHEDULE_ROLES });
    }
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/culture_pulse`)
        .doc(body.surveyId);

      const existing = await docRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: 'survey_already_exists' });
      }

      const now = new Date().toISOString();
      const status: 'open' | 'closed' =
        body.closeAt > now ? 'open' : 'closed';

      const payload: StoredPulseSurvey = {
        id: body.surveyId,
        status,
        openAt: body.openAt,
        closeAt: body.closeAt,
        title: body.title,
        expectedRespondents: body.expectedRespondents,
        createdAt: now,
        createdBy: callerUid,
      };

      // Strip undefined fields — Firestore rejects them.
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await docRef.set(cleaned, { merge: false });
      return res.status(201).json({ ok: true, survey: payload });
    } catch (err) {
      logger.error?.('sprintK.culturePulse.schedule.error', err);
      captureRouteError(err, 'sprintK.culturePulse.schedule');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const culturePulseResponseSchema = z.object({
  workerRole: z.string().min(1).max(120),
  area: z.string().min(1).max(120),
  answers: z.object({
    felt_safe_today: z.number().int().min(1).max(5),
    manager_listens: z.number().int().min(1).max(5),
    free_to_stop: z.number().int().min(1).max(5),
    reported_incident_safely: z.number().int().min(1).max(5),
    has_resources_to_be_safe: z.number().int().min(1).max(5),
  }),
});

router.post(
  '/:projectId/culture-pulse/survey/:id/respond',
  verifyAuth,
  validate(culturePulseResponseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id: surveyId } = req.params;
    const body = req.body as z.infer<typeof culturePulseResponseSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const surveyRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/culture_pulse`)
        .doc(surveyId);

      const surveySnap = await surveyRef.get();
      if (!surveySnap.exists) {
        return res.status(404).json({ error: 'survey_not_found' });
      }
      const survey = surveySnap.data() as Omit<StoredPulseSurvey, 'id'>;
      const now = new Date().toISOString();
      if (survey.status === 'closed' || now > survey.closeAt) {
        return res.status(409).json({ error: 'survey_closed' });
      }
      if (now < survey.openAt) {
        return res.status(409).json({ error: 'survey_not_open' });
      }

      // PRIVACY: the response doc is keyed by responder hash so the
      // same worker can only respond once per survey. We never store
      // `responderUid` on the doc. The hash is deterministic and
      // one-way for any outside observer.
      const responderHash = pulseResponderHash(callerUid, surveyId);
      const responseRef = surveyRef.collection('responses').doc(responderHash);

      const existing = await responseRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: 'already_responded' });
      }

      const responsePayload: StoredPulseResponse = {
        responderHash,
        workerRole: body.workerRole,
        area: body.area,
        answers: body.answers,
        submittedAt: now,
      };
      await responseRef.set(responsePayload);
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('sprintK.culturePulse.respond.error', err);
      captureRouteError(err, 'sprintK.culturePulse.respond');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

interface CulturePulseHistoryPoint {
  surveyId: string;
  closeAt: string | null;
  openAt: string;
  cultureIndex: number;
  totalResponses: number;
  level: 'low' | 'fair' | 'good' | 'strong';
}

router.get('/:projectId/culture-pulse/history', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { computePulseIndex } = await import(
      '../../services/culturePulse/safetyCulturePulse.js'
    );

    const db = admin.firestore();
    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/culture_pulse`,
    );

    const safeRead = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.('sprintK.culturePulse.history.read_failed', err);
        return fallback;
      }
    };

    // Codex P1 #2 (PR #323, line 5217) — historic query también requiere
    // índice: `culture_pulse.orderBy(openAt desc)` corre dentro de la
    // sub-collection del proyecto, así que un índice single-field debería
    // bastar; pero por defensa, si la consulta falla con
    // FAILED_PRECONDITION caemos al unordered (cuesta más memoria, pero
    // el límite de docs por proyecto es bajo — son olas mensuales/
    // trimestrales, raramente >50 docs).
    const fetchHistoryOrdered = async (): Promise<
      admin.firestore.QueryDocumentSnapshot[]
    > => {
      try {
        const snap = await baseRef.orderBy('openAt', 'desc').limit(6).get();
        return snap.docs;
      } catch (err) {
        if (!isMissingFirestoreIndexError(err)) {
          logger.warn?.('sprintK.culturePulse.history.read_failed', err);
          return [];
        }
        logger.warn?.(
          'sprintK.culturePulse.history.missing_index_fallback',
          err,
        );
        try {
          const snap = await baseRef.get();
          const docs = snap.docs;
          docs.sort((a, b) => {
            const av = String(a.get('openAt') ?? '');
            const bv = String(b.get('openAt') ?? '');
            return bv.localeCompare(av); // desc
          });
          return docs.slice(0, 6);
        } catch (innerErr) {
          logger.warn?.(
            'sprintK.culturePulse.history.unordered_fallback_failed',
            innerErr,
          );
          return [];
        }
      }
    };

    const surveyDocs = await fetchHistoryOrdered();
    const points: CulturePulseHistoryPoint[] = [];
    for (const surveyDoc of surveyDocs) {
      const survey = surveyDoc.data() as Omit<StoredPulseSurvey, 'id'>;
      const responsesSnap = await safeRead<admin.firestore.QuerySnapshot | null>(
        () => surveyDoc.ref.collection('responses').get(),
        null,
      );
      const responses =
        responsesSnap?.docs.map((d) => d.data() as StoredPulseResponse) ?? [];
      // Codex P1 #3 (PR #323, line 5304) — anonimato también en history.
      // Aunque el sparkline sólo expone `cultureIndex` agregado, con
      // n<5 ese índice ES re-identificable; suprimimos el índice y
      // dejamos sólo metadatos de existencia + conteo + nivel neutro.
      const insufficient = responses.length < PULSE_ANONYMITY_THRESHOLD;
      const idx = computePulseIndex(responses);
      points.push({
        surveyId: surveyDoc.id,
        openAt: survey.openAt,
        closeAt: survey.closeAt ?? null,
        cultureIndex: insufficient ? 0 : idx.cultureIndex,
        totalResponses: responses.length,
        level: insufficient ? 'low' : idx.level,
      });
    }

    // Sort ascending (oldest first) for the sparkline.
    points.sort((a, b) => a.openAt.localeCompare(b.openAt));
    return res.json({ history: points });
  } catch (err) {
    logger.error?.('sprintK.culturePulse.history.error', err);
    captureRouteError(err, 'sprintK.culturePulse.history');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Fase §185-190 — Base de Conocimiento + Curador + Obsolescencia
// ────────────────────────────────────────────────────────────────────────
//
// Surface end-to-end para el repositorio de artículos consultables. El
// motor determinístico (`services/knowledgeBase/knowledgeBaseService.ts`)
// ya implementa búsqueda léxica con scoring, detector de obsolescencia
// (stale/low_engagement/low_rating/manually_flagged) y métricas de
// reutilización. Estos endpoints exponen lectura/escritura sobre
// Firestore para que la página los consuma:
//
//   GET    /:projectId/knowledge-base?category=X&search=Y
//   POST   /:projectId/knowledge-base
//   POST   /:projectId/knowledge-base/:id/use
//   POST   /:projectId/knowledge-base/:id/flag-obsolete
//
// Diseño:
//
//   - Persistencia: `tenants/{tid}/projects/{pid}/knowledge_base/{id}`.
//     Tenant-scoped para reutilización entre proyectos del mismo tenant,
//     pero filtrado server-side por proyecto seleccionado. Los artículos
//     `sourceType: 'lesson'` permiten enlazar de vuelta a F.12 sin
//     duplicar el almacenamiento.
//
//   - Búsqueda: si la query incluye `?search=foo`, se reusa
//     `searchArticles()` del motor sobre la lista cargada. La búsqueda
//     léxica es 100% client-side al endpoint (Firestore no tiene
//     full-text nativo y queremos mantener el determinismo).
//
//   - Filtro por categoría: `?category=glossary|faq|procedure|guide|
//     norm_summary|lesson|experience|standard|procedure`. El alias
//     `category` se mapea contra el `kind` legacy del motor + nuevos
//     `sourceType` para no romper el SKU del servicio.
//
//   - Mutaciones determinísticas: `/use` incrementa viewCount + bumpea
//     `lastReviewedAt`. `/flag-obsolete` setea `isObsolete=true` con
//     `obsoleteReason` y `obsoleteAt` para auditoría posterior.

const kbCreateSchema = z.object({
  title: z.string().min(3).max(300),
  content: z.string().min(3).max(20_000),
  category: z
    .enum(['glossary', 'faq', 'procedure', 'guide', 'norm_summary'])
    .optional()
    .default('guide'),
  tags: z.array(z.string().min(1).max(100)).max(50).optional().default([]),
  sourceType: z
    .enum(['lesson', 'procedure', 'standard', 'experience'])
    .optional()
    .default('experience'),
});

const kbFlagObsoleteSchema = z.object({
  reason: z.string().min(3).max(2000),
});

router.get('/:projectId/knowledge-base', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const category =
      typeof req.query.category === 'string' && req.query.category.length > 0
        ? req.query.category
        : null;
    const search =
      typeof req.query.search === 'string' && req.query.search.length > 0
        ? req.query.search
        : null;

    // Tenant-scoped collection — entries are reusable across projects
    // of the same tenant. Per the §185-190 spec, knowledge can be
    // shared up; the page filters by category client-side.
    const colRef = db
      .collection('tenants')
      .doc(g.tenantId)
      .collection('projects')
      .doc(projectId)
      .collection('knowledge_base');

    // Best-effort read with graceful degradation; first read tries
    // project-scoped, then falls back to a tenant-level shared store
    // (some tenants seed glossary at tenant root).
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.knowledgeBase.read.${label}.failed`, err);
        return [];
      }
    };

    type KbDoc = {
      id: string;
      kind: 'glossary' | 'faq' | 'procedure' | 'guide' | 'norm_summary';
      title: string;
      content: string;
      tags: string[];
      lastReviewedAt: string;
      viewCount: number;
      averageRating?: number;
      isObsolete: boolean;
      authorUid: string;
      sourceType?: 'lesson' | 'procedure' | 'standard' | 'experience';
      obsoleteReason?: string;
      obsoleteAt?: string;
    };

    const projectEntries = await safeRead<KbDoc>('project', async () => {
      const snap = await colRef.get();
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          kind: (typeof data.kind === 'string' ? data.kind : 'guide') as KbDoc['kind'],
          title: typeof data.title === 'string' ? data.title : '',
          content: typeof data.content === 'string' ? data.content : '',
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          lastReviewedAt:
            typeof data.lastReviewedAt === 'string'
              ? data.lastReviewedAt
              : new Date(0).toISOString(),
          viewCount:
            typeof data.viewCount === 'number' && Number.isFinite(data.viewCount)
              ? data.viewCount
              : 0,
          averageRating:
            typeof data.averageRating === 'number' ? data.averageRating : undefined,
          isObsolete: Boolean(data.isObsolete),
          authorUid: typeof data.authorUid === 'string' ? data.authorUid : 'unknown',
          sourceType:
            typeof data.sourceType === 'string'
              ? (data.sourceType as KbDoc['sourceType'])
              : 'experience',
          obsoleteReason:
            typeof data.obsoleteReason === 'string' ? data.obsoleteReason : undefined,
          obsoleteAt:
            typeof data.obsoleteAt === 'string' ? data.obsoleteAt : undefined,
        };
      });
    });

    // Filter by category — `category` is an alias for `kind` to keep the
    // §185-190 spec's preferred terminology while reusing the engine.
    let entries = projectEntries;
    if (category) {
      entries = entries.filter((e) => e.kind === category);
    }

    // Lexical search via the engine. We pre-filter then search so the
    // category narrows the search-space first.
    if (search) {
      const { searchArticles } = await import(
        '../../services/knowledgeBase/knowledgeBaseService.js'
      );
      const results = searchArticles(entries, search, {
        excludeObsolete: false,
      });
      return res.json({
        entries: results,
        searched: true,
        category: category ?? null,
      });
    }

    return res.json({
      entries,
      searched: false,
      category: category ?? null,
    });
  } catch (err) {
    logger.error?.('sprintK.knowledgeBase.list.error', err);
    captureRouteError(err, 'sprintK.knowledgeBase.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post(
  '/:projectId/knowledge-base',
  verifyAuth,
  validate(kbCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof kbCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const colRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base');

      const now = new Date().toISOString();
      const docRef = colRef.doc();
      const entry = {
        id: docRef.id,
        kind: body.category,
        title: body.title,
        content: body.content,
        tags: body.tags,
        lastReviewedAt: now,
        viewCount: 0,
        isObsolete: false,
        authorUid: callerUid,
        sourceType: body.sourceType,
        createdAt: now,
      };
      await docRef.set(entry);
      return res.status(201).json({ entry });
    } catch (err) {
      logger.error?.('sprintK.knowledgeBase.create.error', err);
      captureRouteError(err, 'sprintK.knowledgeBase.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/knowledge-base/:id/use',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base')
        .doc(id);

      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });

      // Atomic increment via Firestore FieldValue. We also bump
      // `lastReviewedAt` so the obsolescence detector treats actively-
      // used entries as fresh enough to skip the stale gate.
      await docRef.update({
        viewCount: admin.firestore.FieldValue.increment(1),
        lastReviewedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
      });
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.knowledgeBase.use.error', err);
      captureRouteError(err, 'sprintK.knowledgeBase.use');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/knowledge-base/:id/flag-obsolete',
  verifyAuth,
  validate(kbFlagObsoleteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof kbFlagObsoleteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base')
        .doc(id);

      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });

      await docRef.update({
        isObsolete: true,
        obsoleteReason: body.reason,
        obsoleteAt: new Date().toISOString(),
        obsoleteByUid: callerUid,
      });
      return res.status(204).end();
    } catch (err) {
      logger.error?.('sprintK.knowledgeBase.flagObsolete.error', err);
      captureRouteError(err, 'sprintK.knowledgeBase.flagObsolete');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Sprint K §195-200 — Ciclo PDCA + No Conformidades (ISO 45001 §10.2)
// ─────────────────────────────────────────────────────────────────────
//
// Exposes the deterministic PDCA cycle engine (services/pdca/*) over
// HTTP so the page can render a kanban-style Plan/Do/Check/Act board
// linked to non-conformities (NC). Storage:
//
//   tenants/{tid}/projects/{pid}/pdca_cycles/{id}        — PDCAProject
//   tenants/{tid}/projects/{pid}/non_conformities/{id}   — NonConformity
//
// All reads go through `safeRead<T>` so a single collection failure
// (missing index, permissions hiccup) doesn't blank the whole board —
// the panel shows the partial state honestly.
//
// IMPORTANT: this endpoint NEVER pushes to external regulators
// (SUSESO/SII/MINSAL/OSHA). It only persists the cycle so the company
// can later sign + submit on its own surface (Directiva 3 from
// product_signing_no_blocking_directives_2026-05-06).

const pdcaOriginEnum = z.enum(['audit', 'incident', 'finding', 'inspection']);

const pdcaCreateSchema = z.object({
  id: z.string().min(1),
  nonConformityId: z.string().min(1),
  origin: pdcaOriginEnum,
  ownerUid: z.string().min(1),
  notes: z.string().max(4000).optional(),
  startedAt: z.string().min(10).optional(),
});

const pdcaAdvanceSchema = z.object({
  evidence: z.array(z.string().min(1)).min(1).max(50),
  notes: z.string().max(4000).optional(),
  efficacyScore: z.number().min(0).max(100).optional(),
});

const ncCreateSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1).max(200),
  severity: z.enum(['minor', 'major', 'critical']),
  description: z.string().min(3).max(4000),
  location: z.string().min(1).max(400),
  detectedAt: z.string().min(10).optional(),
  taskId: z.string().min(1).optional(),
  responsibleUid: z.string().min(1),
});

/** Internal: safe parallel reader so a single failure doesn't blank the board. */
async function pdcaSafeRead<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    logger.warn?.(`sprintK.pdca.read.${label}.failed`, err);
    return [];
  }
}

// GET /:projectId/pdca/cycles — list active PDCA cycles
router.get('/:projectId/pdca/cycles', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const path = `tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`;
    const cycles = await pdcaSafeRead('cycles', async () => {
      const snap = await db.collection(path).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });
    return res.json({ cycles });
  } catch (err) {
    logger.error?.('sprintK.pdca.list.error', err);
    captureRouteError(err, 'sprintK.pdca.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /:projectId/pdca/cycles — create a new cycle for an NC
router.post(
  '/:projectId/pdca/cycles',
  verifyAuth,
  validate(pdcaCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof pdcaCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const nowIso = body.startedAt ?? new Date().toISOString();
      const project = {
        id: body.id,
        currentStage: 'plan' as const,
        cycleNumber: 1,
        nonConformityId: body.nonConformityId,
        origin: body.origin,
        ownerUid: body.ownerUid,
        createdAt: nowIso,
        createdByUid: callerUid,
        stages: [
          {
            kind: 'plan' as const,
            activityId: `${body.id}-cycle-1-plan`,
            notes: body.notes ?? '',
            ownerUid: body.ownerUid,
            startedAt: nowIso,
          },
        ],
      };
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`)
        .doc(body.id)
        .set(project, { merge: false });
      return res.status(201).json({ ok: true, cycle: project });
    } catch (err) {
      logger.error?.('sprintK.pdca.create.error', err);
      captureRouteError(err, 'sprintK.pdca.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// POST /:projectId/pdca/cycles/:id/advance — advance to the next stage
router.post(
  '/:projectId/pdca/cycles/:id/advance',
  verifyAuth,
  validate(pdcaAdvanceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof pdcaAdvanceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { advanceStage } = await import(
        '../../services/pdca/pdcaCycleEngine.js'
      );
      type PdcaStage = 'plan' | 'do' | 'check' | 'act';
      interface PdcaEntry {
        kind: PdcaStage;
        activityId: string;
        notes: string;
        ownerUid: string;
        startedAt: string;
        completedAt?: string;
        evidence?: string[];
        efficacyScore?: number;
      }
      interface StoredCycle {
        id: string;
        currentStage: PdcaStage;
        stages: PdcaEntry[];
        cycleNumber: number;
        nonConformityId?: string;
        origin?: string;
        ownerUid?: string;
        createdAt?: string;
        createdByUid?: string;
      }
      const db = admin.firestore();
      const ref = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`)
        .doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'cycle_not_found' });
      }
      const stored = snap.data() as StoredCycle;
      const nowIso = new Date().toISOString();

      // Close the current stage with the supplied notes/efficacyScore
      // before handing off to the engine — `advanceStage` requires the
      // last entry to carry `completedAt`.
      const stages = [...(stored.stages ?? [])];
      let lastIdx = -1;
      for (let i = stages.length - 1; i >= 0; i--) {
        if (stages[i].kind === stored.currentStage) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx < 0) {
        return res.status(400).json({ error: 'no_entry_for_current_stage' });
      }
      const closed: PdcaEntry = {
        ...stages[lastIdx],
        completedAt: nowIso,
        notes: body.notes ?? stages[lastIdx].notes,
      };
      if (
        stored.currentStage === 'act' &&
        typeof body.efficacyScore === 'number'
      ) {
        closed.efficacyScore = body.efficacyScore;
      }
      stages[lastIdx] = closed;

      const result = advanceStage(
        {
          id: stored.id,
          currentStage: stored.currentStage,
          stages,
          cycleNumber: stored.cycleNumber,
        },
        body.evidence,
        nowIso,
      );
      if (!result.advanced) {
        return res.status(400).json({
          error: 'cannot_advance',
          reason: result.reason ?? 'unknown',
        });
      }
      const merged: StoredCycle = {
        ...stored,
        currentStage: result.project.currentStage,
        stages: result.project.stages as PdcaEntry[],
        cycleNumber: result.project.cycleNumber,
      };
      await ref.set(merged, { merge: false });
      return res.json({ ok: true, cycle: merged });
    } catch (err) {
      logger.error?.('sprintK.pdca.advance.error', err);
      captureRouteError(err, 'sprintK.pdca.advance');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// GET /:projectId/pdca/non-conformities — list NCs feeding the cycles
router.get(
  '/:projectId/pdca/non-conformities',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const path = `tenants/${g.tenantId}/projects/${projectId}/non_conformities`;
      const ncs = await pdcaSafeRead('non_conformities', async () => {
        const snap = await db.collection(path).get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      });
      return res.json({ nonConformities: ncs });
    } catch (err) {
      logger.error?.('sprintK.pdca.nc.list.error', err);
      captureRouteError(err, 'sprintK.pdca.nc.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// POST /:projectId/pdca/non-conformities — create a NC inline
router.post(
  '/:projectId/pdca/non-conformities',
  verifyAuth,
  validate(ncCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof ncCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const nc = {
        id: body.id,
        category: body.category,
        severity: body.severity,
        description: body.description,
        location: body.location,
        detectedAt: body.detectedAt ?? new Date().toISOString(),
        taskId: body.taskId,
        responsibleUid: body.responsibleUid,
        status: 'open' as const,
        createdByUid: callerUid,
      };
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/non_conformities`,
        )
        .doc(body.id)
        .set(nc, { merge: false });
      return res.status(201).json({ ok: true, nonConformity: nc });
    } catch (err) {
      logger.error?.('sprintK.pdca.nc.create.error', err);
      captureRouteError(err, 'sprintK.pdca.nc.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// GET /:projectId/pdca/summary — counts per phase + closure rate
router.get('/:projectId/pdca/summary', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    type PdcaStage = 'plan' | 'do' | 'check' | 'act';
    interface StoredCycleRow {
      id: string;
      currentStage?: PdcaStage;
      stages?: Array<{ kind: PdcaStage; completedAt?: string }>;
      cycleNumber?: number;
    }
    const db = admin.firestore();
    const cyclesPath = `tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`;
    const cycles = await pdcaSafeRead<StoredCycleRow>('cycles', async () => {
      const snap = await db.collection(cyclesPath).get();
      return snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as StoredCycleRow,
      );
    });

    const byPhase: Record<PdcaStage, number> = {
      plan: 0,
      do: 0,
      check: 0,
      act: 0,
    };
    let closedCycles = 0;
    for (const c of cycles) {
      const stage: PdcaStage = (c.currentStage ?? 'plan') as PdcaStage;
      byPhase[stage] = (byPhase[stage] ?? 0) + 1;
      // A cycle is "closed" when at least one full P→D→C→A round
      // completed (cycleNumber > 1 OR the act stage has a completedAt).
      const hasCompletedAct = (c.stages ?? []).some(
        (s) => s.kind === 'act' && !!s.completedAt,
      );
      if ((c.cycleNumber ?? 1) > 1 || hasCompletedAct) closedCycles += 1;
    }
    const total = cycles.length;
    const closureRate =
      total > 0 ? Math.round((closedCycles / total) * 100) : 0;

    return res.json({
      summary: {
        total,
        byPhase,
        closedCycles,
        closureRate,
      },
    });
  } catch (err) {
    logger.error?.('sprintK.pdca.summary.error', err);
    captureRouteError(err, 'sprintK.pdca.summary');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Sprint K §90-91 — Calidad de Proveedores + Ranking de Riesgo
// ────────────────────────────────────────────────────────────────────────
//
// Endpoints HTTP que exponen el motor determinístico de scoring de
// proveedores/contratistas (`supplierScoring.ts`) + calidad SLA
// (`supplierQualityService.ts`).

const supplierRiskLevels = ['low', 'medium', 'high'] as const;
type SupplierRiskLevel = (typeof supplierRiskLevels)[number];

interface StoredSupplierIncident {
  id: string;
  occurredAt: string;
  severity: 'near_miss' | 'incident';
  description: string;
  recordedByUid: string;
}

interface StoredSupplierAudit {
  id: string;
  auditedAt: string;
  documentComplianceRatio: number;
  avgResponseHours: number;
  reputationScore: number;
  notes?: string;
  recordedByUid: string;
}

interface StoredSupplier {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  registeredByUid: string;
  incidents: StoredSupplierIncident[];
  audits: StoredSupplierAudit[];
}

function latestAudit(audits: StoredSupplierAudit[]): StoredSupplierAudit | null {
  if (audits.length === 0) return null;
  const sorted = [...audits].sort((a, b) => b.auditedAt.localeCompare(a.auditedAt));
  return sorted[0];
}

function latestIncidentAt(incidents: StoredSupplierIncident[]): string | null {
  if (incidents.length === 0) return null;
  return incidents
    .map((i) => i.occurredAt)
    .sort((a, b) => b.localeCompare(a))[0];
}

function deriveKpis(s: StoredSupplier, now: number = Date.now()): SupplierKpis {
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(now - TWELVE_MONTHS_MS).toISOString();
  const recent = s.incidents.filter((i) => i.occurredAt >= cutoffIso);
  const incidents = recent.filter((i) => i.severity === 'incident').length;
  const nearMisses = recent.filter((i) => i.severity === 'near_miss').length;
  const audit = latestAudit(s.audits);
  const documentComplianceRatio = audit ? audit.documentComplianceRatio : 0.5;
  const avgResponseHours = audit ? audit.avgResponseHours : 24;
  const reputationScore = audit ? audit.reputationScore : 0.5;
  return {
    incidents,
    nearMisses,
    documentComplianceRatio,
    avgResponseHours,
    reputationScore,
  };
}

function riskLevelForScore(score: number): SupplierRiskLevel {
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

function deriveTrend(s: StoredSupplier, now: number = Date.now()): 'improving' | 'stable' | 'worsening' {
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const recentCut = new Date(now - TWELVE_MONTHS_MS).toISOString();
  const priorCut = new Date(now - 2 * TWELVE_MONTHS_MS).toISOString();
  const recent = s.incidents.filter((i) => i.occurredAt >= recentCut).length;
  const prior = s.incidents.filter(
    (i) => i.occurredAt >= priorCut && i.occurredAt < recentCut,
  ).length;
  if (recent < prior) return 'improving';
  if (recent > prior) return 'worsening';
  return 'stable';
}

interface SupplierView {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  score: number;
  riskLevel: SupplierRiskLevel;
  trend: 'improving' | 'stable' | 'worsening';
  lastIncidentAt: string | null;
  lastAuditAt: string | null;
  incidentCount: number;
  auditCount: number;
}

function toView(s: StoredSupplier): SupplierView {
  const kpis = deriveKpis(s);
  const record: SupplierRecord = { id: s.id, legalName: s.legalName, kpis };
  let scored: ScoredSupplier;
  try {
    scored = scoreSupplier(record);
  } catch {
    scored = {
      id: s.id,
      legalName: s.legalName,
      score: 0,
      breakdown: {
        safetyPerformance: 0,
        documentCompliance: 0,
        responsiveness: 0,
        reputation: 0,
      },
    };
  }
  const audit = latestAudit(s.audits);
  return {
    id: s.id,
    legalName: s.legalName,
    taxId: s.taxId,
    services: s.services,
    criticalRoles: s.criticalRoles,
    active: s.active,
    registeredAt: s.registeredAt,
    score: scored.score,
    riskLevel: riskLevelForScore(scored.score),
    trend: deriveTrend(s),
    lastIncidentAt: latestIncidentAt(s.incidents),
    lastAuditAt: audit ? audit.auditedAt : null,
    incidentCount: s.incidents.length,
    auditCount: s.audits.length,
  };
}

async function readSuppliers(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
): Promise<StoredSupplier[]> {
  const snap = await db
    .collection(`tenants/${tenantId}/projects/${projectId}/suppliers`)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      legalName: typeof data.legalName === 'string' ? data.legalName : '',
      taxId: typeof data.taxId === 'string' ? data.taxId : '',
      services: Array.isArray(data.services)
        ? (data.services as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      criticalRoles: Array.isArray(data.criticalRoles)
        ? (data.criticalRoles as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
      active: typeof data.active === 'boolean' ? data.active : true,
      registeredAt:
        typeof data.registeredAt === 'string' ? data.registeredAt : new Date(0).toISOString(),
      registeredByUid:
        typeof data.registeredByUid === 'string' ? data.registeredByUid : 'unknown',
      incidents: Array.isArray(data.incidents)
        ? (data.incidents as StoredSupplierIncident[])
        : [],
      audits: Array.isArray(data.audits)
        ? (data.audits as StoredSupplierAudit[])
        : [],
    } as StoredSupplier;
  });
}

const supplierListQuerySchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high', 'all']).optional(),
});

router.get('/:projectId/suppliers', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const parsed = supplierListQuerySchema.safeParse({
    riskLevel: typeof req.query.riskLevel === 'string' ? req.query.riskLevel : undefined,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query' });
  }
  const filter = parsed.data.riskLevel ?? 'all';
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.suppliers.read.${label}.failed`, err);
        return [];
      }
    };
    const stored = await safeRead('suppliers', () =>
      readSuppliers(admin.firestore(), g.tenantId, projectId),
    );
    const views = stored.map(toView);
    const filtered =
      filter === 'all' ? views : views.filter((s) => s.riskLevel === filter);
    return res.json({ suppliers: filtered, total: views.length });
  } catch (err) {
    logger.error?.('sprintK.suppliers.list.error', err);
    captureRouteError(err, 'sprintK.suppliers.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const supplierCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(2).max(200),
  taxId: z.string().min(2).max(40),
  services: z.array(z.string().min(1).max(80)).min(1).max(40),
  criticalRoles: z.array(z.string().min(1).max(120)).max(40).optional(),
  active: z.boolean().optional(),
});

router.post(
  '/:projectId/suppliers',
  verifyAuth,
  validate(supplierCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof supplierCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const collection = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/suppliers`,
      );
      const docRef = body.id ? collection.doc(body.id) : collection.doc();
      const supplier: StoredSupplier = {
        id: docRef.id,
        legalName: body.name,
        taxId: body.taxId,
        services: body.services,
        criticalRoles: body.criticalRoles ?? [],
        active: body.active ?? true,
        registeredAt: new Date().toISOString(),
        registeredByUid: callerUid,
        incidents: [],
        audits: [],
      };
      await docRef.set(supplier, { merge: false });
      return res.status(201).json({ ok: true, supplier: toView(supplier) });
    } catch (err) {
      logger.error?.('sprintK.suppliers.create.error', err);
      captureRouteError(err, 'sprintK.suppliers.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const supplierIncidentSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  occurredAt: z.string().min(10).max(40),
  severity: z.enum(['near_miss', 'incident']),
  description: z.string().min(3).max(2000),
});

router.post(
  '/:projectId/suppliers/:id/incidents',
  verifyAuth,
  validate(supplierIncidentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof supplierIncidentSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/suppliers`)
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'supplier_not_found' });
      }
      const data = snap.data() as Partial<StoredSupplier>;
      const incidents = Array.isArray(data.incidents) ? data.incidents : [];
      const entry: StoredSupplierIncident = {
        id: body.id ?? db.collection('_ids').doc().id,
        occurredAt: body.occurredAt,
        severity: body.severity,
        description: body.description,
        recordedByUid: callerUid,
      };
      await docRef.set(
        {
          incidents: [...incidents, entry],
          lastIncidentAt: entry.occurredAt,
        },
        { merge: true },
      );
      return res.status(201).json({ ok: true, incident: entry });
    } catch (err) {
      logger.error?.('sprintK.suppliers.incident.error', err);
      captureRouteError(err, 'sprintK.suppliers.incident');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const supplierAuditSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  auditedAt: z.string().min(10).max(40),
  documentComplianceRatio: z.number().min(0).max(1),
  avgResponseHours: z.number().min(0).max(720),
  reputationScore: z.number().min(0).max(1),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/suppliers/:id/audits',
  verifyAuth,
  validate(supplierAuditSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof supplierAuditSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/suppliers`)
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'supplier_not_found' });
      }
      const data = snap.data() as Partial<StoredSupplier>;
      const audits = Array.isArray(data.audits) ? data.audits : [];
      const entry: StoredSupplierAudit = {
        id: body.id ?? db.collection('_ids').doc().id,
        auditedAt: body.auditedAt,
        documentComplianceRatio: body.documentComplianceRatio,
        avgResponseHours: body.avgResponseHours,
        reputationScore: body.reputationScore,
        notes: body.notes,
        recordedByUid: callerUid,
      };
      await docRef.set(
        {
          audits: [...audits, entry],
          lastAuditAt: entry.auditedAt,
        },
        { merge: true },
      );
      return res.status(201).json({ ok: true, audit: entry });
    } catch (err) {
      logger.error?.('sprintK.suppliers.audit.error', err);
      captureRouteError(err, 'sprintK.suppliers.audit');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get('/:projectId/suppliers/ranking', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.suppliers.read.${label}.failed`, err);
        return [];
      }
    };
    const stored = await safeRead('suppliers_ranking', () =>
      readSuppliers(admin.firestore(), g.tenantId, projectId),
    );
    if (stored.length === 0) {
      return res.json({ ranking: [], total: 0 });
    }
    const records: SupplierRecord[] = stored.map((s) => ({
      id: s.id,
      legalName: s.legalName,
      kpis: deriveKpis(s),
    }));
    const scored = rankSuppliersByScore(records);
    const byId = new Map(stored.map((s) => [s.id, s]));
    const ranking = scored.map((sc, idx) => {
      const s = byId.get(sc.id)!;
      const view = toView(s);
      return {
        rank: idx + 1,
        ...view,
        breakdown: sc.breakdown,
      };
    });
    return res.json({ ranking, total: ranking.length });
  } catch (err) {
    logger.error?.('sprintK.suppliers.ranking.error', err);
    captureRouteError(err, 'sprintK.suppliers.ranking');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Sprint K §291-295 — Revisión Anual del SGI (ISO 45001 §9.3)
// ────────────────────────────────────────────────────────────────────────

const annualReviewPath = (tenantId: string, projectId: string, year: number) =>
  `tenants/${tenantId}/projects/${projectId}/annual_reviews/${year}`;

const objectiveInputSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  description: z.string().max(4000).default(''),
  metric: z.enum([
    'count_reduction',
    'count_increase',
    'percent_completion',
    'percent_reduction',
  ]),
  baseline: z.number().finite(),
  target: z.number().finite(),
  currentValue: z.number().finite().default(0),
  deadline: z.string().min(10),
  ownerUid: z.string().min(1).max(200),
  status: z
    .enum(['planned', 'in_progress', 'on_track', 'at_risk', 'achieved', 'missed'])
    .default('planned'),
  linkedActionIds: z.array(z.string().min(1)).max(500).default([]),
  evidenceUrls: z.array(z.string().min(1)).max(500).default([]),
});

const setObjectivesSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  objectives: z.array(objectiveInputSchema).max(200),
});

const evidenceSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  objectiveId: z.string().min(1).max(200),
  evidenceUrl: z.string().min(1).max(2000),
  evidenceKind: z
    .enum(['document', 'audit', 'incident', 'training', 'other'])
    .default('other'),
  caption: z.string().max(500).optional(),
});

const concludeSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  conclusion: z.string().min(10).max(8000),
  signedOffByUid: z.string().min(1).max(200),
  signedOffByName: z.string().min(1).max(300),
});

interface AnnualReviewEvidence {
  objectiveId: string;
  evidenceUrl: string;
  evidenceKind: 'document' | 'audit' | 'incident' | 'training' | 'other';
  caption?: string;
  attachedAt: string;
  attachedByUid: string;
}

interface AnnualReviewSnapshot {
  fiscalYear: number;
  tenantId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  updatedByUid: string;
  objectives: import('../../services/annualReview/annualSgiReview.js').PreventiveObjective[];
  evidences: AnnualReviewEvidence[];
  analysis: string;
  conclusion: string | null;
  signedOffByUid: string | null;
  signedOffByName: string | null;
  concludedAt: string | null;
  isConcluded: boolean;
}

function defaultSnapshot(
  tenantId: string,
  projectId: string,
  year: number,
  uid: string,
): AnnualReviewSnapshot {
  const now = new Date().toISOString();
  return {
    fiscalYear: year,
    tenantId,
    projectId,
    createdAt: now,
    updatedAt: now,
    updatedByUid: uid,
    objectives: [],
    evidences: [],
    analysis: '',
    conclusion: null,
    signedOffByUid: null,
    signedOffByName: null,
    concludedAt: null,
    isConcluded: false,
  };
}

router.get(
  '/:projectId/annual-review/current',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const yearParam =
        typeof req.query.year === 'string' ? Number.parseInt(req.query.year, 10) : NaN;
      const year =
        Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
          ? yearParam
          : new Date().getUTCFullYear();
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, year));
      const safeRead = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.annualReview.read.${label}.failed`, err);
          return null;
        }
      };
      const snap = await safeRead('snapshot', async () => ref.get());
      const exists = snap?.exists ?? false;
      const snapshot: AnnualReviewSnapshot | null = exists
        ? ((snap!.data() as AnnualReviewSnapshot) ?? null)
        : null;
      return res.json({ year, exists, snapshot });
    } catch (err) {
      logger.error?.('sprintK.annualReview.current.error', err);
      captureRouteError(err, 'sprintK.annualReview.current');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/annual-review/objectives',
  verifyAuth,
  validate(setObjectivesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof setObjectivesSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, body.year));
      const snap = await ref.get();
      const existing = snap.exists
        ? (snap.data() as AnnualReviewSnapshot)
        : defaultSnapshot(g.tenantId, projectId, body.year, callerUid);
      if (existing.isConcluded) {
        return res.status(409).json({ error: 'review_already_concluded' });
      }
      const objectives = body.objectives.map((o) => ({
        id: o.id,
        fiscalYear: body.year,
        title: o.title,
        description: o.description,
        metric: o.metric,
        baseline: o.baseline,
        target: o.target,
        currentValue: o.currentValue,
        deadline: o.deadline,
        ownerUid: o.ownerUid,
        status: o.status,
        linkedActionIds: o.linkedActionIds,
        evidenceUrls: o.evidenceUrls,
      }));
      const next: AnnualReviewSnapshot = {
        ...existing,
        objectives,
        analysis:
          typeof (req.body as Record<string, unknown>).analysis === 'string'
            ? ((req.body as Record<string, unknown>).analysis as string).slice(0, 8000)
            : existing.analysis,
        updatedAt: new Date().toISOString(),
        updatedByUid: callerUid,
      };
      await ref.set(next, { merge: false });
      return res.status(200).json({ ok: true, snapshot: next });
    } catch (err) {
      logger.error?.('sprintK.annualReview.objectives.error', err);
      captureRouteError(err, 'sprintK.annualReview.objectives');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/annual-review/evidence',
  verifyAuth,
  validate(evidenceSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evidenceSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, body.year));
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'review_not_found' });
      }
      const existing = snap.data() as AnnualReviewSnapshot;
      if (existing.isConcluded) {
        return res.status(409).json({ error: 'review_already_concluded' });
      }
      const obj = existing.objectives.find((o) => o.id === body.objectiveId);
      if (!obj) {
        return res.status(404).json({ error: 'objective_not_found' });
      }
      const now = new Date().toISOString();
      const newEvidence: AnnualReviewEvidence = {
        objectiveId: body.objectiveId,
        evidenceUrl: body.evidenceUrl,
        evidenceKind: body.evidenceKind,
        caption: body.caption,
        attachedAt: now,
        attachedByUid: callerUid,
      };
      const isDup = existing.evidences.some(
        (e) =>
          e.objectiveId === newEvidence.objectiveId &&
          e.evidenceUrl === newEvidence.evidenceUrl,
      );
      const nextEvidences = isDup
        ? existing.evidences
        : [...existing.evidences, newEvidence];
      const nextObjectives = existing.objectives.map((o) => {
        if (o.id !== body.objectiveId) return o;
        if (o.evidenceUrls.includes(body.evidenceUrl)) return o;
        return { ...o, evidenceUrls: [...o.evidenceUrls, body.evidenceUrl] };
      });
      const next: AnnualReviewSnapshot = {
        ...existing,
        objectives: nextObjectives,
        evidences: nextEvidences,
        updatedAt: now,
        updatedByUid: callerUid,
      };
      await ref.set(next, { merge: false });
      return res.status(200).json({ ok: true, snapshot: next });
    } catch (err) {
      logger.error?.('sprintK.annualReview.evidence.error', err);
      captureRouteError(err, 'sprintK.annualReview.evidence');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/annual-review/conclude',
  verifyAuth,
  validate(concludeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof concludeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, body.year));
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'review_not_found' });
      }
      const existing = snap.data() as AnnualReviewSnapshot;
      if (existing.isConcluded) {
        return res.status(409).json({ error: 'review_already_concluded' });
      }
      const now = new Date().toISOString();
      const next: AnnualReviewSnapshot = {
        ...existing,
        conclusion: body.conclusion,
        signedOffByUid: body.signedOffByUid,
        signedOffByName: body.signedOffByName,
        concludedAt: now,
        isConcluded: true,
        updatedAt: now,
        updatedByUid: callerUid,
      };
      await ref.set(next, { merge: false });
      return res.status(200).json({ ok: true, snapshot: next });
    } catch (err) {
      logger.error?.('sprintK.annualReview.conclude.error', err);
      captureRouteError(err, 'sprintK.annualReview.conclude');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// §296-301 Residual Risk migrado a src/server/routes/residualRisk.ts (2026-05-18).

// ─────────────────────────────────────────────────────────────────────
// Sprint K §276-277 — Bitácora de Decisiones de Supervisión + Ranking
// ─────────────────────────────────────────────────────────────────────

const SUPERVISION_DECISION_KINDS = [
  'authorize_work',
  'stop_task',
  'change_crew',
  'change_method',
  'reject_unsafe',
  'request_resource',
  'escalate_finding',
  'approve_exception',
  'reject_exception',
] as const;

type LeadershipDecisionKindAPI = (typeof SUPERVISION_DECISION_KINDS)[number];

interface StoredLeadershipDecision {
  id: string;
  supervisorUid: string;
  decidedAt: string;
  kind: LeadershipDecisionKindAPI;
  context: string;
  rationale: string;
  involvedRef?: {
    kind: 'TASK' | 'WORKER' | 'FINDING' | 'EXCEPTION';
    id: string;
  };
  outcome?: {
    positive: boolean;
    description: string;
    recordedAt: string;
  };
  createdAt: string;
  createdBy: string;
}

function periodCutoffIso(period: string | undefined | null): string | null {
  const p = (period ?? '90d').toLowerCase();
  if (p === 'all') return null;
  const DAYS_MS = 24 * 60 * 60 * 1000;
  let days = 90;
  if (p === '30d') days = 30;
  else if (p === '90d') days = 90;
  else if (p === '7d') days = 7;
  else days = 90;
  return new Date(Date.now() - days * DAYS_MS).toISOString();
}

router.get(
  '/:projectId/leadership/decisions',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const supervisorUid =
        typeof req.query.supervisorUid === 'string' && req.query.supervisorUid.length > 0
          ? req.query.supervisorUid
          : null;
      const cutoff = periodCutoffIso(
        typeof req.query.period === 'string' ? req.query.period : '90d',
      );

      const safeRead = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.('sprintK.leadership.decisions.read_failed', err);
          return [];
        }
      };

      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/leadership_decisions`,
      );

      const decisions = await safeRead<StoredLeadershipDecision>(async () => {
        let q: admin.firestore.Query = baseRef;
        if (supervisorUid) q = q.where('supervisorUid', '==', supervisorUid);
        const snap = await q.limit(500).get();
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StoredLeadershipDecision, 'id'>),
        }));
        const filtered = cutoff
          ? items.filter((it) => {
              if (!it.decidedAt) return false;
              return it.decidedAt >= cutoff;
            })
          : items;
        filtered.sort((a, b) =>
          a.decidedAt < b.decidedAt ? 1 : a.decidedAt > b.decidedAt ? -1 : 0,
        );
        return filtered;
      });

      return res.json({ decisions });
    } catch (err) {
      logger.error?.('sprintK.leadership.decisions.list.error', err);
      captureRouteError(err, 'sprintK.leadership.decisions.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const leadershipDecisionCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  decidedAt: z.string().min(10).optional(),
  kind: z.enum(SUPERVISION_DECISION_KINDS),
  context: z.string().min(1).max(4000),
  rationale: z.string().min(1).max(4000),
  involvedRef: z
    .object({
      kind: z.enum(['TASK', 'WORKER', 'FINDING', 'EXCEPTION']),
      id: z.string().min(1).max(200),
    })
    .optional(),
  outcome: z
    .object({
      positive: z.boolean(),
      description: z.string().min(1).max(2000),
      recordedAt: z.string().min(10),
    })
    .optional(),
});

router.post(
  '/:projectId/leadership/decisions',
  verifyAuth,
  validate(leadershipDecisionCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof leadershipDecisionCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const id =
        body.id ??
        `ld_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const payload: StoredLeadershipDecision = {
        id,
        supervisorUid: callerUid,
        decidedAt: body.decidedAt ?? now,
        kind: body.kind,
        context: body.context,
        rationale: body.rationale,
        involvedRef: body.involvedRef,
        outcome: body.outcome,
        createdAt: now,
        createdBy: callerUid,
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/leadership_decisions`,
        )
        .doc(id)
        .set(cleaned, { merge: true });
      return res.status(201).json({ ok: true, decision: payload });
    } catch (err) {
      logger.error?.('sprintK.leadership.decisions.create.error', err);
      captureRouteError(err, 'sprintK.leadership.decisions.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/:projectId/leadership/ranking',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { rankSupervisorsByImpact } = await import(
        '../../services/leadership/supervisionDecisionTrail.js'
      );
      const db = admin.firestore();
      const cutoff = periodCutoffIso(
        typeof req.query.period === 'string' ? req.query.period : '90d',
      );

      const safeRead = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.('sprintK.leadership.ranking.read_failed', err);
          return [];
        }
      };

      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/leadership_decisions`,
      );

      const decisions = await safeRead<StoredLeadershipDecision>(async () => {
        const snap = await baseRef.limit(2000).get();
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StoredLeadershipDecision, 'id'>),
        }));
        return cutoff
          ? items.filter((it) => it.decidedAt && it.decidedAt >= cutoff)
          : items;
      });

      const ranking = rankSupervisorsByImpact(decisions);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('sprintK.leadership.ranking.error', err);
      captureRouteError(err, 'sprintK.leadership.ranking');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────
// Sprint K §131-138 — Cierre de Proyecto + Lecciones Transferibles +
//                      Decisiones Críticas + Resúmenes Multi-Rol
// ─────────────────────────────────────────────────────────────────────
//
// Cuando un proyecto cierra, NO desaparece su data — extrae:
//   - Lecciones transferibles (publicadas al library F.12 con scope='industry')
//   - Decisiones críticas con outcome retroactivo
//   - Resúmenes multi-rol (gerencia/cliente/operación/regulatorio)
//   - Métricas finales (snapshot del cierre)
//
// El motor (`services/projectClosure/projectClosureService.ts`) ya
// existe y es determinístico. Estos handlers son thin wrappers que
// leen el estado de cierre, validan readiness, y persisten capturas.
//
// Storage layout:
//   tenants/{tid}/projects/{pid}/closure/state    → ClosureState
//   tenants/{tid}/projects/{pid}/closure/lessons/{id}  → ClosureLesson
//   tenants/{tid}/projects/{pid}/closure/decisions/{id}  → CriticalDecision
//
// Las lecciones aceptadas se publican al library global de lecciones
// (tenants/{tid}/lessons/{id}) con scope='industry' usando el adapter F.12
// para que aparezcan en `/lessons` de futuros proyectos.

interface ClosureState {
  status: 'open' | 'initiated' | 'finalized';
  initiatedAt: string | null;
  initiatedByUid: string | null;
  finalizedAt: string | null;
  finalizedByUid: string | null;
}

interface StoredClosureLesson {
  id: string;
  summary: string;
  preventiveAction: string;
  riskCategories: string[];
  tags: string[];
  industry: string;
  capturedAt: string;
  capturedByUid: string;
  publishedLessonId: string | null;
}

interface StoredCriticalDecision {
  id: string;
  decidedAt: string;
  context: string;
  decision: string;
  decidedByUid: string;
  outcome: 'positive' | 'neutral' | 'negative';
  loggedAt: string;
  loggedByUid: string;
}

async function readClosureState(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
): Promise<ClosureState> {
  const snap = await db
    .collection(`tenants/${tenantId}/projects/${projectId}/closure`)
    .doc('state')
    .get();
  if (!snap.exists) {
    return {
      status: 'open',
      initiatedAt: null,
      initiatedByUid: null,
      finalizedAt: null,
      finalizedByUid: null,
    };
  }
  const data = snap.data() as Partial<ClosureState>;
  return {
    status: data.status ?? 'open',
    initiatedAt: data.initiatedAt ?? null,
    initiatedByUid: data.initiatedByUid ?? null,
    finalizedAt: data.finalizedAt ?? null,
    finalizedByUid: data.finalizedByUid ?? null,
  };
}

router.get('/:projectId/closure/status', verifyAuth, async (req, res) => {
// F.29 — Indicadores de Tendencia de Incidentes
// ─────────────────────────────────────────────────────────────────────
//
// Time series + leading indicators sobre la colección top-level
// `incidents` filtrada por `projectId`. Compara ventanas (12m/6m/3m)
// y agrupa por mes o semana. Calcula:
//
//   - `buckets[]`: serie con count + severidad ponderada + breakdown
//     por `type` (kind).
//   - `leading.nearMissRatio`: % de incidents marcados como near-miss
//     vs total. Indicador adelantado: si los near-miss caen sin que
//     los reportes totales lo hagan, suele señalar sub-reporte, no
//     mejora real.
//   - `leading.closureRate`: % de incidents con `status` en
//     {closed, resolved} sobre el total.
//   - `leading.averageDaysOpen`: promedio de días entre `occurredAt`
//     y `closedAt`/`resolvedAt` para los cerrados; mide velocidad
//     de respuesta del SGSST.
//   - `trend` + `trendConfidence`: regresión lineal simple sobre la
//     serie ponderada por severidad. Direccionalidad cualitativa
//     (improving / stable / worsening), no predicción cuantitativa.
//
// NO clasifica por ningún kind hardcodeado. El breakdown `byKind` se
// arma observando los valores reales de `type` que existen en los
// incidents del proyecto. Esto evita inventar categorías que la
// empresa no usa.

const TREND_WINDOW_MS: Record<string, number> = {
  '3m': 90 * 24 * 60 * 60 * 1000,
  '6m': 180 * 24 * 60 * 60 * 1000,
  '12m': 365 * 24 * 60 * 60 * 1000,
};

// Peso ordinal por severidad — calibrado con el documento Sprint K §296:
// critical/sif pesan más que high; medium y low son baseline.
const TREND_SEVERITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
  sif: 8,
  // Spanish aliases (matching SEVERITY_ALIASES en incidentEvidenceBundle).
  baja: 1,
  media: 2,
  alta: 4,
  critica: 8,
  'crítica': 8,
};

function trendSeverityWeight(raw: unknown): number {
  if (typeof raw !== 'string') return 1;
  const key = raw.trim().toLowerCase();
  return TREND_SEVERITY_WEIGHT[key] ?? 1;
}

/**
 * Etiqueta determinística para un bucket. month=YYYY-MM, week=YYYY-Www
 * (ISO-8601). Mantenemos UTC para evitar saltos por DST y para que las
 * series sean reproducibles desde el navegador.
 */
function trendBucketLabel(iso: string, group: 'month' | 'week'): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (group === 'month') {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  }
  // ISO-8601 week numbering.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Heurística near-miss: aceptamos varios shapes legados.
 * - `nearMiss: true` (booleano explícito).
 * - `isNearMiss: true`.
 * - `type` / `kind` con valor `near_miss` / `nearmiss` / `casi_accidente`.
 * - `severity` === 'near_miss' (algunos imports legacy lo mezclaron).
 */
function isNearMissRecord(rec: Record<string, unknown>): boolean {
  if (rec.nearMiss === true || rec.isNearMiss === true) return true;
  const candidates = [rec.type, rec.kind, rec.severity];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const k = c.trim().toLowerCase().replace(/[\s-]/g, '_');
    if (k === 'near_miss' || k === 'nearmiss' || k === 'casi_accidente') {
// Sprint K §104 — Panel de Confianza de Datos (calidad para IA)
// ─────────────────────────────────────────────────────────────────────
//
// "Panel que muestra cuánto se puede confiar en los datos que está
//  usando el sistema para sugerir/decidir. Ayuda al prevencionista a
//  no creer ciegamente en IA si los datos son malos."
//
// Pipeline:
//   1. Lee inventarios + feeds Firestore (con safeRead degradado).
//   2. Compone `ConfidenceInputs` deterministicamente.
//   3. Llama `buildDataConfidenceReport(inputs)` (servicio puro).
//   4. Computes per-domain scores (workers, incidents, training, EPP,
//      permits, audits) y top issues con severity + count + collection.
//   5. Calcula trend rolling 30 días desde snapshots históricos.
//
// El UI nunca debe creer ciegamente en este score — es una señal para
// que el prevencionista decida si confiar en las sugerencias IA.

const DATA_CONFIDENCE_DISMISS_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'gerente',
  'prevention_lead',
  'prevention_manager',
]);

function callerCanDismissDataIssue(
  user: Express.PraeventioAuthUser,
): boolean {
  if (user.admin === true) return true;
  const role = typeof user.role === 'string' ? user.role : null;
  if (role && DATA_CONFIDENCE_DISMISS_ROLES.has(role)) return true;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  for (const r of roles) {
    if (typeof r === 'string' && DATA_CONFIDENCE_DISMISS_ROLES.has(r)) {
      return true;
    }
  }
  return false;
}

/**
 * Regresión lineal simple (least squares) sobre los valores de la
 * serie. Devuelve la pendiente normalizada al promedio para hacerla
 * comparable entre proyectos con distinta escala de incidentes, más
 * un score de confianza R² (0..1) para que el cliente pueda mostrar
 * el chip solo cuando hay señal real.
 */
function trendLinearRegression(values: number[]): {
  slopePerStep: number;
  slopeNormalized: number;
  rSquared: number;
} {
  const n = values.length;
  if (n < 2) return { slopePerStep: 0, slopeNormalized: 0, rSquared: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denomX = sumXX - n * meanX * meanX;
  if (denomX === 0) return { slopePerStep: 0, slopeNormalized: 0, rSquared: 0 };
  const slope = (sumXY - n * meanX * meanY) / denomX;
  const denomY = sumYY - n * meanY * meanY;
  const numerator = sumXY - n * meanX * meanY;
  const r2 =
    denomY === 0
      ? 0
      : Math.min(1, Math.max(0, (numerator * numerator) / (denomX * denomY)));
  const slopeNormalized = meanY > 0 ? slope / meanY : slope;
  return {
    slopePerStep: slope,
    slopeNormalized,
    rSquared: r2,
  };
}

interface TrendBucket {
  label: string;
  count: number;
  severityWeighted: number;
  byKind: Record<string, number>;
}

interface TrendLeadingIndicators {
  nearMissRatio: number;
  closureRate: number;
  averageDaysOpen: number;
}

interface TrendResponse {
  window: '3m' | '6m' | '12m';
  group: 'month' | 'week';
  totalIncidents: number;
  buckets: TrendBucket[];
  leading: TrendLeadingIndicators;
  trend: 'improving' | 'stable' | 'worsening';
  trendConfidence: number;
  generatedAt: string;
}

router.get('/:projectId/incidents/trends', verifyAuth, async (req, res) => {
type DataConfidenceSeverity = 'low' | 'medium' | 'high' | 'critical';

type DataConfidenceDomain =
  | 'workers'
  | 'incidents'
  | 'training'
  | 'epp'
  | 'permits'
  | 'audits';

interface DataConfidenceIssue {
  id: string;
  domain: DataConfidenceDomain;
  collection: string;
  severity: DataConfidenceSeverity;
  count: number;
  description: string;
  dismissed: boolean;
  dismissedByUid?: string | null;
  dismissedAt?: string | null;
}

interface DataConfidenceDomainScore {
  name: DataConfidenceDomain;
  score: number; // 0..100
  observed: number;
  expected: number;
  staleDays: number;
  detail: string;
}

interface DataConfidenceTrendPoint {
  date: string; // YYYY-MM-DD
  overallScore: number;
}

interface DataConfidenceSnapshot {
  generatedAt: string;
  report: DataConfidenceReport;
  domains: DataConfidenceDomainScore[];
  topIssues: DataConfidenceIssue[];
  trend: DataConfidenceTrendPoint[];
}

interface StoredDataIssueDismissal {
  id: string;
  dismissedByUid: string;
  dismissedAt: string;
  reason?: string;
}

interface StoredDataConfidenceSnapshot {
  date: string;
  overallScore: number;
}

/**
 * Calcula días entre `iso` (timestamp ISO) y `now`. Si `iso` está
 * vacío/inválido retorna `fallbackDays` para que el score sea
 * conservador (no inflar artificialmente cuando no hay datos).
 */
function daysSince(iso: string | null | undefined, now: Date, fallbackDays = 999): number {
  if (!iso) return fallbackDays;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallbackDays;
  const ms = now.getTime() - d.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function ratioToScore(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function severityFromScore(score: number): DataConfidenceSeverity {
  if (score < 25) return 'critical';
  if (score < 50) return 'high';
  if (score < 75) return 'medium';
  return 'low';
}

function severityFromCount(count: number, total: number): DataConfidenceSeverity {
  if (total <= 0) return 'low';
  const ratio = count / Math.max(total, 1);
  if (ratio >= 0.5) return 'critical';
  if (ratio >= 0.25) return 'high';
  if (ratio >= 0.1) return 'medium';
  return 'low';
}

router.get('/:projectId/data-confidence', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { validateClosureReadiness } = await import(
      '../../services/projectClosure/projectClosureService.js'
    );

    const db = admin.firestore();
    const db = admin.firestore();
    const now = new Date();
    const base = `tenants/${g.tenantId}/projects/${projectId}`;

    const safeRead = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.closure.status.read.${label}.failed`, err);
        logger.warn?.(`sprintK.dataConfidence.read.${label}.failed`, err);
        return null;
      }
    };

    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const [openIncidents, openActions, openPermits, lessonsCount, decisionsCount, state] =
      await Promise.all([
        safeRead('incidents', async () => {
          const snap = await byProject('incidents').get();
          return snap.docs.filter((d) => {
            const data = d.data() as Record<string, unknown>;
            const status = data.status;
            return status !== 'closed' && status !== 'resolved' && status !== 'verified';
          }).length;
        }),
        safeRead('actions', async () => {
          const snap = await db
            .collection(`tenants/${g.tenantId}/projects/${projectId}/corrective_actions`)
            .get();
          return snap.docs.filter((d) => {
            const data = d.data() as Record<string, unknown>;
            const status = data.status;
            return status !== 'closed' && status !== 'verified';
          }).length;
        }),
        safeRead('permits', async () => {
          const snap = await db
            .collection(`tenants/${g.tenantId}/projects/${projectId}/work_permits`)
            .get();
          return snap.docs.filter((d) => {
            const data = d.data() as Record<string, unknown>;
            const status = data.status;
            return status === 'pending' || status === 'issued';
          }).length;
        }),
        safeRead('lessonsCount', async () => {
          const snap = await db
            .collection(`tenants/${g.tenantId}/projects/${projectId}/closure/lessons`)
            .get();
          return snap.size;
        }),
        safeRead('decisionsCount', async () => {
          const snap = await db
            .collection(`tenants/${g.tenantId}/projects/${projectId}/closure/decisions`)
            .get();
          return snap.size;
        }),
        readClosureState(db, g.tenantId, projectId),
      ]);

    const pendingOpenIncidents = openIncidents ?? 0;
    const pendingOpenActions = openActions ?? 0;
    const pendingOpenPermits = openPermits ?? 0;

    const readiness = validateClosureReadiness({
      pendingOpenIncidents,
      pendingOpenActions,
      pendingOpenPermits,
      hasFinalReport: (lessonsCount ?? 0) > 0,
      unconfirmedSpofs: 0,
    });

    // Readiness percent: each blocker subtracts ~25, each warning ~5.
    const blockerPenalty = readiness.blockers.length * 25;
    const warningPenalty = readiness.warnings.length * 5;
    const readinessPercent = Math.max(0, Math.min(100, 100 - blockerPenalty - warningPenalty));

    return res.json({
      state,
      readinessPercent,
      canClose: readiness.canClose,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      pending: {
        openIncidents: pendingOpenIncidents,
        openActions: pendingOpenActions,
        openPermits: pendingOpenPermits,
        lessonsCaptured: lessonsCount ?? 0,
        decisionsLogged: decisionsCount ?? 0,
      },
    });
  } catch (err) {
    logger.error?.('sprintK.closure.status.error', err);
    captureRouteError(err, 'sprintK.closure.status');
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/:projectId/closure/initiate', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const ref = db
      .collection(`tenants/${g.tenantId}/projects/${projectId}/closure`)
      .doc('state');
    const snap = await ref.get();
    const current = snap.exists ? (snap.data() as Partial<ClosureState>) : {};
    if (current.status === 'finalized') {
      return res.status(409).json({ error: 'already_finalized' });
    }
    const now = new Date().toISOString();
    const payload: ClosureState = {
      status: 'initiated',
      initiatedAt: now,
      initiatedByUid: callerUid,
      finalizedAt: current.finalizedAt ?? null,
      finalizedByUid: current.finalizedByUid ?? null,
    };
    await ref.set(payload, { merge: true });
    return res.status(201).json({ ok: true, state: payload });
  } catch (err) {
    logger.error?.('sprintK.closure.initiate.error', err);
    captureRouteError(err, 'sprintK.closure.initiate');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const closureLessonSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  summary: z.string().min(5).max(2000),
  preventiveAction: z.string().min(5).max(2000),
  riskCategories: z.array(z.string().min(1).max(80)).max(20).optional(),
  tags: z.array(z.string().min(1).max(80)).max(20).optional(),
  industry: z.string().min(1).max(120),
});

router.post(
  '/:projectId/closure/lessons',
  verifyAuth,
  validate(closureLessonSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof closureLessonSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const state = await readClosureState(db, g.tenantId, projectId);
      if (state.status === 'finalized') {
        return res.status(409).json({ error: 'closure_finalized' });
      }
      const now = new Date().toISOString();
      const id =
        body.id ?? `cl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Publish to the global F.12 LessonsLearned library with
      // scope='industry'. We do this BEFORE persisting the closure
      // record so the publishedLessonId is captured atomically. If
      // publication fails we still record the captured lesson and
      // leave publishedLessonId null — the UI can re-attempt later.
      let publishedLessonId: string | null = null;
      try {
        const adapter = new LessonsAdapter(
          admin.firestore() as any,
          g.tenantId,
        );
        const publishId = `pub_${id}`;
        await adapter.save({
          id: publishId,
          summary: body.summary,
          preventiveAction: body.preventiveAction,
          riskCategories: body.riskCategories ?? [],
          tags: [
            ...(body.tags ?? []),
            'project_closure',
            body.industry,
          ],
          scope: 'industry',
          industry: body.industry,
          publishedAt: now,
          adoptionCount: 0,
        });
        publishedLessonId = publishId;
      } catch (publishErr) {
        logger.warn?.('sprintK.closure.lessons.publish_failed', publishErr);
      }

      const stored: StoredClosureLesson = {
        id,
        summary: body.summary,
        preventiveAction: body.preventiveAction,
        riskCategories: body.riskCategories ?? [],
        tags: body.tags ?? [],
        industry: body.industry,
        capturedAt: now,
        capturedByUid: callerUid,
        publishedLessonId,
      };
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/closure/lessons`)
        .doc(id)
        .set(stored, { merge: true });
      return res.status(201).json({ ok: true, lesson: stored });
    } catch (err) {
      logger.error?.('sprintK.closure.lessons.create.error', err);
      captureRouteError(err, 'sprintK.closure.lessons.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const closureDecisionSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  decidedAt: z.string().min(10),
  context: z.string().min(5).max(4000),
  decision: z.string().min(5).max(4000),
  decidedByUid: z.string().min(1).max(120).optional(),
  outcome: z.enum(['positive', 'neutral', 'negative']),
});

router.post(
  '/:projectId/closure/decisions',
  verifyAuth,
  validate(closureDecisionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof closureDecisionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const state = await readClosureState(db, g.tenantId, projectId);
      if (state.status === 'finalized') {
        return res.status(409).json({ error: 'closure_finalized' });
      }
      const now = new Date().toISOString();
      const id =
        body.id ?? `cd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const stored: StoredCriticalDecision = {
        id,
        decidedAt: body.decidedAt,
        context: body.context,
        decision: body.decision,
        decidedByUid: body.decidedByUid ?? callerUid,
        outcome: body.outcome,
        loggedAt: now,
        loggedByUid: callerUid,
      };
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/closure/decisions`)
        .doc(id)
        .set(stored, { merge: true });
      return res.status(201).json({ ok: true, decision: stored });
    } catch (err) {
      logger.error?.('sprintK.closure.decisions.create.error', err);
      captureRouteError(err, 'sprintK.closure.decisions.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get('/:projectId/closure/summary', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { buildSummary } = await import(
      '../../services/projectClosure/projectClosureService.js'
    );

    // Worker/supervisor/gerencia → motor audiences (management/operations/client/regulatory).
    const roleParam =
      typeof req.query.role === 'string' ? req.query.role.toLowerCase() : 'gerencia';
    let audience: 'management' | 'client' | 'operations' | 'regulatory' = 'management';
    if (roleParam === 'worker' || roleParam === 'operations') audience = 'operations';
    else if (roleParam === 'supervisor') audience = 'client';
    else if (roleParam === 'gerencia' || roleParam === 'management') audience = 'management';
    else if (roleParam === 'regulatory') audience = 'regulatory';

    const db = admin.firestore();

    const safeRead = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.closure.summary.read.${label}.failed`, err);
        return null;
      }
    };

    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const [
      incidents,
      lessonsList,
      decisionsList,
      state,
    ] = await Promise.all([
      safeRead('incidents', async () => {
        const snap = await byProject('incidents').get();
        return snap.docs.map((d) => d.data() as Record<string, unknown>);
      }),
      safeRead('lessons', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/closure/lessons`)
          .get();
        return snap.docs.map((d) => d.data() as StoredClosureLesson);
      }),
      safeRead('decisions', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/closure/decisions`)
          .get();
        return snap.docs.map((d) => d.data() as StoredCriticalDecision);
      }),
      readClosureState(db, g.tenantId, projectId),
    ]);

    const totalIncidents = incidents?.length ?? 0;
    const criticalIncidents =
      incidents?.filter((it) => {
        const sev = it.severity;
        return sev === 'critical' || sev === 'serious' || sev === 'fatal';
      }).length ?? 0;

    const snapshot = {
      projectId,
      closedAt: state.finalizedAt ?? new Date().toISOString(),
      closedByUid: state.finalizedByUid ?? 'pending',
      totalIncidents,
      criticalIncidents,
      preventedIncidentsEstimated: 0,
      totalActionsCompleted: 0,
      totalSitebookEntries: 0,
      totalTrainingHours: 0,
      averageComplianceScore: 0,
      criticalDecisions: (decisionsList ?? []).map((d) => ({
        id: d.id,
        decidedAt: d.decidedAt,
        context: d.context,
        decision: d.decision,
        decidedByUid: d.decidedByUid,
        outcome: d.outcome,
      })),
      transferableLessons: (lessonsList ?? []).map((l) => ({
        id: l.id,
        summary: l.summary,
        preventiveAction: l.preventiveAction,
        riskCategories: l.riskCategories,
        tags: l.tags,
        scope: 'industry' as const,
        industry: l.industry,
        publishedAt: l.capturedAt,
        adoptionCount: 0,
      })),
      retentionRecommendations: [],
      improvementOpportunities: [],
    };

    const summary = buildSummary(audience, snapshot);
    return res.json({
      summary,
      role: roleParam,
      audience,
      counts: {
        lessons: lessonsList?.length ?? 0,
        decisions: decisionsList?.length ?? 0,
        incidents: totalIncidents,
        criticalIncidents,
      },
    });
  } catch (err) {
    logger.error?.('sprintK.closure.summary.error', err);
    captureRouteError(err, 'sprintK.closure.summary');
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/:projectId/closure/finalize', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { validateClosureReadiness } = await import(
      '../../services/projectClosure/projectClosureService.js'
    );

    const db = admin.firestore();

    const safeRead = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.closure.finalize.read.${label}.failed`, err);
        return null;
      }
    };

    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const [openIncidents, openActions, openPermits, lessonsCount] = await Promise.all([
      safeRead('incidents', async () => {
        const snap = await byProject('incidents').get();
        return snap.docs.filter((d) => {
          const data = d.data() as Record<string, unknown>;
          const status = data.status;
          return status !== 'closed' && status !== 'resolved' && status !== 'verified';
        }).length;
      }),
      safeRead('actions', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/corrective_actions`)
          .get();
        return snap.docs.filter((d) => {
          const data = d.data() as Record<string, unknown>;
          const status = data.status;
          return status !== 'closed' && status !== 'verified';
        }).length;
      }),
      safeRead('permits', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/work_permits`)
          .get();
        return snap.docs.filter((d) => {
          const data = d.data() as Record<string, unknown>;
          const status = data.status;
          return status === 'pending' || status === 'issued';
        }).length;
      }),
      safeRead('lessonsCount', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/closure/lessons`)
          .get();
        return snap.size;
      }),
    ]);

    const readiness = validateClosureReadiness({
      pendingOpenIncidents: openIncidents ?? 0,
      pendingOpenActions: openActions ?? 0,
      pendingOpenPermits: openPermits ?? 0,
      hasFinalReport: (lessonsCount ?? 0) > 0,
      unconfirmedSpofs: 0,
    });

    if (!readiness.canClose) {
      return res.status(409).json({
        error: 'cannot_finalize',
        blockers: readiness.blockers,
      });
    }

    const now = new Date().toISOString();
    const stateRef = db
      .collection(`tenants/${g.tenantId}/projects/${projectId}/closure`)
      .doc('state');
    const current = (await stateRef.get()).data() as Partial<ClosureState> | undefined;
    const payload: ClosureState = {
      status: 'finalized',
      initiatedAt: current?.initiatedAt ?? now,
      initiatedByUid: current?.initiatedByUid ?? callerUid,
      finalizedAt: now,
      finalizedByUid: callerUid,
    };
    await stateRef.set(payload, { merge: true });
    return res.status(200).json({ ok: true, state: payload });
  } catch (err) {
    logger.error?.('sprintK.closure.finalize.error', err);
    captureRouteError(err, 'sprintK.closure.finalize');
    return res.status(500).json({ error: 'internal_error' });
  }
});



// ─────────────────────────────────────────────────────────────────────
// Sprint K §69-71 — Conducción Segura + Rutas Críticas + Alertas Ruta
// ─────────────────────────────────────────────────────────────────────
//
// HTTP surface for the driving safety domain. The deterministic engines
// (computeDriverScore / scoreRouteRisk / canAssignDriverToRoute) already
// live in `services/drivingSafety/`. This endpoint block wires the
// persisted Firestore shapes used by the page wrapper:
//
//   - routes:    `tenants/{tid}/projects/{pid}/driving_routes`
//   - drivers:   `tenants/{tid}/projects/{pid}/driving_drivers`
//   - journeys:  `tenants/{tid}/projects/{pid}/driving_drivers/{uid}/journeys`
//
// NO push to SUSESO / MINSAL / external authorities — directiva §4
// (alertas externas son dato enriquecedor discreto, no autoridad de
// emergencia). Engine outputs are scored client-side via the service
// module, but ranking is computed server-side here to avoid shipping
// every driver record over the wire for sort.

type RouteCriticality = 'low' | 'medium' | 'high' | 'extreme';
type RouteHazard =
  | 'cliff'
  | 'rockfall'
  | 'flood_zone'
  | 'sharp_curves'
  | 'limited_visibility'
  | 'wildlife'
  | 'mining_traffic'
  | 'icy_surface'
  | 'fog'
  | 'debris'
  | 'accident_reported';
type RouteAlertKind = 'icy' | 'fog' | 'debris' | 'accident_reported' | 'weather' | 'other';

interface StoredRouteAlert {
  kind: RouteAlertKind;
  note: string | null;
  flaggedAt: string;
  flaggedBy: string;
  /** ISO-8601; null = open. */
  resolvedAt: string | null;
}

interface StoredDrivingRoute {
  id: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  criticality: RouteCriticality;
  hazards: RouteHazard[];
  weatherSensitive: boolean;
  recommendedMaxSpeedKmh: number;
  /** Active alert (most recent open). null when route is calm. */
  activeAlert: StoredRouteAlert | null;
  /** Append-only journal of all flags raised. */
  alertHistory: StoredRouteAlert[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

interface StoredDrivingDriver {
  workerUid: string;
  licenseClass: string;
  licenseExpiresAt: string;
  yearsExperience: number;
  incidents12m: number;
  speedingEvents30d: number;
  /** Self-reported / wearable-fed fatigue 0-100 (higher = more fatigued). */
  fatigueScore: number;
  hoursThisWeek: number;
  lastJourneyAt: string | null;
  updatedAt: string;
}

interface StoredJourney {
  id: string;
  workerUid: string;
  startedAt: string;
  endedAt: string | null;
  /** Hours driven (decimal, computed at end). */
  hours: number | null;
  routeId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

const ROUTE_HAZARD_VALUES: readonly RouteHazard[] = [
  'cliff',
  'rockfall',
  'flood_zone',
  'sharp_curves',
  'limited_visibility',
  'wildlife',
  'mining_traffic',
  'icy_surface',
  'fog',
  'debris',
  'accident_reported',
] as const;

const ROUTE_CRITICALITY_VALUES: readonly RouteCriticality[] = [
  'low',
  'medium',
  'high',
  'extreme',
] as const;

const ROUTE_ALERT_KIND_VALUES: readonly RouteAlertKind[] = [
  'icy',
  'fog',
  'debris',
  'accident_reported',
  'weather',
  'other',
] as const;

const drivingRouteCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(200),
  origin: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  distanceKm: z.number().min(0).max(10_000),
  criticality: z.enum(['low', 'medium', 'high', 'extreme']),
  hazards: z
    .array(
      z.enum([
        'cliff',
        'rockfall',
        'flood_zone',
        'sharp_curves',
        'limited_visibility',
        'wildlife',
        'mining_traffic',
        'icy_surface',
        'fog',
        'debris',
        'accident_reported',
      ]),
    )
    .max(20)
    .default([]),
  weatherSensitive: z.boolean().default(false),
  recommendedMaxSpeedKmh: z.number().min(5).max(200).default(60),
});

const drivingRouteAlertSchema = z.object({
  kind: z.enum(['icy', 'fog', 'debris', 'accident_reported', 'weather', 'other']),
  note: z.string().max(1000).optional(),
  /** If true, resolves the active alert instead of raising a new one. */
  resolve: z.boolean().optional(),
});

const drivingJourneySchema = z.object({
  action: z.enum(['start', 'end']),
  /** Required for `end`; ignored otherwise. */
  journeyId: z.string().min(1).max(200).optional(),
  startedAt: z.string().min(10).optional(),
  endedAt: z.string().min(10).optional(),
  /** Self-reported hours; if absent and both timestamps present we compute. */
  hours: z.number().min(0).max(48).optional(),
  routeId: z.string().min(1).max(200).optional(),
  note: z.string().max(1000).optional(),
});

function ensureValidHazards(input: unknown): RouteHazard[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(ROUTE_HAZARD_VALUES);
  return input.filter((x): x is RouteHazard => typeof x === 'string' && allowed.has(x));
}

function startOfIsoWeek(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay() || 7; // treat Sunday as 7
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/**
 * GET /:projectId/driving/routes
 * Optional ?status=active|critical|all (default: all).
 *   - active   = has an open `activeAlert`
 *   - critical = criticality in {'high','extreme'}
 *   - all      = list everything (200 cap)
 */
router.get('/:projectId/driving/routes', verifyAuth, async (req, res) => {
// Sprint K §244-250 — Aprendices + Mentoría + Autorización Progresiva
// ─────────────────────────────────────────────────────────────────────
//
// Aprendices y trabajadores nuevos NO deben tener la misma autonomía
// que un veterano. Este bloque expone el motor determinístico que vive
// en `services/apprenticeship/apprenticeshipProgressService.ts`:
//
//   GET  /:projectId/apprentices                       — lista aprendices
//   POST /:projectId/apprentices                       — registra aprendiz
//   POST /:projectId/apprentices/:uid/authorize        — sube nivel
//   POST /:projectId/apprentices/:uid/expose           — registra exposición
//   GET  /:projectId/mentors/availability              — carga por mentor
//
// Storage canónico:
//   tenants/{tid}/projects/{pid}/apprentices/{workerUid}
//   tenants/{tid}/projects/{pid}/apprentices/{workerUid}/exposures/{id}
//
// Patrón guard + safeRead consistente con leadership/decisions arriba.

const APPRENTICE_AUTH_LEVELS = [
  'none',
  'observer',
  'supervised',
  'autonomous',
] as const;
type ApprenticeAuthLevelAPI = (typeof APPRENTICE_AUTH_LEVELS)[number];

/**
 * Bridge entre el shape público (UI/sidebar) y el shape canónico del
 * servicio (`AuthorizationLevel = 'observer'|'supervised'|'autonomous'`).
 * 'none' representa un aprendiz registrado pero sin haber observado
 * todavía ninguna ejecución — más explícito que ausencia del campo y
 * más fácil de pintar en la UI.
 */
const APPRENTICE_ROLES = [
  'aprendiz',
  'nuevo_ingreso',
  'practicante',
  'trabajador_general',
] as const;
type ApprenticeRoleAPI = (typeof APPRENTICE_ROLES)[number];

interface StoredApprentice {
  workerUid: string;
  mentorUid: string;
  /** Rol explícito para la UI (sidebar muestra solo aprendices, no veteranos). */
  role: ApprenticeRoleAPI;
  /** ISO-8601 inicio del programa. */
  startDate: string;
  /** Nivel global actual (más alto entre todas las tareas autorizadas). */
  currentLevel: ApprenticeAuthLevelAPI;
  /** Tarea → nivel. Espejo del shape del servicio. */
  taskAuthorizations: Record<string, ApprenticeAuthLevelAPI>;
  /** % progreso a `autonomous` (0..100). Calculado server-side. */
  progress: number;
  /** Las 5 exposiciones más recientes para la card. */
  recentExposures: Array<{
    id: string;
    taskKind: string;
    recordedAt: string;
    supervisedBy: string;
    outcome: 'success' | 'partial' | 'unsafe';
  }>;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

interface StoredExposure {
  id: string;
  workerUid: string;
  taskKind: string;
  /** UID del supervisor / mentor presente. */
  supervisedBy: string;
  /** ISO-8601 cuándo se ejecutó. */
  recordedAt: string;
  outcome: 'success' | 'partial' | 'unsafe';
  notes?: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Calcula el "currentLevel" derivado del mapa por tarea. Si no hay
 * autorizaciones, el aprendiz está en 'none'. Si hay autonomous en
 * alguna tarea, el level reporta autonomous (la mayor capacidad
 * habilitada). Esto es solo para la card — la decisión real de
 * `canExecuteTask` sigue siendo por tarea.
 */
function deriveCurrentLevel(
  taskAuths: Record<string, ApprenticeAuthLevelAPI> | undefined,
): ApprenticeAuthLevelAPI {
  if (!taskAuths) return 'none';
  const levels = Object.values(taskAuths);
  if (levels.length === 0) return 'none';
  if (levels.includes('autonomous')) return 'autonomous';
  if (levels.includes('supervised')) return 'supervised';
  if (levels.includes('observer')) return 'observer';
  return 'none';
}

/**
 * Progreso 0..100 hacia autonomía. Pondera tareas por nivel:
 *   observer = 33%, supervised = 66%, autonomous = 100%, none = 0%.
 * Promedia sobre el total de tareas conocidas. Si no hay tareas,
 * 0%. Esto es ilustrativo (barra de progreso) — no decide nada.
 */
function deriveProgress(
  taskAuths: Record<string, ApprenticeAuthLevelAPI> | undefined,
): number {
  if (!taskAuths) return 0;
  const entries = Object.entries(taskAuths);
  if (entries.length === 0) return 0;
  const points = entries.reduce((sum, [, lvl]) => {
    if (lvl === 'autonomous') return sum + 100;
    if (lvl === 'supervised') return sum + 66;
    if (lvl === 'observer') return sum + 33;
    return sum;
  }, 0);
  return Math.round(points / entries.length);
}

router.get('/:projectId/apprentices', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : 'all';
    const status: 'active' | 'critical' | 'all' =
      statusRaw === 'active' || statusRaw === 'critical' ? statusRaw : 'all';
    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/apprentices`,
    );

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.driving.routes.read.${label}.failed`, err);
    const db = admin.firestore();

    const windowKey = (() => {
      const raw = typeof req.query.window === 'string' ? req.query.window.toLowerCase() : '';
      if (raw === '3m' || raw === '6m' || raw === '12m') return raw;
      return '12m';
    })();
    const groupKey: 'month' | 'week' = (() => {
      const raw = typeof req.query.group === 'string' ? req.query.group.toLowerCase() : '';
      if (raw === 'week') return 'week';
      return 'month';
    })();

    const windowMs = TREND_WINDOW_MS[windowKey];
    const cutoffMs = Date.now() - windowMs;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const safeRead = async <T,>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.trends.${label}.read_failed`, err);
        logger.warn?.(`sprintK.apprentices.read.${label}.failed`, err);
        return [];
      }
    };

    const routes = await safeRead<StoredDrivingRoute>('list', async () => {
      const snap = await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/driving_routes`)
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();
      return snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<StoredDrivingRoute, 'id'>) }),
      );
    });

    const filtered = routes.filter((r) => {
      if (status === 'active') return r.activeAlert !== null;
      if (status === 'critical') return r.criticality === 'high' || r.criticality === 'extreme';
      return true;
    });

    return res.json({ routes: filtered });
  } catch (err) {
    logger.error?.('sprintK.driving.routes.list.error', err);
    captureRouteError(err, 'sprintK.driving.routes.list');
    const apprentices = await safeRead<StoredApprentice>(
      'apprentices',
      async () => {
        const snap = await baseRef.limit(500).get();
        // Hydrate every apprentice with their recent exposures so the
        // card render is single-pass. Limited to last 5 per apprentice
        // to keep the response bounded.
        const hydrated = await Promise.all(
          snap.docs.map(async (d) => {
            const data = d.data() as Omit<
              StoredApprentice,
              'workerUid' | 'recentExposures' | 'currentLevel' | 'progress'
            > & {
              currentLevel?: ApprenticeAuthLevelAPI;
              progress?: number;
              taskAuthorizations?: Record<string, ApprenticeAuthLevelAPI>;
            };
            const exposuresSnap = await baseRef
              .doc(d.id)
              .collection('exposures')
              .orderBy('recordedAt', 'desc')
              .limit(5)
              .get()
              .catch(() => null);
            const recentExposures =
              exposuresSnap?.docs.map((e) => {
                const ed = e.data() as Omit<StoredExposure, 'id'>;
                return {
                  id: e.id,
                  taskKind: ed.taskKind,
                  recordedAt: ed.recordedAt,
                  supervisedBy: ed.supervisedBy,
                  outcome: ed.outcome,
                };
              }) ?? [];
            const taskAuthorizations = data.taskAuthorizations ?? {};
            return {
              ...data,
              workerUid: d.id,
              taskAuthorizations,
              currentLevel:
                data.currentLevel ?? deriveCurrentLevel(taskAuthorizations),
              progress: data.progress ?? deriveProgress(taskAuthorizations),
              recentExposures,
            } as StoredApprentice;
          }),
        );
        return hydrated;
      },
    );

    return res.json({ apprentices });
  } catch (err) {
    logger.error?.('sprintK.apprentices.list.error', err);
    captureRouteError(err, 'sprintK.apprentices.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post(
  '/:projectId/driving/routes',
  verifyAuth,
  validate(drivingRouteCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof drivingRouteCreateSchema>;
const apprenticeRegisterSchema = z.object({
  uid: z.string().min(1).max(120),
  mentorUid: z.string().min(1).max(120),
  role: z.enum(APPRENTICE_ROLES).default('aprendiz'),
  startDate: z.string().min(10),
});

router.post(
  '/:projectId/apprentices',
  verifyAuth,
  validate(apprenticeRegisterSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof apprenticeRegisterSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const id =
        body.id ??
        `route_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const payload: StoredDrivingRoute = {
        id,
        name: body.name,
        origin: body.origin,
        destination: body.destination,
        distanceKm: body.distanceKm,
        criticality: body.criticality,
        hazards: ensureValidHazards(body.hazards),
        weatherSensitive: body.weatherSensitive,
        recommendedMaxSpeedKmh: body.recommendedMaxSpeedKmh,
        activeAlert: null,
        alertHistory: [],
        createdAt: now,
        createdBy: callerUid,
        updatedAt: now,
      };
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/driving_routes`)
        .doc(id)
        .set(payload, { merge: true });
      return res.status(201).json({ ok: true, route: payload });
    } catch (err) {
      logger.error?.('sprintK.driving.routes.create.error', err);
      captureRouteError(err, 'sprintK.driving.routes.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.post(
  '/:projectId/driving/routes/:id/alert',
  verifyAuth,
  validate(drivingRouteAlertSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof drivingRouteAlertSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/driving_routes`)
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'route_not_found' });
      }
      const current = snap.data() as Omit<StoredDrivingRoute, 'id'>;
      const now = new Date().toISOString();

      if (body.resolve) {
        // Resolve current open alert (if any).
        const resolved: StoredRouteAlert | null = current.activeAlert
          ? { ...current.activeAlert, resolvedAt: now }
          : null;
        const history = Array.isArray(current.alertHistory) ? current.alertHistory : [];
        const updatedHistory = resolved
          ? history.map((a) =>
              a.flaggedAt === resolved.flaggedAt && a.resolvedAt === null ? resolved : a,
            )
          : history;
        await docRef.set(
          { activeAlert: null, alertHistory: updatedHistory, updatedAt: now },
          { merge: true },
        );
        return res.status(200).json({ ok: true, activeAlert: null });
      }

      const alert: StoredRouteAlert = {
        kind: body.kind,
        note: body.note ?? null,
        flaggedAt: now,
        flaggedBy: callerUid,
        resolvedAt: null,
      };
      const history = Array.isArray(current.alertHistory) ? current.alertHistory : [];
      // If there's an open alert and we're raising a different one, close
      // the previous one in history first to keep timeline consistent.
      const closedPrev = current.activeAlert
        ? history.map((a) =>
            a.flaggedAt === current.activeAlert!.flaggedAt && a.resolvedAt === null
              ? { ...a, resolvedAt: now }
              : a,
          )
        : history;
      const nextHistory = [...closedPrev, alert].slice(-200);

      await docRef.set(
        { activeAlert: alert, alertHistory: nextHistory, updatedAt: now },
        { merge: true },
      );
      return res.status(201).json({ ok: true, activeAlert: alert });
    } catch (err) {
      logger.error?.('sprintK.driving.routes.alert.error', err);
      captureRouteError(err, 'sprintK.driving.routes.alert');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get('/:projectId/driving/drivers', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.driving.drivers.read.${label}.failed`, err);
        return [];
      }
    };
    const drivers = await safeRead<StoredDrivingDriver>('list', async () => {
      const snap = await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/driving_drivers`)
        .limit(500)
        .get();
      return snap.docs.map((d) => ({
        workerUid: d.id,
        ...(d.data() as Omit<StoredDrivingDriver, 'workerUid'>),
      }));
    });
    return res.json({ drivers });
  } catch (err) {
    logger.error?.('sprintK.driving.drivers.list.error', err);
    captureRouteError(err, 'sprintK.driving.drivers.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post(
  '/:projectId/driving/drivers/:uid/journey',
  verifyAuth,
  validate(drivingJourneySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, uid: driverUid } = req.params;
    const body = req.body as z.infer<typeof drivingJourneySchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const driverRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/driving_drivers`)
        .doc(driverUid);
      const journeysCol = driverRef.collection('journeys');
      const driverSnap = await driverRef.get();
      const driver = driverSnap.exists
        ? (driverSnap.data() as Omit<StoredDrivingDriver, 'workerUid'>)
        : null;

      if (body.action === 'start') {
        const journeyId =
          body.journeyId ??
          `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const startedAt = body.startedAt ?? now;
        const journey: StoredJourney = {
          id: journeyId,
          workerUid: driverUid,
          startedAt,
          endedAt: null,
          hours: null,
          routeId: body.routeId ?? null,
          note: body.note ?? null,
          createdBy: callerUid,
          createdAt: now,
        };
        await journeysCol.doc(journeyId).set(journey, { merge: true });
        await driverRef.set(
          { lastJourneyAt: startedAt, updatedAt: now },
          { merge: true },
        );
        return res.status(201).json({ ok: true, journey });
      }

      // action === 'end' — close the journey + roll up hoursThisWeek.
      if (!body.journeyId) {
        return res.status(400).json({ error: 'journeyId_required_for_end' });
      }
      const jRef = journeysCol.doc(body.journeyId);
      const jSnap = await jRef.get();
      if (!jSnap.exists) {
        return res.status(404).json({ error: 'journey_not_found' });
      }
      const existing = jSnap.data() as StoredJourney;
      const endedAt = body.endedAt ?? now;
      let hours = body.hours;
      if (typeof hours !== 'number' || !Number.isFinite(hours)) {
        const startMs = Date.parse(existing.startedAt);
        const endMs = Date.parse(endedAt);
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
          hours = Math.round(((endMs - startMs) / 3_600_000) * 100) / 100;
        } else {
          hours = 0;
        }
      }
      const closed: StoredJourney = { ...existing, endedAt, hours };
      await jRef.set(closed, { merge: true });

      // Roll up hoursThisWeek from journeys in current ISO week.
      const weekStart = startOfIsoWeek(new Date()).toISOString();
      const weekSnap = await journeysCol
        .where('startedAt', '>=', weekStart)
        .limit(200)
        .get();
      const hoursThisWeek = weekSnap.docs.reduce((acc, doc) => {
        const j = doc.data() as StoredJourney;
        return acc + (typeof j.hours === 'number' ? j.hours : 0);
      }, 0);

      await driverRef.set(
        {
          hoursThisWeek: Math.round(hoursThisWeek * 100) / 100,
          lastJourneyAt: endedAt,
          updatedAt: now,
          // Preserve baseline fields when driver doc didn't exist yet.
          ...(driver
            ? {}
            : {
                licenseClass: 'unknown',
                licenseExpiresAt: now,
                yearsExperience: 0,
                incidents12m: 0,
                speedingEvents30d: 0,
                fatigueScore: 0,
              }),
        },
        { merge: true },
      );

      return res.status(200).json({ ok: true, journey: closed });
    } catch (err) {
      logger.error?.('sprintK.driving.journey.error', err);
      captureRouteError(err, 'sprintK.driving.journey');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get('/:projectId/driving/ranking', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { computeDriverScore } = await import(
      '../../services/drivingSafety/drivingSafetyService.js'
    );
    const db = admin.firestore();
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`sprintK.driving.ranking.read.${label}.failed`, err);
        return [];
      }
    };
    const drivers = await safeRead<StoredDrivingDriver>('drivers', async () => {
      const snap = await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/driving_drivers`)
        .limit(500)
        .get();
      return snap.docs.map((d) => ({
        workerUid: d.id,
        ...(d.data() as Omit<StoredDrivingDriver, 'workerUid'>),
      }));
    });
    const now = new Date().toISOString();
    const ranked = drivers
      .map((d) => {
        const report = computeDriverScore(
          {
            workerUid: d.workerUid,
            licenseClass: d.licenseClass,
            licenseExpiresAt: d.licenseExpiresAt,
            yearsExperience: d.yearsExperience,
            incidents12m: d.incidents12m,
            speedingEvents30d: d.speedingEvents30d,
          },
          now,
        );
        return {
          workerUid: d.workerUid,
          safetyScore: clampScore(report.safetyScore),
          level: report.level,
          canOperate: report.canOperate,
          blockers: report.blockers,
          fatigueScore: d.fatigueScore,
          hoursThisWeek: d.hoursThisWeek,
          licenseExpiresAt: d.licenseExpiresAt,
        };
      })
      .sort((a, b) => b.safetyScore - a.safetyScore);
    return res.json({ ranking: ranked });
  } catch (err) {
    logger.error?.('sprintK.driving.ranking.error', err);
    captureRouteError(err, 'sprintK.driving.ranking');
    return res.status(500).json({ error: 'internal_error' });
  }
});



// ─────────────────────────────────────────────────────────────────────────
// Sprint K §211-213 — Reportes Confidenciales (Ley Karin 21.643) +
// Canal de Denuncias + Protección contra Represalias
// ─────────────────────────────────────────────────────────────────────────
//
// Privacy-by-design:
//   - Storage path: tenants/{tid}/confidential_reports/{id} (TENANT-level,
//     not project-level — Ley Karin requires cross-project retaliation
//     pattern detection within the same employer).
//   - `allowsIdentity=false`  → `reporterUid` NEVER persisted; we only
//     write `reporterAnonHash` = SHA-256(uid + salt).slice(0,32). This
//     gives us a stable opaque pseudonym for retaliation pattern
//     detection without ever being reversible to a real uid.
//   - `allowsIdentity=true`   → `reporterUid` persisted + `reporterAnonHash`
//     omitted (since the user opted out of anonymity, we don't need both).
//   - Investigator responses are recorded in an audit subcollection,
//     never overwritten. Only `confidential_handler`, `legal_counsel`,
//     `hr_director`, or `prevencionista` roles may respond.
//   - Retaliation alerts: surfaces patterns of recent disciplinary
//     actions against past reporters WITHOUT de-anonymizing them. The
//     server matches by `reporterAnonHash` only.
//
// SLA: 5 business days for first response (Art. 7 Ley 21.643, full
// resolution within 30 calendar days).

const CONFIDENTIAL_REPORT_KINDS = [
  'harassment',
  'safety',
  'discrimination',
  'violence',
  'conflict_of_interest',
  'other',
] as const;
type ConfidentialReportKindApi = (typeof CONFIDENTIAL_REPORT_KINDS)[number];

const CONFIDENTIAL_REPORT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
type ConfidentialReportSeverity = (typeof CONFIDENTIAL_REPORT_SEVERITIES)[number];

const CONFIDENTIAL_REPORT_STATUSES = ['open', 'investigating', 'resolved'] as const;
type ConfidentialReportStatusApi = (typeof CONFIDENTIAL_REPORT_STATUSES)[number];

// Roles que pueden responder o ver inbox de investigador. El autor
// identificado siempre puede ver SU reporte (filtrado en query layer).
const CONFIDENTIAL_HANDLER_ROLES = new Set([
  'confidential_handler',
  'legal_counsel',
  'hr_director',
  'prevencionista',
  'admin',
]);

/**
 * Salt para hash anónimo. En prod debe ser un secret env distinto del
 * de pulse — el de pulse rota por survey, el de confidenciales DEBE
 * ser estable a nivel tenant porque queremos detectar el mismo autor
 * a través de múltiples reportes en el tiempo (patrón de represalia).
 */
function confidentialReporterSalt(tenantId: string): string {
  return process.env.CONFIDENTIAL_REPORTS_SALT ?? `praeventio_confidential_v1:${tenantId}`;
}

function hashReporterAnon(uid: string, tenantId: string): string {
  const salt = confidentialReporterSalt(tenantId);
  return createHash('sha256').update(`${salt}:${uid}`).digest('hex').slice(0, 32);
}

interface StoredConfidentialReport {
  id: string;
  projectId: string;
  kind: ConfidentialReportKindApi;
  severity: ConfidentialReportSeverity;
  narrative: string;
  evidence?: string;
  allowsIdentity: boolean;
  /** Solo presente si allowsIdentity=true. */
  reporterUid?: string;
  /** Pseudónimo estable para detección de represalias (one-way). */
  reporterAnonHash: string;
  status: ConfidentialReportStatusApi;
  submittedAt: string;
  /** Plazo SLA respuesta inicial (5 días hábiles ~ 7 cal). */
  firstResponseDueAt: string;
  /** Plazo resolución completa (30 días Ley Karin). */
  resolveDueAt: string;
  handlerUid?: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  resolution?: string;
}

interface StoredReportResponseEvent {
  /** ISO-8601 — also the doc id, ordering-stable. */
  at: string;
  actorUid: string;
  actorRole: string;
  kind: 'response' | 'status_change' | 'closure';
  message: string;
  newStatus?: ConfidentialReportStatusApi;
}

interface StoredAdverseAction {
  workerUidHash: string;
  changedAt: string;
  changeKind: 'termination' | 'shift_change' | 'role_demotion' | 'salary_decrease' | 'transfer';
  changedByUid: string;
}

const CONFIDENTIAL_REPORTS_PATH = (tid: string) =>
  `tenants/${tid}/confidential_reports`;
const CONFIDENTIAL_REPORTS_AUDIT_PATH = (tid: string, id: string) =>
  `tenants/${tid}/confidential_reports/${id}/audit`;
const CONFIDENTIAL_ADVERSE_ACTIONS_PATH = (tid: string) =>
  `tenants/${tid}/confidential_adverse_actions`;

async function resolveRequesterRole(uid: string): Promise<string> {
  try {
    const claims = (await admin.auth().getUser(uid)).customClaims ?? {};
    if (typeof claims.role === 'string') return claims.role;
  } catch (err) {
    logger.warn?.('sprintK.confidential.resolveRole.failed', err);
  }
  return 'worker';
}

router.get('/:projectId/confidential-reports', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const rawStatus = typeof req.query.status === 'string' ? req.query.status : null;
  const rawCategory = typeof req.query.category === 'string' ? req.query.category : null;
  const status: ConfidentialReportStatusApi | null =
    rawStatus && (CONFIDENTIAL_REPORT_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as ConfidentialReportStatusApi)
      : null;
  const category: ConfidentialReportKindApi | null =
    rawCategory && (CONFIDENTIAL_REPORT_KINDS as readonly string[]).includes(rawCategory)
      ? (rawCategory as ConfidentialReportKindApi)
      : null;
  try {
    const db = admin.firestore();
    const callerRole = await resolveRequesterRole(callerUid);
    const isInvestigator = CONFIDENTIAL_HANDLER_ROLES.has(callerRole);
    const callerAnonHash = hashReporterAnon(callerUid, g.tenantId);
    let query: FirebaseFirestore.Query = db
      .collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId))
      .where('projectId', '==', projectId);
    if (status) query = query.where('status', '==', status);
    if (category) query = query.where('kind', '==', category);
    let docs: StoredConfidentialReport[] = [];
    try {
      const snap = await query.orderBy('submittedAt', 'desc').limit(500).get();
      docs = snap.docs.map((d) => d.data() as StoredConfidentialReport);
    } catch (err) {
      logger.warn?.('sprintK.confidential.list.read_failed', err);
      docs = [];
    }
    // PRIVACY FILTER: workers can only see their OWN reports (matched by
    // anonHash for anonymous reports, or reporterUid for identified ones).
    // Investigators see everything (already gated by role).
    const filtered = isInvestigator
      ? docs
      : docs.filter(
          (r) =>
            (r.allowsIdentity && r.reporterUid === callerUid) ||
            r.reporterAnonHash === callerAnonHash,
        );
    // Strip reporterUid from any record the caller isn't authorized to
    // see identified (defensive — investigator-level access already
    // grants visibility, workers only see their own).
    const safeRecords = filtered.map((r) => {
      const isOwnIdentified = r.allowsIdentity && r.reporterUid === callerUid;
      if (isInvestigator || isOwnIdentified) return r;
      // Anonymous report viewed by its own author (matched by hash):
      // never re-leak reporterUid (it shouldn't exist anyway, but
      // defense in depth).
      const { reporterUid: _stripped, ...rest } = r;
      return rest as StoredConfidentialReport;
    });
    return res.json({
      reports: safeRecords,
      role: isInvestigator ? 'investigator' : 'reporter',
    });
  } catch (err) {
    logger.error?.('sprintK.confidential.list.error', err);
    captureRouteError(err, 'sprintK.confidential.list');
    // ── Workers domain ───────────────────────────────────────────────
    const workersData = await safeRead('workers', async () => {
      const snap = await db.collection(`${base}/workers`).limit(2000).get();
      const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      let withRole = 0;
      let withAuditLog = 0;
      let withFullProfile = 0;
      let latestUpdate: string | null = null;
      for (const doc of docs) {
        if (typeof doc.role === 'string' && (doc.role as string).length > 0) withRole++;
        if (Array.isArray(doc.auditLog) && (doc.auditLog as unknown[]).length > 0) {
          withAuditLog++;
        }
        const hasName = typeof doc.name === 'string' && (doc.name as string).length > 0;
        const hasRole = typeof doc.role === 'string' && (doc.role as string).length > 0;
        const hasCrew = typeof doc.crewId === 'string' && (doc.crewId as string).length > 0;
        if (hasName && hasRole && hasCrew) withFullProfile++;
        const updatedAt =
          typeof doc.updatedAt === 'string' ? (doc.updatedAt as string) : null;
        if (updatedAt && (!latestUpdate || updatedAt > latestUpdate)) {
          latestUpdate = updatedAt;
        }
      }
      return {
        total: docs.length,
        withRole,
        withAuditLog,
        withFullProfile,
        latestUpdate,
      };
    });

    // ── EPP domain ───────────────────────────────────────────────────
    const eppData = await safeRead('epp', async () => {
      const snap = await db.collection(`${base}/epp_items`).limit(2000).get();
      const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      let withExpiration = 0;
      let withAuditLog = 0;
      let latestUpdate: string | null = null;
      for (const doc of docs) {
        if (typeof doc.expirationDate === 'string' && (doc.expirationDate as string).length > 0) {
          withExpiration++;
        }
        if (Array.isArray(doc.auditLog) && (doc.auditLog as unknown[]).length > 0) {
          withAuditLog++;
        }
        const updatedAt =
          typeof doc.updatedAt === 'string' ? (doc.updatedAt as string) : null;
        if (updatedAt && (!latestUpdate || updatedAt > latestUpdate)) {
          latestUpdate = updatedAt;
        }
      }
      return {
        total: docs.length,
        withExpiration,
        withAuditLog,
        latestUpdate,
      };
    });

    // ── Incidents domain ─────────────────────────────────────────────
    const incidentsData = await safeRead('incidents', async () => {
      const snap = await db.collection(`${base}/incidents`).limit(2000).get();
      const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      let withRootCause = 0;
      let withAuditLog = 0;
      let latestWrite: string | null = null;
      for (const doc of docs) {
        if (typeof doc.rootCause === 'string' && (doc.rootCause as string).length > 0) {
          withRootCause++;
        }
        if (Array.isArray(doc.auditLog) && (doc.auditLog as unknown[]).length > 0) {
          withAuditLog++;
        }
        const createdAt =
          typeof doc.createdAt === 'string' ? (doc.createdAt as string) : null;
        if (createdAt && (!latestWrite || createdAt > latestWrite)) {
          latestWrite = createdAt;
        }
      }
      return {
        total: docs.length,
        withRootCause,
        withAuditLog,
        latestWrite,
      };
    });

    // ── Training domain ──────────────────────────────────────────────
    const trainingData = await safeRead('training', async () => {
      const snap = await db.collection(`${base}/training_records`).limit(2000).get();
      const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      let withApprover = 0;
      let withAuditLog = 0;
      let latestUpdate: string | null = null;
      for (const doc of docs) {
        if (typeof doc.approverUid === 'string' && (doc.approverUid as string).length > 0) {
          withApprover++;
        }
        if (Array.isArray(doc.auditLog) && (doc.auditLog as unknown[]).length > 0) {
          withAuditLog++;
        }
        const updatedAt =
          typeof doc.updatedAt === 'string' ? (doc.updatedAt as string) : null;
        if (updatedAt && (!latestUpdate || updatedAt > latestUpdate)) {
          latestUpdate = updatedAt;
        }
      }
      return {
        total: docs.length,
        withApprover,
        withAuditLog,
        latestUpdate,
      };
    });

    // ── Permits domain ───────────────────────────────────────────────
    const permitsData = await safeRead('permits', async () => {
      const snap = await db.collection(`${base}/work_permits`).limit(2000).get();
      const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      let withApprover = 0;
      let withAuditLog = 0;
      let latestUpdate: string | null = null;
      for (const doc of docs) {
        if (typeof doc.issuedByUid === 'string' && (doc.issuedByUid as string).length > 0) {
          withApprover++;
        }
        if (Array.isArray(doc.auditLog) && (doc.auditLog as unknown[]).length > 0) {
          withAuditLog++;
        }
        const updatedAt =
          typeof doc.updatedAt === 'string' ? (doc.updatedAt as string) : null;
        if (updatedAt && (!latestUpdate || updatedAt > latestUpdate)) {
          latestUpdate = updatedAt;
        }
      }
      return {
        total: docs.length,
        withApprover,
        withAuditLog,
        latestUpdate,
      };
    });

    // ── Audits domain ────────────────────────────────────────────────
    const auditsData = await safeRead('audits', async () => {
      const snap = await db.collection(`${base}/audits`).limit(2000).get();
      const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      let withConclusion = 0;
      let withAuditLog = 0;
      let latestUpdate: string | null = null;
      for (const doc of docs) {
        if (typeof doc.conclusion === 'string' && (doc.conclusion as string).length > 0) {
          withConclusion++;
        }
        if (Array.isArray(doc.auditLog) && (doc.auditLog as unknown[]).length > 0) {
          withAuditLog++;
        }
        const updatedAt =
          typeof doc.updatedAt === 'string' ? (doc.updatedAt as string) : null;
        if (updatedAt && (!latestUpdate || updatedAt > latestUpdate)) {
          latestUpdate = updatedAt;
        }
      }
      return {
        total: docs.length,
        withConclusion,
        withAuditLog,
        latestUpdate,
      };
    });

    // ── Project expected counts ───────────────────────────────────────
    const projectMeta = await safeRead('project_meta', async () => {
      const snap = await db.collection('projects').doc(projectId).get();
      return snap.exists ? (snap.data() as Record<string, unknown>) : null;
    });
    const workersExpected =
      projectMeta && typeof projectMeta.expectedWorkers === 'number'
        ? (projectMeta.expectedWorkers as number)
        : Math.max(workersData?.total ?? 0, 0);
    const eppItemsExpected =
      projectMeta && typeof projectMeta.expectedEppItems === 'number'
        ? (projectMeta.expectedEppItems as number)
        : Math.max(eppData?.total ?? 0, 0);
    const documentsRequired =
      projectMeta && typeof projectMeta.expectedDocuments === 'number'
        ? (projectMeta.expectedDocuments as number)
        : Math.max(permitsData?.total ?? 0, 0) +
          Math.max(auditsData?.total ?? 0, 0);

    // ── Dismissals (so issues can be hidden from top list) ─────────────
    const dismissals = await safeRead('dismissals', async () => {
      const snap = await db
        .collection(`${base}/data_confidence_dismissals`)
        .limit(500)
        .get();
      return snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<StoredDataIssueDismissal, 'id'>) }),
      );
    });
    const dismissedIds = new Set((dismissals ?? []).map((d) => d.id));

    // ── Build ConfidenceInputs ─────────────────────────────────────────
    const inputs: ConfidenceInputs = {
      coverage: {
        workersExpected,
        workersPresent: workersData?.total ?? 0,
        eppItemsExpected,
        eppItemsPresent: eppData?.total ?? 0,
        documentsRequired,
        documentsPresent:
          (permitsData?.total ?? 0) + (auditsData?.total ?? 0),
      },
      freshness: {
        workersLastUpdateDays: daysSince(workersData?.latestUpdate ?? null, now),
        eppInventoryLastUpdateDays: daysSince(eppData?.latestUpdate ?? null, now),
        incidentsLastWriteDays: daysSince(incidentsData?.latestWrite ?? null, now),
        documentsLastReviewDays: daysSince(
          permitsData?.latestUpdate ?? auditsData?.latestUpdate ?? null,
          now,
        ),
      },
      completeness: {
        workersWithFullProfileRatio:
          (workersData?.total ?? 0) > 0
            ? (workersData?.withFullProfile ?? 0) / (workersData?.total ?? 1)
            : 1,
        eppWithExpirationRatio:
          (eppData?.total ?? 0) > 0
            ? (eppData?.withExpiration ?? 0) / (eppData?.total ?? 1)
            : 1,
        incidentsWithRootCauseRatio:
          (incidentsData?.total ?? 0) > 0
            ? (incidentsData?.withRootCause ?? 0) / (incidentsData?.total ?? 1)
            : 1,
        documentsWithApproverRatio:
          (permitsData?.total ?? 0) > 0
            ? (permitsData?.withApprover ?? 0) / (permitsData?.total ?? 1)
            : 1,
      },
      traceability: {
        workersWithAuditLogRatio:
          (workersData?.total ?? 0) > 0
            ? (workersData?.withAuditLog ?? 0) / (workersData?.total ?? 1)
            : 1,
        eppWithAuditLogRatio:
          (eppData?.total ?? 0) > 0
            ? (eppData?.withAuditLog ?? 0) / (eppData?.total ?? 1)
            : 1,
        incidentsWithAuditLogRatio:
          (incidentsData?.total ?? 0) > 0
            ? (incidentsData?.withAuditLog ?? 0) / (incidentsData?.total ?? 1)
            : 1,
        documentsWithAuditLogRatio:
          (permitsData?.total ?? 0) > 0
            ? (permitsData?.withAuditLog ?? 0) / (permitsData?.total ?? 1)
            : 1,
      },
      concordance: {
        inconsistenciesCount: 0,
        totalEntitiesScanned:
          (workersData?.total ?? 0) +
          (incidentsData?.total ?? 0) +
          (permitsData?.total ?? 0),
      },
    };

    const report = buildDataConfidenceReport(inputs, { now });

    // ── Per-domain summaries (UI consumes these for bar chart) ─────────
    const domainScore = (
      name: DataConfidenceDomain,
      observed: number,
      expected: number,
      staleDays: number,
      detail: string,
    ): DataConfidenceDomainScore => {
      const coverageRatio = expected > 0 ? Math.min(observed / expected, 1) : 1;
      const stalenessRatio = Math.max(0, Math.min(1, 1 - staleDays / 60));
      const score = ratioToScore((coverageRatio + stalenessRatio) / 2);
      return { name, score, observed, expected, staleDays, detail };
    };

    const domains: DataConfidenceDomainScore[] = [
      domainScore(
        'workers',
        workersData?.total ?? 0,
        workersExpected,
        daysSince(workersData?.latestUpdate ?? null, now, 0),
        `Workers: ${workersData?.total ?? 0}/${workersExpected} con perfil completo ${workersData?.withFullProfile ?? 0}.`,
      ),
      domainScore(
        'incidents',
        incidentsData?.total ?? 0,
        Math.max(incidentsData?.total ?? 0, 1),
        daysSince(incidentsData?.latestWrite ?? null, now, 0),
        `Incidentes con RCA ${incidentsData?.withRootCause ?? 0}/${incidentsData?.total ?? 0}.`,
      ),
      domainScore(
        'training',
        trainingData?.total ?? 0,
        Math.max(trainingData?.total ?? 0, 1),
        daysSince(trainingData?.latestUpdate ?? null, now, 0),
        `Capacitaciones con aprobador ${trainingData?.withApprover ?? 0}/${trainingData?.total ?? 0}.`,
      ),
      domainScore(
        'epp',
        eppData?.total ?? 0,
        eppItemsExpected,
        daysSince(eppData?.latestUpdate ?? null, now, 0),
        `EPP con vencimiento ${eppData?.withExpiration ?? 0}/${eppData?.total ?? 0}.`,
      ),
      domainScore(
        'permits',
        permitsData?.total ?? 0,
        Math.max(permitsData?.total ?? 0, 1),
        daysSince(permitsData?.latestUpdate ?? null, now, 0),
        `Permisos con emisor ${permitsData?.withApprover ?? 0}/${permitsData?.total ?? 0}.`,
      ),
      domainScore(
        'audits',
        auditsData?.total ?? 0,
        Math.max(auditsData?.total ?? 0, 1),
        daysSince(auditsData?.latestUpdate ?? null, now, 0),
        `Auditorías con conclusión ${auditsData?.withConclusion ?? 0}/${auditsData?.total ?? 0}.`,
      ),
    ];

    // ── Top issues (concrete, dismissable findings) ───────────────────
    const candidateIssues: DataConfidenceIssue[] = [];
    const pushIssue = (
      idSeed: string,
      domain: DataConfidenceDomain,
      collection: string,
      count: number,
      description: string,
      severity: DataConfidenceSeverity,
    ) => {
      if (count <= 0) return;
      const id = `${domain}.${idSeed}`;
      candidateIssues.push({
        id,
        domain,
        collection,
        severity,
        count,
        description,
        dismissed: dismissedIds.has(id),
      });
    };

    if (workersData && workersData.total > 0) {
      const missingRole = workersData.total - workersData.withRole;
      pushIssue(
        'missing_role',
        'workers',
        'workers',
        missingRole,
        `Workers sin cargo asignado: ${missingRole}.`,
        severityFromCount(missingRole, workersData.total),
      );
      const missingProfile = workersData.total - workersData.withFullProfile;
      pushIssue(
        'incomplete_profile',
        'workers',
        'workers',
        missingProfile,
        `Workers con perfil incompleto: ${missingProfile}.`,
        severityFromCount(missingProfile, workersData.total),
      );
    }
    if (eppData && eppData.total > 0) {
      const missingExp = eppData.total - eppData.withExpiration;
      pushIssue(
        'missing_expiration',
        'epp',
        'epp_items',
        missingExp,
        `EPP sin fecha de vencimiento: ${missingExp}.`,
        severityFromCount(missingExp, eppData.total),
      );
    }
    if (incidentsData && incidentsData.total > 0) {
      const missingRca = incidentsData.total - incidentsData.withRootCause;
      pushIssue(
        'missing_root_cause',
        'incidents',
        'incidents',
        missingRca,
        `Incidentes sin causa raíz: ${missingRca}.`,
        severityFromCount(missingRca, incidentsData.total),
      );
    }
    if (trainingData && trainingData.total > 0) {
      const missingApprover = trainingData.total - trainingData.withApprover;
      pushIssue(
        'training_missing_approver',
        'training',
        'training_records',
        missingApprover,
        `Capacitaciones sin aprobador: ${missingApprover}.`,
        severityFromCount(missingApprover, trainingData.total),
      );
    }
    if (permitsData && permitsData.total > 0) {
      const missingApprover = permitsData.total - permitsData.withApprover;
      pushIssue(
        'permits_missing_issuer',
        'permits',
        'work_permits',
        missingApprover,
        `Permisos sin emisor: ${missingApprover}.`,
        severityFromCount(missingApprover, permitsData.total),
      );
    }
    if (auditsData && auditsData.total > 0) {
      const missingConclusion = auditsData.total - auditsData.withConclusion;
      pushIssue(
        'audits_missing_conclusion',
        'audits',
        'audits',
        missingConclusion,
        `Auditorías sin conclusión escrita: ${missingConclusion}.`,
        severityFromCount(missingConclusion, auditsData.total),
      );
    }

    const severityRank: Record<DataConfidenceSeverity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const topIssues = candidateIssues
      .filter((i) => !i.dismissed)
      .sort((a, b) => {
        const sa = severityRank[a.severity] - severityRank[b.severity];
        if (sa !== 0) return sa;
        return b.count - a.count;
      })
      .slice(0, 10);

    // ── Trend (last 30 days) ───────────────────────────────────────────
    const trendSnapshots = await safeRead('trend', async () => {
      const snap = await db
        .collection(`${base}/data_confidence_snapshots`)
        .orderBy('date', 'desc')
        .limit(30)
        .get();
      return snap.docs.map((d) => d.data() as StoredDataConfidenceSnapshot);
    });
    const trend: DataConfidenceTrendPoint[] = (trendSnapshots ?? [])
      .filter(
        (s) =>
          typeof s.date === 'string' &&
          typeof s.overallScore === 'number' &&
          Number.isFinite(s.overallScore),
      )
      .map((s) => ({
        date: s.date,
        overallScore: Math.max(0, Math.min(100, Math.round(s.overallScore))),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Persist today's snapshot so trend accumulates over time. We use the
    // YYYY-MM-DD bucket so multiple reads on the same day overwrite the
    // same doc (the freshest score wins).
    const todayBucket = now.toISOString().slice(0, 10);
    if (!trend.some((p) => p.date === todayBucket)) {
      trend.push({ date: todayBucket, overallScore: report.overallScore });
    } else {
      // Update in-place so the UI sees today's latest computation, not
      // the stored stale one.
      const idx = trend.findIndex((p) => p.date === todayBucket);
      if (idx >= 0) trend[idx] = { date: todayBucket, overallScore: report.overallScore };
    }
    await safeRead('persist_snapshot', async () => {
      await db
        .collection(`${base}/data_confidence_snapshots`)
        .doc(todayBucket)
        .set(
          { date: todayBucket, overallScore: report.overallScore },
          { merge: true },
        );
      return null;
    });

    const snapshot: DataConfidenceSnapshot = {
      generatedAt: now.toISOString(),
      report,
      domains,
      topIssues,
      trend,
    };

    return res.json(snapshot);
  } catch (err) {
    logger.error?.('sprintK.dataConfidence.snapshot.error', err);
    captureRouteError(err, 'sprintK.dataConfidence.snapshot');
    return res.status(500).json({ error: 'internal_error' });
  }
});

const confidentialReportCreateSchema = z.object({
  kind: z.enum(CONFIDENTIAL_REPORT_KINDS),
  severity: z.enum(CONFIDENTIAL_REPORT_SEVERITIES),
  narrative: z.string().min(10).max(8000),
  evidence: z.string().max(4000).optional(),
  allowsIdentity: z.boolean(),
  // El client puede enviarlo o el server lo deriva. Sólo se persiste
  // si allowsIdentity=true — NUNCA en caso contrario.
  reporterUid: z.string().min(1).max(120).optional(),
});

router.post(
  '/:projectId/confidential-reports',
  verifyAuth,
  validate(confidentialReportCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof confidentialReportCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const id = `cr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      // SLA: 5 días hábiles ≈ 7 días calendario para primera respuesta;
      // 30 días Ley Karin para resolución total.
      const firstResponseDueAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const resolveDueAt = new Date(Date.now() + 30 * 86_400_000).toISOString();

      // CRITICAL PRIVACY: el hash anónimo se calcula SIEMPRE sobre el
      // callerUid (no sobre `body.reporterUid`, que el client podría
      // manipular). El uid real sólo se persiste si allowsIdentity=true.
      const reporterAnonHash = hashReporterAnon(callerUid, g.tenantId);
      const payload: StoredConfidentialReport = {
        id,
        projectId,
        kind: body.kind,
        severity: body.severity,
        narrative: body.narrative,
        evidence: body.evidence,
        allowsIdentity: body.allowsIdentity === true,
        reporterAnonHash,
        status: 'open',
        submittedAt: now,
        firstResponseDueAt,
        resolveDueAt,
      };
      if (payload.allowsIdentity) {
        payload.reporterUid = callerUid;
      }
      const apprenticeRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/apprentices`,
        )
        .doc(body.uid);

      // Mentor load cap: §245 — un mentor no puede llevar más de 3
      // aprendices simultáneos. Validamos al servidor para que ningún
      // cliente pueda saltarse la regla escribiendo Firestore directo.
      const currentLoadSnap = await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/apprentices`)
        .where('mentorUid', '==', body.mentorUid)
        .get()
        .catch(() => null);
      if (currentLoadSnap && currentLoadSnap.size >= 3) {
        // Si el aprendiz ya existía bajo este mentor, NO contamos como
        // nuevo (update de metadata). Solo bloqueamos altas reales.
        const alreadyAssigned = currentLoadSnap.docs.some(
          (d) => d.id === body.uid,
        );
        if (!alreadyAssigned) {
          return res.status(409).json({
            error: 'mentor_at_capacity',
            mentorUid: body.mentorUid,
            currentLoad: currentLoadSnap.size,
          });
        }
      }

      const payload: StoredApprentice = {
        workerUid: body.uid,
        mentorUid: body.mentorUid,
        role: body.role,
        startDate: body.startDate,
        currentLevel: 'none',
        taskAuthorizations: {},
        progress: 0,
        recentExposures: [],
        createdAt: now,
        createdBy: callerUid,
      };
      // Stripped of `undefined` keys — Firestore rejects them.
const dismissDataIssueSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});

router.post(
  '/:projectId/data-confidence/dismiss/:issueId',
  verifyAuth,
  validate(dismissDataIssueSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, issueId } = req.params;
    const body = req.body as z.infer<typeof dismissDataIssueSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanDismissDataIssue(req.user!)) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_data_confidence_dismiss_role',
      });
    }
    // Defense in depth: server validates issueId against a known shape
    // ("<domain>.<seed>") so attackers can't write arbitrary doc ids.
    if (!/^[a-z_]+\.[a-z_]+$/.test(issueId)) {
      return res.status(400).json({ error: 'invalid_issue_id' });
    }
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const payload: StoredDataIssueDismissal = {
        id: issueId,
        dismissedByUid: callerUid,
        dismissedAt: now,
        reason: body.reason,
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await db
        .collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId))
        .doc(id)
        .set(cleaned, { merge: false });
      return res.status(201).json({
        ok: true,
        report: payload,
        sla: {
          firstResponseDueAt,
          resolveDueAt,
          legalReference: 'Art. 7 Ley 21.643 — 5 días hábiles primera respuesta',
        },
      });
    } catch (err) {
      logger.error?.('sprintK.confidential.create.error', err);
      captureRouteError(err, 'sprintK.confidential.create');
      await apprenticeRef.set(cleaned, { merge: true });
      return res.status(201).json({ ok: true, apprentice: payload });
    } catch (err) {
      logger.error?.('sprintK.apprentices.register.error', err);
      captureRouteError(err, 'sprintK.apprentices.register');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const apprenticeAuthorizeSchema = z.object({
  taskKind: z.string().min(1).max(200),
  toLevel: z.enum(['observer', 'supervised', 'autonomous']),
  /** Mentor que firma el avance. Server cruza con el mentorUid registrado. */
  signedByUid: z.string().min(1).max(120),
  /** Evidencia libre (ej: "10 ejecuciones supervisadas sin incidentes"). */
  evidence: z.string().min(3).max(2000),
});

router.post(
  '/:projectId/apprentices/:uid/authorize',
  verifyAuth,
  validate(apprenticeAuthorizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, uid } = req.params;
    const body = req.body as z.infer<typeof apprenticeAuthorizeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const apprenticeRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/apprentices`,
        )
        .doc(uid);
      const snap = await apprenticeRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'apprentice_not_found' });
      }
      const stored = snap.data() as StoredApprentice;
      // Validamos que el firmante sea el mentor registrado — esto
      // cierra §245-247 (la autorización requiere firma del mentor).
      if (stored.mentorUid !== body.signedByUid) {
        return res.status(403).json({ error: 'signer_is_not_mentor' });
      }
      const nextAuths: Record<string, ApprenticeAuthLevelAPI> = {
        ...(stored.taskAuthorizations ?? {}),
        [body.taskKind]: body.toLevel,
      };
      const update: Partial<StoredApprentice> = {
        taskAuthorizations: nextAuths,
        currentLevel: deriveCurrentLevel(nextAuths),
        progress: deriveProgress(nextAuths),
        updatedAt: now,
      };
      await apprenticeRef.set(update, { merge: true });
      // Trail of authorizations — separate subcollection so the
      // apprentice doc stays compact and the audit log can grow.
      await apprenticeRef.collection('authorizations').add({
        taskKind: body.taskKind,
        toLevel: body.toLevel,
        signedByUid: body.signedByUid,
        evidence: body.evidence,
        recordedAt: now,
        recordedBy: callerUid,
      });
      return res.status(200).json({
        ok: true,
        workerUid: uid,
        taskKind: body.taskKind,
        toLevel: body.toLevel,
        currentLevel: update.currentLevel,
        progress: update.progress,
      });
    } catch (err) {
      logger.error?.('sprintK.apprentices.authorize.error', err);
      captureRouteError(err, 'sprintK.apprentices.authorize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const confidentialReportRespondSchema = z.object({
  message: z.string().min(1).max(8000),
});

router.post(
  '/:projectId/confidential-reports/:id/respond',
  verifyAuth,
  validate(confidentialReportRespondSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof confidentialReportRespondSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const callerRole = await resolveRequesterRole(callerUid);
      if (!CONFIDENTIAL_HANDLER_ROLES.has(callerRole)) {
        return res.status(403).json({ error: 'role_not_authorized_to_respond' });
      }
      const db = admin.firestore();
      const docRef = db.collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId)).doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'report_not_found' });
      }
      const existing = snap.data() as StoredConfidentialReport;
      if (existing.projectId !== projectId) {
        return res.status(404).json({ error: 'report_not_found' });
      }
      const now = new Date().toISOString();
      // Move status forward if still open.
      const newStatus: ConfidentialReportStatusApi =
        existing.status === 'open' ? 'investigating' : existing.status;
      const patch: Partial<StoredConfidentialReport> = {
        status: newStatus,
        handlerUid: existing.handlerUid ?? callerUid,
        firstResponseAt: existing.firstResponseAt ?? now,
      };
      await docRef.set(patch, { merge: true });
      const event: StoredReportResponseEvent = {
        at: now,
        actorUid: callerUid,
        actorRole: callerRole,
        kind: 'response',
        message: body.message,
        newStatus,
      };
      await db
        .collection(CONFIDENTIAL_REPORTS_AUDIT_PATH(g.tenantId, id))
        .doc(now)
        .set(event);
      return res.status(200).json({ ok: true, event });
    } catch (err) {
      logger.error?.('sprintK.confidential.respond.error', err);
      captureRouteError(err, 'sprintK.confidential.respond');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const confidentialReportCloseSchema = z.object({
  resolution: z.string().min(1).max(8000),
  /** Outcome — declarativo, no afecta privacidad. */
  outcome: z.enum(['substantiated', 'unsubstantiated', 'transferred']).default('substantiated'),
});

router.post(
  '/:projectId/confidential-reports/:id/close',
  verifyAuth,
  validate(confidentialReportCloseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof confidentialReportCloseSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const callerRole = await resolveRequesterRole(callerUid);
      if (!CONFIDENTIAL_HANDLER_ROLES.has(callerRole)) {
        return res.status(403).json({ error: 'role_not_authorized_to_close' });
      }
      const db = admin.firestore();
      const docRef = db.collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId)).doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'report_not_found' });
      }
      const existing = snap.data() as StoredConfidentialReport;
      if (existing.projectId !== projectId) {
        return res.status(404).json({ error: 'report_not_found' });
      }
      const now = new Date().toISOString();
      const patch: Partial<StoredConfidentialReport> = {
        status: 'resolved',
        resolution: `[${body.outcome}] ${body.resolution}`,
        resolvedAt: now,
        handlerUid: existing.handlerUid ?? callerUid,
      };
      await docRef.set(patch, { merge: true });
      const event: StoredReportResponseEvent = {
        at: now,
        actorUid: callerUid,
        actorRole: callerRole,
        kind: 'closure',
        message: `${body.outcome}: ${body.resolution}`,
        newStatus: 'resolved',
      };
      await db
        .collection(CONFIDENTIAL_REPORTS_AUDIT_PATH(g.tenantId, id))
        .doc(now)
        .set(event);
      return res.status(200).json({ ok: true, event, resolvedAt: now });
    } catch (err) {
      logger.error?.('sprintK.confidential.close.error', err);
      captureRouteError(err, 'sprintK.confidential.close');
const apprenticeExposeSchema = z.object({
  taskKind: z.string().min(1).max(200),
  supervisedBy: z.string().min(1).max(120),
  outcome: z.enum(['success', 'partial', 'unsafe']),
  recordedAt: z.string().min(10).optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/apprentices/:uid/expose',
  verifyAuth,
  validate(apprenticeExposeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, uid } = req.params;
    const body = req.body as z.infer<typeof apprenticeExposeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const apprenticeRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/apprentices`,
        )
        .doc(uid);
      const snap = await apprenticeRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'apprentice_not_found' });
      }
      const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const exposure: StoredExposure = {
        id,
        workerUid: uid,
        taskKind: body.taskKind,
        supervisedBy: body.supervisedBy,
        outcome: body.outcome,
        recordedAt: body.recordedAt ?? now,
        notes: body.notes,
        createdAt: now,
        createdBy: callerUid,
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(exposure)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await apprenticeRef.collection('exposures').doc(id).set(cleaned);
      // Touch parent doc so listing reflects activity (and reads of
      // recentExposures are consistent on the next GET).
      await apprenticeRef.set({ updatedAt: now }, { merge: true });
      return res.status(201).json({ ok: true, exposure });
    } catch (err) {
      logger.error?.('sprintK.apprentices.expose.error', err);
      captureRouteError(err, 'sprintK.apprentices.expose');
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/data_confidence_dismissals`,
        )
        .doc(issueId)
        .set(cleaned, { merge: true });
      return res.status(200).json({ ok: true, dismissal: payload });
    } catch (err) {
      logger.error?.('sprintK.dataConfidence.dismiss.error', err);
      captureRouteError(err, 'sprintK.dataConfidence.dismiss');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/:projectId/confidential-reports/retaliation-alerts',
  '/:projectId/mentors/availability',
  '/:projectId/data-confidence/recommendations',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const callerRole = await resolveRequesterRole(callerUid);
      if (!CONFIDENTIAL_HANDLER_ROLES.has(callerRole)) {
        // Anti-leak: workers must never see the retaliation panel — it
        // could indirectly de-anonymize past reporters by listing dates.
        return res.status(403).json({ error: 'role_not_authorized' });
      }
      const db = admin.firestore();
      const safeRead = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.('sprintK.confidential.retaliation.read_failed', err);
          return [];
        }
      };
      // Reportes históricos cualquier estado.
      const reports = await safeRead<StoredConfidentialReport>(async () => {
        const snap = await db
          .collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId))
          .where('projectId', '==', projectId)
          .orderBy('submittedAt', 'desc')
          .limit(500)
          .get();
        return snap.docs.map((d) => d.data() as StoredConfidentialReport);
      });
      // Acciones laborales adversas registradas — el client/HR las anota
      // explícitamente con el hash anónimo del trabajador (NUNCA con el
      // uid real cuando el trabajador fue autor anónimo).
      const adverseActions = await safeRead<StoredAdverseAction>(async () => {
        const snap = await db
          .collection(CONFIDENTIAL_ADVERSE_ACTIONS_PATH(g.tenantId))
          .orderBy('changedAt', 'desc')
          .limit(1000)
          .get();
        return snap.docs.map((d) => d.data() as StoredAdverseAction);
      });
      // Pattern detection: por cada reporte (anónimo o identificado),
      // calcula el hash estable del autor y busca acciones adversas
      // dentro de los 90 días posteriores que apunten al mismo hash.
      // NOTA: never de-anonymizes; el output solo expone el hash.
      const RETALIATION_WINDOW_MS = 90 * 86_400_000;
      const alerts: Array<{
        reportId: string;
        reporterAnonHash: string;
        reportSubmittedAt: string;
        actionAt: string;
        actionKind: StoredAdverseAction['changeKind'];
        daysFromReport: number;
        severity: 'high' | 'critical';
      }> = [];
      for (const r of reports) {
        const reportMs = Date.parse(r.submittedAt);
        if (Number.isNaN(reportMs)) continue;
        for (const a of adverseActions) {
          if (a.workerUidHash !== r.reporterAnonHash) continue;
          const actionMs = Date.parse(a.changedAt);
          if (Number.isNaN(actionMs)) continue;
          if (actionMs <= reportMs) continue;
          if (actionMs - reportMs > RETALIATION_WINDOW_MS) continue;
          const daysFromReport = Math.floor((actionMs - reportMs) / 86_400_000);
          const severity: 'high' | 'critical' =
            a.changeKind === 'termination' || a.changeKind === 'salary_decrease'
              ? 'critical'
              : 'high';
          alerts.push({
            reportId: r.id,
            reporterAnonHash: r.reporterAnonHash,
            reportSubmittedAt: r.submittedAt,
            actionAt: a.changedAt,
            actionKind: a.changeKind,
            daysFromReport,
            severity,
          });
        }
      }
      // Critical first.
      alerts.sort((x, _y) => (x.severity === 'critical' ? -1 : 1));
      return res.json({ alerts, windowDays: 90 });
    } catch (err) {
      logger.error?.('sprintK.confidential.retaliation.error', err);
      captureRouteError(err, 'sprintK.confidential.retaliation');
      const db = admin.firestore();
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`sprintK.mentors.availability.read.${label}.failed`, err);
          return [];
        }
      };

      const apprentices = await safeRead<StoredApprentice>(
        'apprentices',
        async () => {
          const snap = await db
            .collection(
              `tenants/${g.tenantId}/projects/${projectId}/apprentices`,
            )
            .limit(500)
            .get();
          return snap.docs.map((d) => ({
            ...(d.data() as Omit<StoredApprentice, 'workerUid'>),
            workerUid: d.id,
          }));
        },
      );

      // Aggregate apprentices per mentor.
      const byMentor = new Map<
        string,
        { mentorUid: string; apprenticeUids: string[]; load: number }
      >();
      for (const a of apprentices) {
        const entry = byMentor.get(a.mentorUid) ?? {
          mentorUid: a.mentorUid,
          apprenticeUids: [],
          load: 0,
        };
        entry.apprenticeUids.push(a.workerUid);
        entry.load = entry.apprenticeUids.length;
        byMentor.set(a.mentorUid, entry);
      }

      const MAX = 3;
      const mentors = Array.from(byMentor.values()).map((m) => ({
        mentorUid: m.mentorUid,
        apprenticeUids: m.apprenticeUids,
        currentLoad: m.load,
        maxLoad: MAX,
        available: m.load < MAX,
        availableSlots: Math.max(0, MAX - m.load),
      }));
      // Sort: available mentors first, then by load asc.
      mentors.sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return a.currentLoad - b.currentLoad;
      });

      return res.json({ mentors, maxLoad: MAX });
    } catch (err) {
      logger.error?.('sprintK.mentors.availability.error', err);
      captureRouteError(err, 'sprintK.mentors.availability');
// Sprint 42 Fase F.18 — Historial Profesional Portátil del Trabajador
// ─────────────────────────────────────────────────────────────────────
//
// Cierra Plan F.18 "Historial Profesional Portátil (Ley 19.628)".
//
// 3 endpoints sobre el subgrafo profesional del trabajador:
//
//   GET  /:projectId/workers/:workerUid/portable-history
//        → snapshot del subgrafo (identidad / capacitaciones / EPP /
//          aptitudes / roles críticos / firmas / incidentes opc).
//
//   POST /:projectId/workers/:workerUid/portable-history/consent
//        → trabajador (o admin) actualiza consent flags.
//
//   GET  /:projectId/workers/:workerUid/portable-history/export?format=
//        → genera export materializado (JSON canónico siempre, PDF
//          opcional si pdfkit está instalado).
//
// PRIVACY-CRITICAL (Ley 19.628 art. 4° / 9°):
//   - Default consent = FALSE en todos los flags.
//   - El bundle se RE-REDACTA en cada lectura según el consent vigente:
//     identity.fullName + rut son `[REDACTED]` cuando
//     consent.allowsPortableExport=false.
//   - Solo el trabajador mismo (callerUid === workerUid) o un admin
//     (req.user!.admin === true) pueden ver/exportar. Cualquier otro
//     miembro del proyecto → 403.
//   - Si consent.includesIncidents=false los incidentes salen como
//     `[]` (NO se incluyen — minimización art. 9°).
//   - El consent doc vive en
//     `tenants/{tid}/projects/{pid}/portable_history_consents/{workerUid}`.
//   - Todo está cableado con `safeRead` para que un feed roto NO tumbe
//     el endpoint (degradación graceful — el bundle viene parcial,
//     marcado, no vacío silente).

interface PortableHistoryConsent {
  allowsPortableExport: boolean;
  includesIncidents: boolean;
  updatedAt: string;
  updatedByUid: string;
}

interface PortableHistoryTraining {
  id: string;
  trainingCode?: string;
  trainingName?: string;
  obtainedAt?: string;
  expiresAt?: string | null;
  issuer?: string;
  hours?: number;
  projectId?: string;
}

interface PortableHistoryEppDelivery {
  id: string;
  eppCategory?: string;
  eppModel?: string;
  deliveredAt?: string;
  nextReplacementAt?: string | null;
}

interface PortableHistoryAptitude {
  id: string;
  category?: string;
  status?: string;
  recordedAt?: string;
  expiresAt?: string | null;
  source?: string;
}

interface PortableHistoryCriticalRole {
  id: string;
  roleCode?: string;
  roleName?: string;
  startedAt?: string;
  endedAt?: string | null;
  projectId?: string;
}

interface PortableHistoryIncident {
  id: string;
  occurredAt?: string;
  severity?: string;
  category?: string;
}

interface PortableHistorySignature {
  id: string;
  documentKind?: string;
  signedAt?: string;
  documentTitle?: string;
}

interface PortableHistoryBundle {
  schemaVersion: '1.0.0';
  generatedAt: string;
  workerUid: string;
  consent: PortableHistoryConsent;
  identity: {
    fullName: string;
    rut: string;
    email?: string | null;
  };
  trainings: PortableHistoryTraining[];
  eppDeliveries: PortableHistoryEppDelivery[];
  aptitudes: PortableHistoryAptitude[];
  criticalRoles: PortableHistoryCriticalRole[];
  signatures: PortableHistorySignature[];
  incidents: PortableHistoryIncident[];
  disclaimer: string;
}

const PORTABLE_HISTORY_DISCLAIMER =
  'Praeventio nunca diagnostica. Este documento es la cartera profesional ' +
  'portable del trabajador (Ley 19.628 — datos personales). El trabajador ' +
  'es dueño absoluto y decide qué nivel de detalle compartir. La información ' +
  'médica (cuando exista) se organiza para compartirse con el médico tratante. ' +
  'Praeventio NO empuja este documento a ningún organismo externo ' +
  '(SUSESO/SII/MINSAL/OSHA). El trabajador o la empresa lo entregan ' +
  'manualmente al destinatario autorizado.';

function emptyConsent(): PortableHistoryConsent {
  return {
    allowsPortableExport: false,
    includesIncidents: false,
    updatedAt: new Date(0).toISOString(),
    updatedByUid: '',
  };
}

async function loadPortableHistoryConsent(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
  workerUid: string,
): Promise<PortableHistoryConsent> {
  try {
    const snap = await db
      .collection(
        `tenants/${tenantId}/projects/${projectId}/portable_history_consents`,
      )
      .doc(workerUid)
      .get();
    if (!snap.exists) return emptyConsent();
    const data = snap.data() as Partial<PortableHistoryConsent> | undefined;
    return {
      allowsPortableExport: Boolean(data?.allowsPortableExport),
      includesIncidents: Boolean(data?.includesIncidents),
      updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : new Date(0).toISOString(),
      updatedByUid: typeof data?.updatedByUid === 'string' ? data.updatedByUid : '',
    };
  } catch {
    return emptyConsent();
  }
}

/**
 * Owner-or-admin gate. The portable history is the worker's own data —
 * Ley 19.628 says only the data subject (or an authorized admin) may
 * request it. Other members of the project, even supervisors, do NOT
 * get to see another worker's full RUT + medical-context cartera unless
 * the worker explicitly consented (caught by the redaction layer downstream).
 */
function isOwnerOrAdmin(callerUid: string, workerUid: string, isAdmin: boolean): boolean {
  return callerUid === workerUid || isAdmin === true;
}

async function buildPortableHistoryBundle(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
  workerUid: string,
): Promise<PortableHistoryBundle | null> {
  const consent = await loadPortableHistoryConsent(db, tenantId, projectId, workerUid);

  const safeRead = async <T,>(
    label: string,
    fn: () => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn?.(`sprintK.portableHistory.read.${label}.failed`, err);
      return fallback;
    }
  };

  // Worker doc — `projects/{pid}/workers/{workerUid}` per worker-readiness
  // endpoint contract. Optional fallback to the top-level `users` collection
  // when the project hasn't yet propagated the worker doc (legacy invites).
  const workerDocPromise = safeRead(
    'worker',
    async () => {
      const snap = await db
        .collection('projects')
        .doc(projectId)
        .collection('workers')
        .doc(workerUid)
        .get();
      if (snap.exists) return snap.data() as Record<string, unknown>;
      const userSnap = await db.collection('users').doc(workerUid).get();
      return userSnap.exists ? (userSnap.data() as Record<string, unknown>) : null;
    },
    null as Record<string, unknown> | null,
  );

  // Trainings — read all 4 known shapes (mirrors worker-readiness logic
  // but without the `status: completed` filter so the cartera reflects
  // EVERYTHING the worker has ever taken, including pending recertifications).
  const trainingsPromise = safeRead(
    'trainings',
    async () => {
      const [nestedByUid, projTrainingsByUid, projTrainingsByWorkerId, topByAttendees] =
        await Promise.all([
          db
            .collection('projects')
            .doc(projectId)
            .collection('training_assignments')
            .where('workerUid', '==', workerUid)
            .get()
            .catch(() => null),
          db
            .collection('projects')
            .doc(projectId)
            .collection('trainings')
            .where('workerUid', '==', workerUid)
            .get()
            .catch(() => null),
          db
            .collection('projects')
            .doc(projectId)
            .collection('trainings')
            .where('workerId', '==', workerUid)
            .get()
            .catch(() => null),
          db
            .collection('training')
            .where('projectId', '==', projectId)
            .where('attendees', 'array-contains', workerUid)
            .get()
            .catch(() => null),
        ]);
      const all = new Map<string, PortableHistoryTraining>();
      const merge = (snap: FirebaseFirestore.QuerySnapshot | null) => {
        if (!snap) return;
        for (const d of snap.docs) {
          if (all.has(d.id)) continue;
          const data = d.data() as Record<string, unknown>;
          all.set(d.id, {
            id: d.id,
            trainingCode: typeof data.trainingCode === 'string' ? data.trainingCode : undefined,
            trainingName:
              typeof data.trainingName === 'string'
                ? data.trainingName
                : typeof data.title === 'string'
                  ? data.title
                  : undefined,
            obtainedAt:
              typeof data.obtainedAt === 'string'
                ? data.obtainedAt
                : typeof data.completedAt === 'string'
                  ? data.completedAt
                  : undefined,
            expiresAt:
              typeof data.expiresAt === 'string'
                ? data.expiresAt
                : data.expiresAt === null
                  ? null
                  : undefined,
            issuer: typeof data.issuer === 'string' ? data.issuer : undefined,
            hours: typeof data.hours === 'number' ? data.hours : undefined,
            projectId: typeof data.projectId === 'string' ? data.projectId : projectId,
          });
        }
      };
      merge(nestedByUid);
      merge(projTrainingsByUid);
      merge(projTrainingsByWorkerId);
      merge(topByAttendees);
      return Array.from(all.values());
    },
    [] as PortableHistoryTraining[],
  );

  // EPP deliveries — same dual-shape pattern as worker-readiness.
  const eppPromise = safeRead(
    'epp',
    async () => {
      const [nestedByWorkerId, nestedByWorkerUid, topByUid, topByAssignedTo] =
        await Promise.all([
          db
            .collection('projects')
            .doc(projectId)
            .collection('epp_assignments')
            .where('workerId', '==', workerUid)
            .get()
            .catch(() => null),
          db
            .collection('projects')
            .doc(projectId)
            .collection('epp_assignments')
            .where('workerUid', '==', workerUid)
            .get()
            .catch(() => null),
          db
            .collection('epp_assignments')
            .where('projectId', '==', projectId)
            .where('workerUid', '==', workerUid)
            .get()
            .catch(() => null),
          db
            .collection('epp_assignments')
            .where('projectId', '==', projectId)
            .where('assignedTo', '==', workerUid)
            .get()
            .catch(() => null),
        ]);
      const all = new Map<string, PortableHistoryEppDelivery>();
      const merge = (snap: FirebaseFirestore.QuerySnapshot | null) => {
        if (!snap) return;
        for (const d of snap.docs) {
          if (all.has(d.id)) continue;
          const data = d.data() as Record<string, unknown>;
          all.set(d.id, {
            id: d.id,
            eppCategory: typeof data.eppCategory === 'string' ? data.eppCategory : undefined,
            eppModel:
              typeof data.eppModel === 'string'
                ? data.eppModel
                : typeof data.model === 'string'
                  ? data.model
                  : undefined,
            deliveredAt:
              typeof data.deliveredAt === 'string'
                ? data.deliveredAt
                : typeof data.assignedAt === 'string'
                  ? data.assignedAt
                  : undefined,
            nextReplacementAt:
              typeof data.nextReplacementAt === 'string'
                ? data.nextReplacementAt
                : data.nextReplacementAt === null
                  ? null
                  : undefined,
          });
        }
      };
      merge(nestedByWorkerId);
      merge(nestedByWorkerUid);
      merge(topByUid);
      merge(topByAssignedTo);
      return Array.from(all.values());
    },
    [] as PortableHistoryEppDelivery[],
  );

  // Medical aptitudes / clearances. Lives in `projects/{pid}/medical_aptitudes`
  // by `workerUid`; legacy may carry `userUid`.
  const aptitudesPromise = safeRead(
    'aptitudes',
    async () => {
      const [byWorkerUid, byUserUid] = await Promise.all([
        db
          .collection('projects')
          .doc(projectId)
          .collection('medical_aptitudes')
          .where('workerUid', '==', workerUid)
          .get()
          .catch(() => null),
        db
          .collection('projects')
          .doc(projectId)
          .collection('medical_aptitudes')
          .where('userUid', '==', workerUid)
          .get()
          .catch(() => null),
      ]);
      const all = new Map<string, PortableHistoryAptitude>();
      const merge = (snap: FirebaseFirestore.QuerySnapshot | null) => {
        if (!snap) return;
        for (const d of snap.docs) {
          if (all.has(d.id)) continue;
          const data = d.data() as Record<string, unknown>;
          all.set(d.id, {
            id: d.id,
            category: typeof data.category === 'string' ? data.category : undefined,
            status: typeof data.status === 'string' ? data.status : undefined,
            recordedAt:
              typeof data.recordedAt === 'string'
                ? data.recordedAt
                : typeof data.evaluatedAt === 'string'
                  ? data.evaluatedAt
                  : undefined,
            expiresAt:
              typeof data.expiresAt === 'string'
                ? data.expiresAt
                : data.expiresAt === null
                  ? null
                  : undefined,
            source: typeof data.source === 'string' ? data.source : undefined,
          });
        }
      };
      merge(byWorkerUid);
      merge(byUserUid);
      return Array.from(all.values());
    },
    [] as PortableHistoryAptitude[],
  );

  // Critical roles held — `projects/{pid}/critical_role_assignments` by
  // `workerUid`. Each doc is a span (startedAt/endedAt).
  const criticalRolesPromise = safeRead(
    'criticalRoles',
    async () => {
      const snap = await db
        .collection('projects')
        .doc(projectId)
        .collection('critical_role_assignments')
        .where('workerUid', '==', workerUid)
        .get();
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          roleCode: typeof data.roleCode === 'string' ? data.roleCode : undefined,
          roleName: typeof data.roleName === 'string' ? data.roleName : undefined,
          startedAt: typeof data.startedAt === 'string' ? data.startedAt : undefined,
          endedAt:
            typeof data.endedAt === 'string'
              ? data.endedAt
              : data.endedAt === null
                ? null
                : undefined,
          projectId: typeof data.projectId === 'string' ? data.projectId : projectId,
        } as PortableHistoryCriticalRole;
      });
    },
    [] as PortableHistoryCriticalRole[],
  );

  // DDR / ODI / RIOHS signatures — qr_acknowledgements + qr_signatures
  // by workerUid. Light projection (no challenge details — only the
  // fact-of-signature with timestamp).
  const signaturesPromise = safeRead(
    'signatures',
    async () => {
      const [ackSnap, sigSnap] = await Promise.all([
        db
          .collection(`tenants/${tenantId}/projects/${projectId}/qr_acknowledgements`)
          .where('workerUid', '==', workerUid)
          .get()
          .catch(() => null),
        db
          .collection(`tenants/${tenantId}/projects/${projectId}/qr_signatures`)
          .where('workerUid', '==', workerUid)
          .get()
          .catch(() => null),
      ]);
      const all = new Map<string, PortableHistorySignature>();
      const merge = (snap: FirebaseFirestore.QuerySnapshot | null) => {
        if (!snap) return;
        for (const d of snap.docs) {
          if (all.has(d.id)) continue;
          const data = d.data() as Record<string, unknown>;
          all.set(d.id, {
            id: d.id,
            documentKind:
              typeof data.documentKind === 'string'
                ? data.documentKind
                : typeof data.kind === 'string'
                  ? data.kind
                  : undefined,
            signedAt:
              typeof data.signedAt === 'string'
                ? data.signedAt
                : typeof data.acknowledgedAt === 'string'
                  ? data.acknowledgedAt
                  : undefined,
            documentTitle:
              typeof data.documentTitle === 'string'
                ? data.documentTitle
                : typeof data.title === 'string'
                  ? data.title
                  : undefined,
          });
        }
      };
      merge(ackSnap);
      merge(sigSnap);
      return Array.from(all.values());
    },
    [] as PortableHistorySignature[],
  );

  // Incidents involved — only loaded if `consent.includesIncidents===true`.
  // Minimization (Ley 19.628 art. 9°): we don't even READ the data when the
  // worker hasn't opted in. The bundle ships `[]` and the consent flag is
  // surfaced so the UI can explain why.
  const incidentsPromise: Promise<PortableHistoryIncident[]> = consent.includesIncidents
    ? safeRead(
        'incidents',
        async () => {
          const baseQuery = db
            .collection('incidents')
            .where('projectId', '==', projectId);
          const [byWorkerUid, byAffectedWorkerUid, byInvolvedWorkers] = await Promise.all([
            baseQuery
              .where('workerUid', '==', workerUid)
              .limit(200)
              .get()
              .catch(() => null),
            baseQuery
              .where('affectedWorkerUid', '==', workerUid)
              .limit(200)
              .get()
              .catch(() => null),
            baseQuery
              .where('involvedWorkers', 'array-contains', workerUid)
              .limit(200)
              .get()
              .catch(() => null),
          ]);
          const all = new Map<string, PortableHistoryIncident>();
          const merge = (snap: FirebaseFirestore.QuerySnapshot | null) => {
            if (!snap) return;
            for (const d of snap.docs) {
              if (all.has(d.id)) continue;
              const data = d.data() as Record<string, unknown>;
              all.set(d.id, {
                id: d.id,
                occurredAt:
                  typeof data.occurredAt === 'string' ? data.occurredAt : undefined,
                severity: typeof data.severity === 'string' ? data.severity : undefined,
                category:
                  typeof data.category === 'string'
                    ? data.category
                    : typeof data.kind === 'string'
                      ? data.kind
                      : undefined,
              });
            }
          };
          merge(byWorkerUid);
          merge(byAffectedWorkerUid);
          merge(byInvolvedWorkers);
          return Array.from(all.values());
        },
        [] as PortableHistoryIncident[],
      )
    : Promise.resolve([] as PortableHistoryIncident[]);

  const [worker, trainings, epp, aptitudes, criticalRoles, signatures, incidents] =
    await Promise.all([
      workerDocPromise,
      trainingsPromise,
      eppPromise,
      aptitudesPromise,
      criticalRolesPromise,
      signaturesPromise,
      incidentsPromise,
    ]);

  if (!worker) return null;

  // Apply the redaction contract (Ley 19.628 art. 4°): identity fields
  // are ONLY revealed when the worker has explicitly opted in via
  // `consent.allowsPortableExport === true`. Default = '[REDACTED]'.
  const fullName =
    typeof worker.name === 'string'
      ? worker.name
      : typeof worker.displayName === 'string'
        ? worker.displayName
        : typeof worker.fullName === 'string'
          ? worker.fullName
          : '';
  const rut =
    typeof worker.rut === 'string'
      ? worker.rut
      : typeof worker.identityDocument === 'string'
        ? worker.identityDocument
        : '';
  const email =
    typeof worker.email === 'string' ? worker.email : null;

  const identity: PortableHistoryBundle['identity'] = consent.allowsPortableExport
    ? { fullName, rut, email }
    : { fullName: '[REDACTED]', rut: '[REDACTED]', email: null };

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    workerUid,
    consent,
    identity,
    trainings,
    eppDeliveries: epp,
    aptitudes,
    criticalRoles,
    signatures,
    incidents,
    disclaimer: PORTABLE_HISTORY_DISCLAIMER,
  };
}

router.get(
  '/:projectId/workers/:workerUid/portable-history',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const isAdmin = Boolean((req.user as { admin?: boolean }).admin);
    const { projectId, workerUid } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!isOwnerOrAdmin(callerUid, workerUid, isAdmin)) {
      return res
        .status(403)
        .json({ error: 'forbidden_not_owner_or_admin' });
    }
    try {
      const db = admin.firestore();
      const bundle = await buildPortableHistoryBundle(
        db,
        g.tenantId,
        projectId,
        workerUid,
      );
      if (!bundle) {
        return res.status(404).json({ error: 'worker_not_found' });
      }
      return res.json({ bundle });
    } catch (err) {
      logger.error?.('sprintK.portableHistory.get.error', err);
      captureRouteError(err, 'sprintK.portableHistory.get');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);
<<<<<<< HEAD
    // Incidents pueden vivir top-level (filtrados por projectId, según
    // backgroundTriggers.ts:374) o anidados en
    // `tenants/{tid}/projects/{pid}/incidents`. Leemos ambos paths y
    // de-duplicamos por docId para no contar el mismo incidente dos
    // veces si una migración dejó copia en los dos lados.
    const [topLevel, nested] = await Promise.all([
      safeRead<Record<string, unknown>>('incidents_top', async () => {
        const snap = await db
          .collection('incidents')
          .where('projectId', '==', projectId)
          .get();
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
      }),
      safeRead<Record<string, unknown>>('incidents_nested', async () => {
        const snap = await db
          .collection(`tenants/${g.tenantId}/projects/${projectId}/incidents`)
          .get();
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Record<string, unknown>),
        }));
      }),
    ]);

    const byId = new Map<string, Record<string, unknown>>();
    for (const rec of topLevel) {
      const id = String(rec.id ?? '');
      if (id) byId.set(id, rec);
    }
    for (const rec of nested) {
      const id = String(rec.id ?? '');
      if (id && !byId.has(id)) byId.set(id, rec);
    }
    const allIncidents = Array.from(byId.values());

    // Filtrar por ventana usando occurredAt | createdAt (string ISO).
    const occurredOf = (rec: Record<string, unknown>): string | null => {
      if (typeof rec.occurredAt === 'string' && rec.occurredAt) return rec.occurredAt;
      if (typeof rec.createdAt === 'string' && rec.createdAt) return rec.createdAt;
      return null;
    };
    const windowed = allIncidents.filter((rec) => {
      const ts = occurredOf(rec);
      if (!ts) return false;
      return ts >= cutoffIso;
    });

    // Bucketing.
    const bucketMap = new Map<string, TrendBucket>();
    for (const rec of windowed) {
      const ts = occurredOf(rec);
      if (!ts) continue;
      const label = trendBucketLabel(ts, groupKey);
      if (!label) continue;
      const existing =
        bucketMap.get(label) ??
        ({
          label,
          count: 0,
          severityWeighted: 0,
          byKind: {},
        } satisfies TrendBucket);
      existing.count += 1;
      existing.severityWeighted += trendSeverityWeight(rec.severity);
      // Codex P2: aceptar tanto `type` como `kind` para nombrar el
      // breakdown; legacy escribió ambos en distintas etapas.
      const kindRaw =
        (typeof rec.type === 'string' && rec.type) ||
        (typeof rec.kind === 'string' && rec.kind) ||
        'sin_categoria';
      existing.byKind[kindRaw] = (existing.byKind[kindRaw] ?? 0) + 1;
      bucketMap.set(label, existing);
    }
    const buckets = Array.from(bucketMap.values()).sort((a, b) =>
      a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
    );

    // Leading indicators.
    const total = windowed.length;
    const nearMissCount = windowed.filter(isNearMissRecord).length;
    const closedCount = windowed.filter((rec) => {
      const status = String(rec.status ?? '').toLowerCase();
      return status === 'closed' || status === 'resolved';
    }).length;

    let totalDaysOpen = 0;
    let daysOpenSamples = 0;
    for (const rec of windowed) {
      const status = String(rec.status ?? '').toLowerCase();
      if (status !== 'closed' && status !== 'resolved') continue;
      const opened = occurredOf(rec);
      const closedRaw =
        (typeof rec.closedAt === 'string' && rec.closedAt) ||
        (typeof rec.resolvedAt === 'string' && rec.resolvedAt) ||
        (typeof rec.updatedAt === 'string' && rec.updatedAt) ||
        null;
      if (!opened || !closedRaw) continue;
      const openedMs = Date.parse(opened);
      const closedMs = Date.parse(closedRaw);
      if (!Number.isFinite(openedMs) || !Number.isFinite(closedMs)) continue;
      const delta = closedMs - openedMs;
      if (delta < 0) continue;
      totalDaysOpen += delta / (24 * 60 * 60 * 1000);
      daysOpenSamples += 1;
    }

    const leading: TrendLeadingIndicators = {
      nearMissRatio: total > 0 ? Math.round((nearMissCount / total) * 100) / 100 : 0,
      closureRate: total > 0 ? Math.round((closedCount / total) * 100) / 100 : 0,
      averageDaysOpen:
        daysOpenSamples > 0
          ? Math.round((totalDaysOpen / daysOpenSamples) * 10) / 10
          : 0,
    };

    // Trend direction via linear regression sobre severityWeighted.
    // Si no hay suficientes buckets (<3) NO emitimos tendencia: stable
    // con confianza 0. Evita falsos positivos en proyectos nuevos.
    const weighted = buckets.map((b) => b.severityWeighted);
    let trend: 'improving' | 'stable' | 'worsening' = 'stable';
    let trendConfidence = 0;
    if (weighted.length >= 3) {
      const reg = trendLinearRegression(weighted);
      trendConfidence = Math.round(reg.rSquared * 100) / 100;
      // Umbral: 10% de cambio normalizado por bucket — calibrado para
      // que un goteo sostenido lo dispare, no un único pico.
      if (reg.slopeNormalized <= -0.1) trend = 'improving';
      else if (reg.slopeNormalized >= 0.1) trend = 'worsening';
      else trend = 'stable';
    }

    const response: TrendResponse = {
      window: windowKey,
      group: groupKey,
      totalIncidents: total,
      buckets,
      leading,
      trend,
      trendConfidence,
      generatedAt: new Date().toISOString(),
    };

    return res.json(response);
  } catch (err) {
    logger.error?.('sprintK.trends.error', err);
    captureRouteError(err, 'sprintK.trends');
    return res.status(500).json({ error: 'internal_error' });
  }
});
>>>>>>> ca8e4b8b (feat(apprentices): §244-250 Aprendices + Mentoría + Autorización Progresiva — endpoint + hook + page wired)

const portableHistoryConsentSchema = z.object({
  allowsPortableExport: z.boolean(),
  includesIncidents: z.boolean(),
});

router.post(
  '/:projectId/workers/:workerUid/portable-history/consent',
  verifyAuth,
  validate(portableHistoryConsentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const isAdmin = Boolean((req.user as { admin?: boolean }).admin);
    const { projectId, workerUid } = req.params;
    const body = req.body as z.infer<typeof portableHistoryConsentSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!isOwnerOrAdmin(callerUid, workerUid, isAdmin)) {
      return res
        .status(403)
        .json({ error: 'forbidden_not_owner_or_admin' });
    }
    try {
      const db = admin.firestore();
      const consent: PortableHistoryConsent = {
        allowsPortableExport: body.allowsPortableExport,
        includesIncidents: body.includesIncidents,
        updatedAt: new Date().toISOString(),
        updatedByUid: callerUid,
      };
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/portable_history_consents`,
        )
        .doc(workerUid)
        .set(consent, { merge: false });
      return res.status(200).json({ ok: true, consent });
    } catch (err) {
      logger.error?.('sprintK.portableHistory.consent.error', err);
      captureRouteError(err, 'sprintK.portableHistory.consent');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

function bundleToCanonicalJson(bundle: PortableHistoryBundle): string {
  const stringify = (value: unknown): string => {
    if (value === null || value === undefined) return JSON.stringify(value ?? null);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stringify).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`)
      .join(',')}}`;
  };
  return stringify(bundle);
}

router.get(
  '/:projectId/workers/:workerUid/portable-history/export',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const isAdmin = Boolean((req.user as { admin?: boolean }).admin);
    const { projectId, workerUid } = req.params;
    const format = typeof req.query.format === 'string' ? req.query.format : 'json';
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!isOwnerOrAdmin(callerUid, workerUid, isAdmin)) {
      return res
        .status(403)
        .json({ error: 'forbidden_not_owner_or_admin' });
    }
    try {
      const db = admin.firestore();
      const bundle = await buildPortableHistoryBundle(
        db,
        g.tenantId,
        projectId,
        workerUid,
      );
      if (!bundle) {
        return res.status(404).json({ error: 'worker_not_found' });
      }
      // Hard gate on the export action — the GET above redacts but still
      // returns the bundle so the UI can render the consent toggles. The
      // EXPORT endpoint refuses entirely without consent (Ley 19.628 art. 4°
      // — finalidad y consentimiento explícito para la disposición externa).
      if (!bundle.consent.allowsPortableExport) {
        return res
          .status(403)
          .json({ error: 'consent_required_for_export' });
      }
      const canonical = bundle ? bundleToCanonicalJson(bundle) : '';
      const checksum = createHash('sha256').update(canonical).digest('hex');

      if (format === 'pdf') {
        try {
          // pdfkit is an optional runtime dependency (declared in
          // package.json devDependencies). Wrap in dynamic import so a
          // missing dep degrades to a friendly 503 rather than crashing
          // the server.
          const pdfkitMod = (await import('pdfkit').catch(() => null)) as
            | { default: new (opts?: { size?: string; margin?: number }) => unknown }
            | null;
          if (!pdfkitMod) {
            return res
              .status(503)
              .json({ error: 'pdf_unavailable', detail: 'pdfkit_not_installed' });
          }
          const PDFDocument = pdfkitMod.default;
          const doc = new PDFDocument({ size: 'A4', margin: 50 }) as unknown as {
            on: (ev: string, cb: (chunk?: Buffer) => void) => void;
            end: () => void;
            fontSize: (n: number) => unknown;
            text: (s: string, opts?: Record<string, unknown>) => unknown;
            moveDown: (n?: number) => unknown;
          };
          const chunks: Buffer[] = [];
          doc.on('data', (chunk?: Buffer) => {
            if (chunk) chunks.push(chunk);
          });
          const finished = new Promise<Buffer>((resolve, reject) => {
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err?: Buffer) => reject(err));
          });
          doc.fontSize(18);
          doc.text('Historial Profesional Portátil', { align: 'center' });
          doc.moveDown(0.5);
          doc.fontSize(9);
          doc.text(bundle.disclaimer, { align: 'justify' });
          doc.moveDown(1);
          doc.fontSize(11);
          doc.text(`Trabajador: ${bundle.identity.fullName}`);
          doc.text(`RUT: ${bundle.identity.rut}`);
          if (bundle.identity.email) doc.text(`Email: ${bundle.identity.email}`);
          doc.text(`Generado: ${bundle.generatedAt}`);
          doc.text(`Checksum SHA-256: ${checksum}`);
          doc.moveDown(0.5);
          doc.text(`Capacitaciones: ${bundle.trainings.length}`);
          doc.text(`Entregas de EPP: ${bundle.eppDeliveries.length}`);
          doc.text(`Aptitudes médicas: ${bundle.aptitudes.length}`);
          doc.text(`Roles críticos: ${bundle.criticalRoles.length}`);
          doc.text(`Firmas DDR/ODI/RIOHS: ${bundle.signatures.length}`);
          doc.text(`Incidentes: ${bundle.consent.includesIncidents ? bundle.incidents.length : 'REDACTED'}`);
          doc.end();
          const pdfBuf = await finished;
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="portable-history-${workerUid}.pdf"`,
          );
          res.setHeader('X-Portable-History-Checksum', checksum);
          return res.status(200).send(pdfBuf);
        } catch (pdfErr) {
          logger.warn?.('sprintK.portableHistory.export.pdf_failed', pdfErr);
          return res
            .status(503)
            .json({ error: 'pdf_unavailable', detail: 'pdf_generation_failed' });
        }
      }

      // JSON (default): canonical body + checksum header for verification.
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="portable-history-${workerUid}.json"`,
      );
      res.setHeader('X-Portable-History-Checksum', checksum);
      return res.status(200).send(canonical);
    } catch (err) {
      logger.error?.('sprintK.portableHistory.export.error', err);
      captureRouteError(err, 'sprintK.portableHistory.export');
=======
      const db = admin.firestore();
      const now = new Date();
      const base = `tenants/${g.tenantId}/projects/${projectId}`;

      const safeReadCount = async (
        label: string,
        col: string,
        filter?: (doc: Record<string, unknown>) => boolean,
      ): Promise<{ total: number; flagged: number }> => {
        try {
          const snap = await db.collection(`${base}/${col}`).limit(2000).get();
          let flagged = 0;
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            if (!filter || filter(data)) flagged++;
          }
          return { total: snap.size, flagged };
        } catch (err) {
          logger.warn?.(`sprintK.dataConfidence.recos.${label}.failed`, err);
          return { total: 0, flagged: 0 };
        }
      };

      const workers = await safeReadCount(
        'workers',
        'workers',
        (d) => !d.role || (typeof d.role === 'string' && (d.role as string).length === 0),
      );
      const epp = await safeReadCount(
        'epp',
        'epp_items',
        (d) =>
          !d.expirationDate ||
          (typeof d.expirationDate === 'string' && (d.expirationDate as string).length === 0),
      );
      const incidents = await safeReadCount(
        'incidents',
        'incidents',
        (d) =>
          !d.rootCause ||
          (typeof d.rootCause === 'string' && (d.rootCause as string).length === 0),
      );
      const trainings = await safeReadCount(
        'training',
        'training_records',
        (d) =>
          !d.approverUid ||
          (typeof d.approverUid === 'string' && (d.approverUid as string).length === 0),
      );

      const recommendations: Array<{
        id: string;
        priority: 'high' | 'medium' | 'low';
        title: string;
        action: string;
        target: number;
        domain: DataConfidenceDomain;
      }> = [];

      if (workers.flagged > 0) {
        recommendations.push({
          id: 'reco_workers_role',
          priority: workers.flagged >= 10 ? 'high' : 'medium',
          title: `Completa ${workers.flagged} workers sin cargo asignado`,
          action: 'Asigna cargo y cuadrilla a los trabajadores marcados.',
          target: workers.flagged,
          domain: 'workers',
        });
      }
      if (epp.flagged > 0) {
        recommendations.push({
          id: 'reco_epp_expiration',
          priority: epp.flagged >= 20 ? 'high' : 'medium',
          title: `Agrega fecha de vencimiento a ${epp.flagged} EPP`,
          action: 'Actualiza el inventario con la fecha real de caducidad por ítem.',
          target: epp.flagged,
          domain: 'epp',
        });
      }
      if (incidents.flagged > 0) {
        recommendations.push({
          id: 'reco_incidents_root_cause',
          priority: incidents.flagged >= 5 ? 'high' : 'medium',
          title: `Cierra causa raíz en ${incidents.flagged} incidentes`,
          action: 'Completa el análisis RCA y persiste la causa raíz.',
          target: incidents.flagged,
          domain: 'incidents',
        });
      }
      if (trainings.flagged > 0) {
        recommendations.push({
          id: 'reco_training_approver',
          priority: 'medium',
          title: `Asigna aprobador a ${trainings.flagged} capacitaciones`,
          action: 'Define el supervisor responsable de aprobar la capacitación.',
          target: trainings.flagged,
          domain: 'training',
        });
      }

      // Stamp the response so the UI can show when the recommendations
      // were computed without forcing the caller to look at the network
      // log.
      return res.json({ generatedAt: now.toISOString(), recommendations });
    } catch (err) {
      logger.error?.('sprintK.dataConfidence.recos.error', err);
      captureRouteError(err, 'sprintK.dataConfidence.recos');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);
<<<<<<< HEAD
=======

>>>>>>> fd84edc6 (feat(data-confidence): §104 Panel Confianza Datos — endpoint + hook + page wired)

export default router;
