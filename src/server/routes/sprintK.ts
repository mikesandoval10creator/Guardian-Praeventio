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
// LessonsAdapter migró con F.12 + §131-138 (lessonsLearned.ts + projectClosure.ts).
import { CorrectiveActionsAdapter } from '../../services/correctiveActions/correctiveActionsFirestoreAdapter.js';
import { LotoAdapter } from '../../services/loto/lotoFirestoreAdapter.js';
import { EquipmentAdapter } from '../../services/equipment/equipmentFirestoreAdapter.js';
// workPermits engine + adapter ya no se usan aquí — F.15 vive en
// src/server/routes/workPermits.ts (2026-05-18).
// suppliers/supplierScoring ya no se usa aquí — §90-91 vive en
// src/server/routes/suppliers.ts (2026-05-18).
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

// F.5 QR Signature migrado a src/server/routes/qrSignature.ts (2026-05-18).
// El helper callerHasSupervisorRole + QR_SIG_CHALLENGE_ROLES viajaron con
// sus features (qrSignature.ts y culturePulse.ts ahora cada uno declara
// su propio gate localmente).


// F.26 Maturity Index migrado a src/server/routes/maturity.ts (2026-05-18).

// F.15 Work Permits (GET) migrado a src/server/routes/workPermits.ts (2026-05-18).

// F.21 Pre-Shift Risk Panel migrado a src/server/routes/preShiftRisk.ts (2026-05-18).


// F.13 Radar de Riesgos Repetidos migrado a src/server/routes/riskRadar.ts
// (2026-05-18). El router dedicado se monta antes que este monolito.

// F.15 Work Permits (POST + sign + close) migrado a src/server/routes/workPermits.ts (2026-05-18).

// F.20 Drills Manager migrado a src/server/routes/drillsManager.ts (2026-05-18).

// F.7 CPHS Minute migrado a src/server/routes/cphsMinute.ts (2026-05-18).


// F.16 Worker Readiness migrado a src/server/routes/workerReadiness.ts (2026-05-18).

// §74-78 Emergency Brigade migrado a src/server/routes/emergencyBrigade.ts (2026-05-18).

// §214-215 Positive Observations (listing + balance) migrado a src/server/routes/positiveObservations.ts (2026-05-18).



// F.6 Offline Inspections migrado a src/server/routes/offlineInspections.ts (2026-05-18).

// §42-44 Engineering Controls migrado a src/server/routes/engineeringControls.ts (2026-05-18).

// §61-63 Culture Pulse migrado a src/server/routes/culturePulse.ts (2026-05-18).

// §185-190 Knowledge Base migrado a src/server/routes/knowledgeBase.ts (2026-05-18).

// §195-200 PDCA migrado a src/server/routes/pdca.ts (2026-05-18).

// §90-91 Supplier Quality migrado a src/server/routes/suppliers.ts (2026-05-18).

// §291-295 Annual SGI Review migrado a src/server/routes/annualReview.ts (2026-05-18).

// §296-301 Residual Risk migrado a src/server/routes/residualRisk.ts (2026-05-18).

// §276-277 Leadership Decisions migrado a src/server/routes/leadership.ts (2026-05-18).

// §131-138 Project Closure migrado a src/server/routes/projectClosure.ts (2026-05-18).

// F.29 Incident Trends migrado a src/server/routes/incidentTrends.ts (2026-05-18).

// §104 Data Confidence Panel migrado a src/server/routes/dataConfidence.ts (2026-05-18).

// §69-71 Driving Safety migrado a src/server/routes/drivingSafety.ts (2026-05-18).
// §244-250 Apprenticeship migrado a src/server/routes/apprenticeship.ts (mantenedor session previa).
// §211-213 Confidential Reports migrado a src/server/routes/confidentialReports.ts (mantenedor session previa).
// F.29 Incident Trends migrado a src/server/routes/incidentTrends.ts (mantenedor session previa).
// §104 Data Confidence Panel migrado a src/server/routes/dataConfidence.ts (mantenedor session previa).
// F.18 Portable History migrado a src/server/routes/portableHistory.ts (mantenedor session previa).
//
// El bloque legacy estaba severamente corrupto (interleaved handlers,
// merge conflict markers, schemas referenciados antes de declaración).
// Las rutas dedicadas estaban activas y montadas antes del monolito.

export default router;
