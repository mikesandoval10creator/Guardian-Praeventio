// Praeventio Guard — §195-200 Ciclo PDCA + No Conformidades (ISO 45001 §10.2).
//
// Endpoints dedicados para `/api/sprint-k/:projectId/pdca/*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 5 endpoints:
//   GET  /:projectId/pdca/cycles                  → list active cycles
//   POST /:projectId/pdca/cycles                  → create cycle for NC
//   POST /:projectId/pdca/cycles/:id/advance      → P→D→C→A transition
//   GET  /:projectId/pdca/non-conformities        → list NCs
//   POST /:projectId/pdca/non-conformities        → create NC inline
//   GET  /:projectId/pdca/summary                 → counts per phase + closure rate
//
// Storage:
//   tenants/{tid}/projects/{pid}/pdca_cycles/{id}        — PDCAProject
//   tenants/{tid}/projects/{pid}/non_conformities/{id}   — NonConformity
//
// Directiva 3 (product_signing_no_blocking_directives): NUNCA push a
// SUSESO/SII/MINSAL/OSHA. Solo persistimos el ciclo; la empresa firma+entrega.

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

// ── Schemas + helpers ─────────────────────────────────────────────────

const pdcaOriginEnum = z.enum([
  'audit',
  'incident',
  'finding',
  'inspection',
]);

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

async function pdcaSafeRead<T>(
  label: string,
  fn: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    logger.warn?.(`pdca.read.${label}.failed`, err);
    return [];
  }
}

// ── GET /:projectId/pdca/cycles ───────────────────────────────────────

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
    logger.error?.('pdca.list.error', err);
    captureRouteError(err, 'pdca.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/pdca/cycles ──────────────────────────────────────

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
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`,
        )
        .doc(body.id)
        .set(project, { merge: false });
      await auditServerEvent(
        req,
        'pdca.createCycle',
        'pdca',
        { cycleId: body.id, nonConformityId: body.nonConformityId },
        { projectId },
      );
      return res.status(201).json({ ok: true, cycle: project });
    } catch (err) {
      logger.error?.('pdca.create.error', err);
      captureRouteError(err, 'pdca.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/pdca/cycles/:id/advance ──────────────────────────

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
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/pdca_cycles`,
        )
        .doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'cycle_not_found' });
      }
      const stored = snap.data() as StoredCycle;
      const nowIso = new Date().toISOString();

      const stages = [...(stored.stages ?? [])];
      let lastIdx = -1;
      for (let i = stages.length - 1; i >= 0; i--) {
        if (stages[i].kind === stored.currentStage) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx < 0) {
        return res
          .status(400)
          .json({ error: 'no_entry_for_current_stage' });
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
      await auditServerEvent(
        req,
        'pdca.advanceCycle',
        'pdca',
        { cycleId: id, currentStage: merged.currentStage },
        { projectId },
      );
      return res.json({ ok: true, cycle: merged });
    } catch (err) {
      logger.error?.('pdca.advance.error', err);
      captureRouteError(err, 'pdca.advance');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/pdca/non-conformities ─────────────────────────────

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
      logger.error?.('pdca.nc.list.error', err);
      captureRouteError(err, 'pdca.nc.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/pdca/non-conformities ────────────────────────────

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
      await auditServerEvent(
        req,
        'pdca.createNonConformity',
        'pdca',
        { nonConformityId: body.id, severity: body.severity },
        { projectId },
      );
      return res.status(201).json({ ok: true, nonConformity: nc });
    } catch (err) {
      logger.error?.('pdca.nc.create.error', err);
      captureRouteError(err, 'pdca.nc.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/pdca/summary ──────────────────────────────────────

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
    const cycles = await pdcaSafeRead<StoredCycleRow>(
      'cycles',
      async () => {
        const snap = await db.collection(cyclesPath).get();
        return snap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...(d.data() as Record<string, unknown>),
            }) as StoredCycleRow,
        );
      },
    );

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
    logger.error?.('pdca.summary.error', err);
    captureRouteError(err, 'pdca.summary');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
