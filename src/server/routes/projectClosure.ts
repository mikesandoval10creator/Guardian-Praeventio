// Praeventio Guard — §131-138 Cierre de Proyecto + Lecciones Transferibles +
//                       Decisiones Críticas + Resúmenes Multi-Rol.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/closure/*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 6 endpoints (matching hook contract en useProjectClosure.ts):
//   GET  /:projectId/closure/status                     → ClosureStatusResponse
//   GET  /:projectId/closure/summary?role=…             → ClosureSummaryResponse
//   POST /:projectId/closure/initiate                   → ClosureState
//   POST /:projectId/closure/lessons                    → CapturedLesson
//   POST /:projectId/closure/decisions                  → LoggedDecision
//   POST /:projectId/closure/finalize                   → ClosureState
//
// Storage:
//   tenants/{tid}/projects/{pid}/closure/state               → ClosureState
//   tenants/{tid}/projects/{pid}/closure/lessons/{id}        → StoredClosureLesson
//   tenants/{tid}/projects/{pid}/closure/decisions/{id}      → StoredCriticalDecision
//
// El bloque original quedó corrupto tras una migración anterior (handler
// orphan); esta reimplementación reconstruye el contrato desde el hook +
// el servicio `projectClosureService`.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { LessonsAdapter } from '../../services/lessonsLearned/lessonsFirestoreAdapter.js';

const router = Router();

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

// ── Types ─────────────────────────────────────────────────────────────

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

async function writeClosureState(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
  state: ClosureState,
): Promise<void> {
  await db
    .collection(`tenants/${tenantId}/projects/${projectId}/closure`)
    .doc('state')
    .set(state, { merge: false });
}

async function readPendingCounts(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
): Promise<{
  openIncidents: number;
  openActions: number;
  openPermits: number;
  lessonsCaptured: number;
  decisionsLogged: number;
}> {
  const safeCount = async (
    label: string,
    fn: () => Promise<number>,
  ): Promise<number> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn?.(`projectClosure.count.${label}.failed`, err);
      return 0;
    }
  };

  const [
    openIncidents,
    openActions,
    openPermits,
    lessonsCaptured,
    decisionsLogged,
  ] = await Promise.all([
    safeCount('incidents', async () => {
      const snap = await db
        .collection('incidents')
        .where('projectId', '==', projectId)
        .where('status', '==', 'open')
        .count()
        .get();
      return Number(snap.data().count ?? 0);
    }),
    safeCount('actions', async () => {
      const snap = await db
        .collection(
          `tenants/${tenantId}/projects/${projectId}/corrective_actions`,
        )
        .where('status', 'in', ['open', 'in_progress', 'reopened'])
        .count()
        .get();
      return Number(snap.data().count ?? 0);
    }),
    safeCount('permits', async () => {
      const snap = await db
        .collection(
          `tenants/${tenantId}/projects/${projectId}/work_permits`,
        )
        .where('status', '==', 'active')
        .count()
        .get();
      return Number(snap.data().count ?? 0);
    }),
    safeCount('lessons', async () => {
      const snap = await db
        .collection(
          `tenants/${tenantId}/projects/${projectId}/closure/lessons/items`,
        )
        .count()
        .get();
      return Number(snap.data().count ?? 0);
    }),
    safeCount('decisions', async () => {
      const snap = await db
        .collection(
          `tenants/${tenantId}/projects/${projectId}/closure/decisions/items`,
        )
        .count()
        .get();
      return Number(snap.data().count ?? 0);
    }),
  ]);

  return {
    openIncidents,
    openActions,
    openPermits,
    lessonsCaptured,
    decisionsLogged,
  };
}

// ── GET /:projectId/closure/status ────────────────────────────────────

