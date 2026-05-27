// Praeventio Guard — §276-277 Bitácora de Decisiones de Supervisión + Ranking.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/leadership/*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 3 endpoints:
//   GET  /:projectId/leadership/decisions[?supervisorUid=&period=]
//   POST /:projectId/leadership/decisions
//   GET  /:projectId/leadership/ranking[?period=]
//
// Storage: `tenants/{tid}/projects/{pid}/leadership_decisions/{id}`.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { randomId } from '../../utils/randomId.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

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

// ── GET /:projectId/leadership/decisions ──────────────────────────────

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
        typeof req.query.supervisorUid === 'string' &&
        req.query.supervisorUid.length > 0
          ? req.query.supervisorUid
          : null;
      const cutoff = periodCutoffIso(
        typeof req.query.period === 'string' ? req.query.period : '90d',
      );

      const safeRead = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.('leadership.decisions.read_failed', err);
          return [];
        }
      };

      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/leadership_decisions`,
      );

      const decisions = await safeRead<StoredLeadershipDecision>(
        async () => {
          let q: admin.firestore.Query = baseRef;
          if (supervisorUid)
            q = q.where('supervisorUid', '==', supervisorUid);
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
            a.decidedAt < b.decidedAt
              ? 1
              : a.decidedAt > b.decidedAt
                ? -1
                : 0,
          );
          return filtered;
        },
      );

      return res.json({ decisions });
    } catch (err) {
      logger.error?.('leadership.decisions.list.error', err);
      captureRouteError(err, 'leadership.decisions.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/leadership/decisions ─────────────────────────────

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
        `ld_${Date.now()}_${randomId().slice(0, 7)}`;
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
      logger.error?.('leadership.decisions.create.error', err);
      captureRouteError(err, 'leadership.decisions.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/leadership/ranking ────────────────────────────────

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
          logger.warn?.('leadership.ranking.read_failed', err);
          return [];
        }
      };

      const baseRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/leadership_decisions`,
      );

      const decisions = await safeRead<StoredLeadershipDecision>(
        async () => {
          const snap = await baseRef.limit(2000).get();
          const items = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<StoredLeadershipDecision, 'id'>),
          }));
          return cutoff
            ? items.filter((it) => it.decidedAt && it.decidedAt >= cutoff)
            : items;
        },
      );

      const ranking = rankSupervisorsByImpact(decisions);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('leadership.ranking.error', err);
      captureRouteError(err, 'leadership.ranking');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
