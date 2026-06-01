// Praeventio Guard — F.20 Gestor de Simulacros.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/drills*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 4 endpoints:
//   GET  /:projectId/drills[?status=...&kind=...]   → listing top-200
//        ordenado newest-first
//   GET  /:projectId/drills/:drillId                → detalle
//   POST /:projectId/drills/plan                    → planificar simulacro
//   POST /:projectId/drills/:drillId/execute        → registrar ejecución
//        + score readiness (evaluateDrillResult — 100% determinístico)
//
// Storage path: `tenants/{tid}/projects/{pid}/drills/{drillId}`.
// One document per simulacro: holds plan + optional execution + cached
// `DrillReadinessReport`.
//
// Status machine (server-authoritative):
//   planned → in_progress (reserved) → completed | cancelled (reserved).

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

const router = Router();

// ── Guard helpers ─────────────────────────────────────────────────────

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
  const tenantId = await resolveTenantId(
    callerUid,
    projectId,
    admin.firestore(),
  );
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── Constants ─────────────────────────────────────────────────────────

const DRILL_KINDS = [
  'evacuation',
  'fire',
  'spill_chemical',
  'first_aid',
  'rescue_confined',
  'rescue_height',
  'gas_leak',
  'earthquake',
] as const;
type DrillKind = (typeof DRILL_KINDS)[number];

const DRILL_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'cancelled',
] as const;
type DrillStatus = (typeof DRILL_STATUSES)[number];

interface StoredDrill {
  id: string;
  kind: DrillKind;
  scheduledAt: string;
  responsibleUid: string;
  status: DrillStatus;
  title?: string;
  location?: string;
  expectedCount?: number;
  benchmarkSeconds?: number;
  createdAt: string;
  createdBy: string;
  executedAt?: string;
  participantCount?: number;
  responseTimeSeconds?: number;
  observedGaps?: string[];
  requiredExternal?: boolean;
  notes?: string;
  report?: {
    participationRate: number | null;
    speedDeficitPercent: number | null;
    level:
      | 'excellent'
      | 'good'
      | 'needs_improvement'
      | 'critical'
      | 'insufficient_baseline';
    recommendations: string[];
  };
}

// ── GET /:projectId/drills ────────────────────────────────────────────

router.get('/:projectId/drills', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const status =
      typeof req.query.status === 'string' &&
      (DRILL_STATUSES as readonly string[]).includes(req.query.status)
        ? (req.query.status as DrillStatus)
        : null;
    const kind =
      typeof req.query.kind === 'string' &&
      (DRILL_KINDS as readonly string[]).includes(req.query.kind)
        ? (req.query.kind as DrillKind)
        : null;

    const safeRead = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.('drillsManager.list.read_failed', err);
        return [];
      }
    };

    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/drills`,
    );

    const drills = await safeRead<StoredDrill>(async () => {
      let q: admin.firestore.Query = baseRef;
      if (status) q = q.where('status', '==', status);
      if (kind) q = q.where('kind', '==', kind);
      const snap = await q.orderBy('createdAt', 'desc').limit(200).get();
      return snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<StoredDrill, 'id'>) }),
      );
    });

    return res.json({ drills });
  } catch (err) {
    logger.error?.('drillsManager.list.error', err);
    captureRouteError(err, 'drillsManager.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── GET /:projectId/drills/:drillId ───────────────────────────────────

router.get(
  '/:projectId/drills/:drillId',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, drillId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/drills`)
        .doc(drillId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'drill_not_found' });
      }
      const drill: StoredDrill = {
        id: snap.id,
        ...(snap.data() as Omit<StoredDrill, 'id'>),
      };
      return res.json({ drill });
    } catch (err) {
      logger.error?.('drillsManager.get.error', err);
      captureRouteError(err, 'drillsManager.get');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/drills/plan ──────────────────────────────────────

const drillPlanSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(DRILL_KINDS),
  scheduledAt: z.string().min(10),
  responsibleUid: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  location: z.string().min(1).max(200).optional(),
  expectedCount: z.number().int().nonnegative().optional(),
  benchmarkSeconds: z.number().int().positive().optional(),
});