router.get(
  '/:projectId/closure/status',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const [state, pending] = await Promise.all([
        readClosureState(db, g.tenantId, projectId),
        readPendingCounts(db, g.tenantId, projectId),
      ]);

      const blockers: string[] = [];
      const warnings: string[] = [];
      if (pending.openIncidents > 0) {
        blockers.push(
          `${pending.openIncidents} incidente(s) abierto(s). Cerrar antes de finalizar proyecto.`,
        );
      }
      if (pending.openActions > 0) {
        blockers.push(
          `${pending.openActions} acción(es) correctiva(s) abierta(s).`,
        );
      }
      if (pending.openPermits > 0) {
        blockers.push(
          `${pending.openPermits} permiso(s) de trabajo aún activo(s).`,
        );
      }
      if (pending.lessonsCaptured === 0) {
        warnings.push(
          'No se han capturado lecciones transferibles. Considera documentar al menos una antes del cierre.',
        );
      }

      // readinessPercent: 0..100 based on blockers + warnings.
      // Start at 100, subtract 25 per blocker (max 4 → 0), subtract 5
      // per warning. Floor at 0.
      let readinessPercent = 100;
      readinessPercent -= blockers.length * 25;
      readinessPercent -= warnings.length * 5;
      readinessPercent = Math.max(0, Math.min(100, readinessPercent));

      return res.json({
        state,
        readinessPercent,
        canClose: blockers.length === 0,
        blockers,
        warnings,
        pending,
      });
    } catch (err) {
      logger.error?.('projectClosure.status.error', err);
      captureRouteError(err, 'projectClosure.status');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/closure/initiate ─────────────────────────────────

router.post(
  '/:projectId/closure/initiate',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const current = await readClosureState(db, g.tenantId, projectId);
      if (current.status === 'finalized') {
        return res
          .status(409)
          .json({ error: 'project_already_finalized' });
      }
      const now = new Date().toISOString();
      const next: ClosureState = {
        status: 'initiated',
        initiatedAt: current.initiatedAt ?? now,
        initiatedByUid: current.initiatedByUid ?? callerUid,
        finalizedAt: null,
        finalizedByUid: null,
      };
      await writeClosureState(db, g.tenantId, projectId, next);
      return res.status(200).json({ ok: true, state: next });
    } catch (err) {
      logger.error?.('projectClosure.initiate.error', err);
      captureRouteError(err, 'projectClosure.initiate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/closure/lessons ──────────────────────────────────

const captureLessonSchema = z.object({
  summary: z.string().min(3).max(2000),
  preventiveAction: z.string().min(3).max(2000),
  industry: z.string().min(1).max(200),
  riskCategories: z.array(z.string().min(1)).max(50).optional(),
  tags: z.array(z.string().min(1)).max(50).optional(),
});

router.post(
  '/:projectId/closure/lessons',
  verifyAuth,
  validate(captureLessonSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof captureLessonSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const state = await readClosureState(db, g.tenantId, projectId);
      if (state.status === 'finalized') {
        return res
          .status(409)
          .json({ error: 'project_already_finalized' });
      }

      const now = new Date().toISOString();
      const lessonId = `cl_${Date.now()}_${randomUUID()}`;

      // Publish to global library F.12 with scope='industry'.
      const adapter = new LessonsAdapter(
        admin.firestore() as any,
        g.tenantId,
      );
      const publishedLessonId = `proj_${projectId}_${lessonId}`;
      let publishedOk = false;
      try {
        await adapter.save({
          id: publishedLessonId,
          summary: body.summary,
          preventiveAction: body.preventiveAction,
          riskCategories: body.riskCategories ?? [],
          tags: body.tags ?? [],
          scope: 'industry',
          industry: body.industry,
          derivedFromIncidentId: undefined,
          publishedAt: now,
          adoptionCount: 0,
        });
        publishedOk = true;
      } catch (err) {
        logger.warn?.('projectClosure.lessons.publish_failed', err);
      }

      const stored: StoredClosureLesson = {
        id: lessonId,
        summary: body.summary,
        preventiveAction: body.preventiveAction,
        riskCategories: body.riskCategories ?? [],
        tags: body.tags ?? [],
        industry: body.industry,
        capturedAt: now,
        capturedByUid: callerUid,
        publishedLessonId: publishedOk ? publishedLessonId : null,
      };
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/closure/lessons/items`,
        )
        .doc(lessonId)
        .set(stored);

      return res.status(201).json({ ok: true, lesson: stored });
    } catch (err) {
      logger.error?.('projectClosure.lessons.error', err);
      captureRouteError(err, 'projectClosure.lessons');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/closure/decisions ────────────────────────────────

const logDecisionSchema = z.object({
  decidedAt: z.string().min(10),
  context: z.string().min(1).max(4000),
  decision: z.string().min(1).max(4000),
  outcome: z.enum(['positive', 'neutral', 'negative']),
  decidedByUid: z.string().min(1).max(200).optional(),
});

router.post(
  '/:projectId/closure/decisions',
  verifyAuth,
  validate(logDecisionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof logDecisionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const state = await readClosureState(db, g.tenantId, projectId);
      if (state.status === 'finalized') {
        return res
          .status(409)
          .json({ error: 'project_already_finalized' });
      }

      const now = new Date().toISOString();
      const decisionId = `cd_${Date.now()}_${randomUUID()}`;
      const stored: StoredCriticalDecision = {
        id: decisionId,
        decidedAt: body.decidedAt,
        context: body.context,
        decision: body.decision,
        decidedByUid: body.decidedByUid ?? callerUid,
        outcome: body.outcome,
        loggedAt: now,
        loggedByUid: callerUid,
      };
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/closure/decisions/items`,
        )
        .doc(decisionId)
        .set(stored);

      return res.status(201).json({ ok: true, decision: stored });
    } catch (err) {
      logger.error?.('projectClosure.decisions.error', err);
      captureRouteError(err, 'projectClosure.decisions');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/closure/finalize ─────────────────────────────────

router.post(
  '/:projectId/closure/finalize',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const current = await readClosureState(db, g.tenantId, projectId);
      if (current.status === 'finalized') {
        return res
          .status(409)
          .json({ error: 'project_already_finalized' });
      }
      // Recompute readiness to ensure no blockers exist before finalize.
      const pending = await readPendingCounts(db, g.tenantId, projectId);
      if (
        pending.openIncidents > 0 ||
        pending.openActions > 0 ||
        pending.openPermits > 0
      ) {
        return res
          .status(422)
          .json({ error: 'blockers_present', pending });
      }
      const now = new Date().toISOString();
      const next: ClosureState = {
        status: 'finalized',
        initiatedAt: current.initiatedAt ?? now,
        initiatedByUid: current.initiatedByUid ?? callerUid,
        finalizedAt: now,
        finalizedByUid: callerUid,
      };
      await writeClosureState(db, g.tenantId, projectId, next);
      return res.status(200).json({ ok: true, state: next });
    } catch (err) {
      logger.error?.('projectClosure.finalize.error', err);
      captureRouteError(err, 'projectClosure.finalize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/closure/summary ───────────────────────────────────

type SummaryAudience =
  | 'management'
  | 'client'
  | 'operations'
  | 'regulatory';

function roleToAudience(role: string | undefined): SummaryAudience {
  switch (role) {
    case 'gerencia':
      return 'management';
    case 'supervisor':
      return 'operations';
    case 'worker':
      return 'operations';
    case 'management':
      return 'management';
    case 'client':
      return 'client';
    case 'operations':
      return 'operations';
    case 'regulatory':
      return 'regulatory';
    default:
      return 'operations';
  }
}

router.get(
  '/:projectId/closure/summary',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { buildSummary } = await import(
        '../../services/projectClosure/projectClosureService.js'
      );
      const role =
        typeof req.query.role === 'string' ? req.query.role : 'operations';
      const audience = roleToAudience(role);

      const db = admin.firestore();
      const safeCount = async (
        label: string,
        fn: () => Promise<number>,
      ): Promise<number> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`projectClosure.summary.count.${label}.failed`, err);
          return 0;
        }
      };
      const [lessons, decisions, incidents, criticalIncidents] =
        await Promise.all([
          safeCount('lessons', async () => {
            const snap = await db
              .collection(
                `tenants/${g.tenantId}/projects/${projectId}/closure/lessons/items`,
              )
              .count()
              .get();
            return Number(snap.data().count ?? 0);
          }),
          safeCount('decisions', async () => {
            const snap = await db
              .collection(
                `tenants/${g.tenantId}/projects/${projectId}/closure/decisions/items`,
              )
              .count()
              .get();
            return Number(snap.data().count ?? 0);
          }),
          safeCount('incidents', async () => {
            const snap = await db
              .collection('incidents')
              .where('projectId', '==', projectId)
              .count()
              .get();
            return Number(snap.data().count ?? 0);
          }),
          safeCount('criticalIncidents', async () => {
            const snap = await db
              .collection('incidents')
              .where('projectId', '==', projectId)
              .where('severity', 'in', ['critical', 'sif'])
              .count()
              .get();
            return Number(snap.data().count ?? 0);
          }),
        ]);

      // Build a synthetic snapshot for buildSummary.
      const summary = buildSummary(audience, {
        projectId,
        closedAt: new Date().toISOString(),
        closedByUid: callerUid,
        totalIncidents: incidents,
        criticalIncidents,
        preventedIncidentsEstimated: 0,
        totalActionsCompleted: 0,
        totalSitebookEntries: 0,
        totalTrainingHours: 0,
        averageComplianceScore: 0,
        criticalDecisions: [],
        transferableLessons: [],
        retentionRecommendations: [],
        improvementOpportunities: [],
      });

      return res.json({
        summary,
        role,
        audience,
        counts: {
          lessons,
          decisions,
          incidents,
          criticalIncidents,
        },
      });
    } catch (err) {
      logger.error?.('projectClosure.summary.error', err);
      captureRouteError(err, 'projectClosure.summary');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
