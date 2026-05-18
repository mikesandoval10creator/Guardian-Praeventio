// Praeventio Guard — §291-295 Revisión Anual del SGI (ISO 45001 §9.3).
//
// Endpoints dedicados para `/api/sprint-k/:projectId/annual-review/*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 4 endpoints:
//   GET  /:projectId/annual-review/current[?year=N]
//   POST /:projectId/annual-review/objectives
//   POST /:projectId/annual-review/evidence
//   POST /:projectId/annual-review/conclude
//
// Storage: `tenants/{tid}/projects/{pid}/annual_reviews/{year}` (un doc
// por fiscal year). Una vez concluida, ningún edit más (409).

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

// ── Helpers + schemas ─────────────────────────────────────────────────

const annualReviewPath = (
  tenantId: string,
  projectId: string,
  year: number,
) => `tenants/${tenantId}/projects/${projectId}/annual_reviews/${year}`;

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
    .enum([
      'planned',
      'in_progress',
      'on_track',
      'at_risk',
      'achieved',
      'missed',
    ])
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

// ── GET /:projectId/annual-review/current ─────────────────────────────

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
        typeof req.query.year === 'string'
          ? Number.parseInt(req.query.year, 10)
          : NaN;
      const year =
        Number.isInteger(yearParam) &&
        yearParam >= 2000 &&
        yearParam <= 2100
          ? yearParam
          : new Date().getUTCFullYear();
      const ref = admin
        .firestore()
        .doc(annualReviewPath(g.tenantId, projectId, year));
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T>,
      ): Promise<T | null> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`annualReview.read.${label}.failed`, err);
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
      logger.error?.('annualReview.current.error', err);
      captureRouteError(err, 'annualReview.current');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/annual-review/objectives ─────────────────────────

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
            ? (
                (req.body as Record<string, unknown>).analysis as string
              ).slice(0, 8000)
            : existing.analysis,
        updatedAt: new Date().toISOString(),
        updatedByUid: callerUid,
      };
      await ref.set(next, { merge: false });
      return res.status(200).json({ ok: true, snapshot: next });
    } catch (err) {
      logger.error?.('annualReview.objectives.error', err);
      captureRouteError(err, 'annualReview.objectives');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/annual-review/evidence ───────────────────────────

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
        return {
          ...o,
          evidenceUrls: [...o.evidenceUrls, body.evidenceUrl],
        };
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
      logger.error?.('annualReview.evidence.error', err);
      captureRouteError(err, 'annualReview.evidence');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/annual-review/conclude ───────────────────────────

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
      logger.error?.('annualReview.conclude.error', err);
      captureRouteError(err, 'annualReview.conclude');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