router.post(
  '/:projectId/drills/plan',
  verifyAuth,
  validate(drillPlanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof drillPlanSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const payload: StoredDrill = {
        id: body.id,
        kind: body.kind,
        scheduledAt: body.scheduledAt,
        responsibleUid: body.responsibleUid,
        status: 'planned',
        title: body.title,
        location: body.location,
        expectedCount: body.expectedCount,
        benchmarkSeconds: body.benchmarkSeconds,
        createdAt: now,
        createdBy: callerUid,
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/drills`)
        .doc(body.id)
        .set(cleaned, { merge: true });
      await auditServerEvent(req, 'drillsManager.plan', 'drillsManager', {
        projectId,
        drillId: body.id,
        kind: body.kind,
      }, { projectId });
      return res.status(201).json({ ok: true, drill: payload });
    } catch (err) {
      logger.error?.('drillsManager.plan.error', err);
      captureRouteError(err, 'drillsManager.plan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/drills/:drillId/execute ──────────────────────────

const drillExecuteSchema = z.object({
  executedAt: z.string().min(10),
  participantCount: z.number().int().nonnegative(),
  expectedCount: z.number().int().nonnegative().optional(),
  responseTimeSeconds: z.number().int().nonnegative(),
  benchmarkSeconds: z.number().int().positive().optional(),
  observedGaps: z.array(z.string().min(1).max(500)).max(50).optional(),
  requiredExternal: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
});

router.post(
  '/:projectId/drills/:drillId/execute',
  verifyAuth,
  validate(drillExecuteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, drillId } = req.params;
    const body = req.body as z.infer<typeof drillExecuteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { evaluateDrillResult } = await import(
        '../../services/drillsManager/drillsManager.js'
      );
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/drills`)
        .doc(drillId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'drill_not_found' });
      }
      const existing = snap.data() as Omit<StoredDrill, 'id'>;
      const expectedCount = body.expectedCount ?? existing.expectedCount;
      const benchmarkSeconds =
        body.benchmarkSeconds ?? existing.benchmarkSeconds;
      const observedGaps = body.observedGaps ?? [];
      const requiredExternal = body.requiredExternal ?? false;

      const report = evaluateDrillResult({
        id: drillId,
        drillKind: existing.kind,
        executedAt: body.executedAt,
        participantCount: body.participantCount,
        ...(typeof expectedCount === 'number' ? { expectedCount } : {}),
        responseTimeSeconds: body.responseTimeSeconds,
        ...(typeof benchmarkSeconds === 'number' ? { benchmarkSeconds } : {}),
        observedGaps,
        requiredExternal,
      });

      const update: Partial<StoredDrill> = {
        status: 'completed',
        executedAt: body.executedAt,
        participantCount: body.participantCount,
        expectedCount,
        responseTimeSeconds: body.responseTimeSeconds,
        benchmarkSeconds,
        observedGaps,
        requiredExternal,
        notes: body.notes,
        report: {
          participationRate: report.participationRate,
          speedDeficitPercent: report.speedDeficitPercent,
          level: report.level,
          recommendations: report.recommendations,
        },
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(update)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await docRef.set(cleaned, { merge: true });
      await auditServerEvent(req, 'drillsManager.execute', 'drillsManager', {
        projectId,
        drillId,
        level: report.level,
      }, { projectId });

      const after = await docRef.get();
      const merged: StoredDrill = {
        id: after.id,
        ...(after.data() as Omit<StoredDrill, 'id'>),
      };
      return res.status(200).json({ ok: true, drill: merged });
    } catch (err) {
      logger.error?.('drillsManager.execute.error', err);
      captureRouteError(err, 'drillsManager.execute');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
