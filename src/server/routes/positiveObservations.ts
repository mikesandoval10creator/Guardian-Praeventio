// Praeventio Guard — §214-215 Observaciones Positivas + Balance.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/positive-observations*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 4 endpoints:
//   GET  /:projectId/positive-observations/worker/:workerUid  → lista por worker
//   POST /:projectId/positive-observations                    → crear nueva obs.
//   GET  /:projectId/positive-observations[?period=30d|90d|all&startAfter=docId]
//     → listing global con paginación (cap 500/página, ordenado newest-first)
//   GET  /:projectId/positive-observations/balance[?period=...]
//     → ratio §215 positivas/correctivas usando count() aggregates
//
// Filosofía detrás de §214-215: cultura preventiva sana NO solo registra lo
// malo — la observación positiva refuerza comportamientos seguros y es la
// pieza opuesta al sesgo punitivo de las correctivas.

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
import { PositiveObservationsAdapter } from '../../services/positiveObservations/positiveObservationsFirestoreAdapter.js';

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

// ── Period helpers ────────────────────────────────────────────────────

type ObservationPeriod = '30d' | '90d' | 'all';

function periodToSinceIso(period: ObservationPeriod): string | null {
  if (period === 'all') return null;
  const ms =
    period === '30d' ? 30 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function parsePeriod(raw: unknown): ObservationPeriod {
  if (raw === '30d' || raw === '90d' || raw === 'all') return raw;
  return '30d';
}

const POSITIVE_OBSERVATIONS_PAGE_LIMIT = 500;

// ── GET /:projectId/positive-observations/worker/:workerUid ───────────

router.get(
  '/:projectId/positive-observations/worker/:workerUid',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, workerUid } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new PositiveObservationsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const list = await adapter.listForWorker(workerUid);
      return res.json({ observations: list });
    } catch (err) {
      logger.error?.('positiveObservations.worker.error', err);
      captureRouteError(err, 'positiveObservations.worker');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/positive-observations ────────────────────────────

const positiveObsSchema = z.object({
  id: z.string().min(1),
  observedWorkerUid: z.string().min(1),
  kind: z.enum([
    'safe_behavior',
    'improvement_idea',
    'helpful_intervention',
    'creative_workaround',
    'mentoring_action',
  ]),
  description: z.string().min(5).max(2000),
  observedAt: z.string().min(10),
  location: z.string().min(1).max(200),
  shared: z.boolean().optional(),
});

router.post(
  '/:projectId/positive-observations',
  verifyAuth,
  validate(positiveObsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerRole = req.user!.role ?? 'worker';
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof positiveObsSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new PositiveObservationsAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      await adapter.save({
        ...body,
        observerUid: callerUid,
        observerRole: callerRole,
        shared: body.shared ?? false,
      });
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('positiveObservations.create.error', err);
      captureRouteError(err, 'positiveObservations.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/positive-observations (listing global con paginación) ──

router.get(
  '/:projectId/positive-observations',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const period = parsePeriod(req.query.period);
    const rawStartAfter = req.query.startAfter;
    const startAfterId =
      typeof rawStartAfter === 'string' && rawStartAfter.trim().length > 0
        ? rawStartAfter.trim()
        : null;
    try {
      const db = admin.firestore();
      const path = `tenants/${g.tenantId}/projects/${projectId}/positive_observations`;
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`positiveObservations.list.${label}.failed`, err);
          return [];
        }
      };
      const sinceIso = periodToSinceIso(period);
      const observations = await safeRead(
        'positive_observations',
        async () => {
          let query: FirebaseFirestore.Query = sinceIso
            ? db.collection(path).where('observedAt', '>=', sinceIso)
            : db.collection(path);
          query = query.orderBy('observedAt', 'desc');
          if (startAfterId) {
            const cursorSnap = await db
              .collection(path)
              .doc(startAfterId)
              .get();
            if (cursorSnap.exists) {
              query = query.startAfter(cursorSnap);
            } else {
              logger.warn?.(
                'positiveObservations.list.startAfter.notFound',
                { startAfterId },
              );
            }
          }
          const snap = await query
            .limit(POSITIVE_OBSERVATIONS_PAGE_LIMIT + 1)
            .get();
          return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }));
        },
      );
      const hasMore = observations.length > POSITIVE_OBSERVATIONS_PAGE_LIMIT;
      const pageItems = hasMore
        ? observations.slice(0, POSITIVE_OBSERVATIONS_PAGE_LIMIT)
        : observations;
      const nextStartAfter = hasMore
        ? (pageItems[pageItems.length - 1] as { id?: string } | undefined)?.id ??
          null
        : null;
      if (hasMore) {
        logger.warn?.('positiveObservations.list.pageCapped', {
          projectId,
          period,
          limit: POSITIVE_OBSERVATIONS_PAGE_LIMIT,
        });
      }
      return res.json({
        observations: pageItems,
        period,
        pagination: {
          limit: POSITIVE_OBSERVATIONS_PAGE_LIMIT,
          hasMore,
          nextStartAfter,
        },
      });
    } catch (err) {
      logger.error?.('positiveObservations.list.error', err);
      captureRouteError(err, 'positiveObservations.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/positive-observations/balance ─────────────────────

router.get(
  '/:projectId/positive-observations/balance',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const period = parsePeriod(req.query.period);
    try {
      const { computeBalance } = await import(
        '../../services/positiveObservations/positiveObservationsService.js'
      );
      const db = admin.firestore();
      const tenantProjectPath = `tenants/${g.tenantId}/projects/${projectId}`;
      const sinceIso = periodToSinceIso(period);

      const safeCount = async (
        label: string,
        fn: () => Promise<number>,
      ): Promise<number> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(
            `positiveObservations.balance.${label}.failed`,
            err,
          );
          return 0;
        }
      };

      const correctivesPath = `${tenantProjectPath}/corrective_actions`;
      let correctivePeriodBasis: 'dueDate' | 'all' = sinceIso
        ? 'dueDate'
        : 'all';
      const [positiveCount, correctiveCount] = await Promise.all([
        safeCount('positive', async () => {
          const base = db.collection(
            `${tenantProjectPath}/positive_observations`,
          );
          const query = sinceIso
            ? base.where('observedAt', '>=', sinceIso)
            : base;
          const snap = await query.count().get();
          return Number(snap.data().count ?? 0);
        }),
        safeCount('corrective', async () => {
          const base = db.collection(correctivesPath);
          if (!sinceIso) {
            const snap = await base.count().get();
            return Number(snap.data().count ?? 0);
          }
          try {
            const snap = await base
              .where('dueDate', '>=', sinceIso)
              .count()
              .get();
            return Number(snap.data().count ?? 0);
          } catch (err) {
            logger.warn?.(
              'positiveObservations.balance.corrective.dueDateFilter.failed',
              err,
            );
            correctivePeriodBasis = 'all';
            const snap = await base.count().get();
            return Number(snap.data().count ?? 0);
          }
        }),
      ]);

      const balance = computeBalance({ positiveCount, correctiveCount });
      const ratio =
        correctiveCount > 0 ? positiveCount / correctiveCount : positiveCount;
      const correctivePeriod: ObservationPeriod =
        correctivePeriodBasis === 'dueDate' ? period : 'all';
      return res.json({
        positive: positiveCount,
        corrective: correctiveCount,
        ratio,
        period,
        positivePeriod: period,
        correctivePeriod,
        correctivePeriodBasis,
        balance,
      });
    } catch (err) {
      logger.error?.('positiveObservations.balance.error', err);
      captureRouteError(err, 'positiveObservations.balance');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
