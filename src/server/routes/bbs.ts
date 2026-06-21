// Praeventio Guard — Behavior-Based Safety (BBS) HTTP surface.
//
// Sprint K — endpoints over the engine under
// `src/services/behaviorObservation/bbsObservationEngine.ts`:
//
//   POST /:projectId/bbs/record-observation                       — STATEFUL
//     body: { observationId, areaId, category, outcome, note }
//     201:  { observation: BbsObservation }
//     400:  { error: 'validation_error', code, message }
//     Persists the validated observation to
//     `tenants/{tenantId}/projects/{projectId}/bbs_observations/{observationId}`
//     via the Admin SDK (clients never write — firestore.rules deny). The
//     server stamps observerUid (caller, anti-blame) + tenantId + observedAt;
//     audit-log awaited.
//
//   POST /:projectId/bbs/build-profile                            — stateless
//     body: { observations, windowStart, windowEnd }
//     200:  { profile: BbsProfile }
//     400:  { error: 'validation_error', code, message }
//
//   GET  /:projectId/bbs/profile?days=30                          — STATEFUL
//     200:  { profile: BbsProfile }
//     Reads the project's REAL persisted observations within the window and
//     computes the BbsProfile via the engine. Honest empty-state: a project
//     with no recorded observations returns a zeroed profile (no fabrication).
//
// observerUid is a server-side identity override: BBS is anti-blaming,
// observador es siempre el caller. tenantId and now are server-controlled.

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
import {
  recordObservation,
  buildProfile,
  BbsValidationError,
  type BbsObservation,
  type ObservationCategory,
  type BehaviorOutcome,
} from '../../services/behaviorObservation/bbsObservationEngine.js';

const router = Router();

/** Resolve the tenant that owns a project (BBS observations are tenant-scoped). */
async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string' && data.tenantId.length > 0) {
    return data.tenantId;
  }
  const members = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .where('uid', '==', callerUid)
    .limit(1)
    .get();
  if (!members.empty) {
    const tid = members.docs[0]?.data()?.tenantId;
    if (typeof tid === 'string' && tid.length > 0) return tid;
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
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

/** `tenants/{tenantId}/projects/{projectId}/bbs_observations` collection. */
function observationsPath(tenantId: string, projectId: string): string {
  return `tenants/${tenantId}/projects/${projectId}/bbs_observations`;
}

const CATEGORIES: readonly ObservationCategory[] = [
  'epp',
  'positioning',
  'tools_equipment',
  'procedures',
  'housekeeping',
  'ergonomics',
  'communication',
];
const OUTCOMES: readonly BehaviorOutcome[] = ['safe', 'at_risk'];

// ────────────────────────────────────────────────────────────────────────
// 1. record-observation
// ────────────────────────────────────────────────────────────────────────

const recordSchema = z.object({
  observationId: z.string().min(1).max(200),
  areaId: z.string().min(1).max(200),
  category: z.enum(CATEGORIES as readonly [ObservationCategory, ...ObservationCategory[]]),
  outcome: z.enum(OUTCOMES as readonly [BehaviorOutcome, ...BehaviorOutcome[]]),
  note: z.string().min(5).max(5000),
});

router.post(
  '/:projectId/bbs/record-observation',
  verifyAuth,
  validate(recordSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recordSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    let observation: BbsObservation;
    try {
      // tenantId is the OWNING tenant (server-resolved), NOT the projectId.
      observation = recordObservation({
        observationId: body.observationId,
        tenantId: g.tenantId,
        areaId: body.areaId,
        category: body.category,
        outcome: body.outcome,
        note: body.note,
        observerUid: callerUid,
      });
    } catch (err) {
      if (err instanceof BbsValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('bbs.recordObservation.validate.error', err);
      captureRouteError(err, 'bbs.recordObservation.validate');
      return res.status(500).json({ error: 'internal_error' });
    }

    try {
      // Persist via Admin SDK (clients never write — firestore.rules deny).
      // The engine already stamped observerUid/tenantId/observedAt; the doc id
      // is the caller-supplied observationId (idempotent overwrite of the same
      // record). merge:false would clobber unrelated fields — there are none.
      await admin
        .firestore()
        .collection(observationsPath(g.tenantId, projectId))
        .doc(observation.observationId)
        .set({ ...observation, projectId });

      try {
        await auditServerEvent(
          req,
          'bbs.recordObservation',
          'behaviorObservation',
          {
            observationId: observation.observationId,
            projectId,
            tenantId: g.tenantId,
            areaId: observation.areaId,
            category: observation.category,
            outcome: observation.outcome,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error?.('bbs.recordObservation.audit_failed', auditErr);
        captureRouteError(auditErr, 'bbs.recordObservation.audit');
      }

      return res.status(201).json({ observation });
    } catch (err) {
      logger.error?.('bbs.recordObservation.error', err);
      captureRouteError(err, 'bbs.recordObservation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. build-profile
// ────────────────────────────────────────────────────────────────────────

const observationSchema = z.object({
  observationId: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  areaId: z.string().min(1).max(200),
  category: z.enum(CATEGORIES as readonly [ObservationCategory, ...ObservationCategory[]]),
  outcome: z.enum(OUTCOMES as readonly [BehaviorOutcome, ...BehaviorOutcome[]]),
  note: z.string().min(1).max(5000),
  observerUid: z.string().min(1).max(200),
  observedAt: z.string().min(10),
}) as unknown as z.ZodType<BbsObservation>;

const profileSchema = z.object({
  observations: z.array(observationSchema).max(50_000),
  windowStart: z.string().min(10),
  windowEnd: z.string().min(10),
});

router.post(
  '/:projectId/bbs/build-profile',
  verifyAuth,
  validate(profileSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof profileSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const profile = buildProfile({
        tenantId: g.tenantId,
        observations: body.observations,
        windowStart: new Date(body.windowStart),
        windowEnd: new Date(body.windowEnd),
      });
      return res.json({ profile });
    } catch (err) {
      if (err instanceof BbsValidationError) {
        return res.status(400).json({
          error: 'validation_error',
          code: err.code,
          message: err.message,
        });
      }
      logger.error?.('bbs.buildProfile.error', err);
      captureRouteError(err, 'bbs.buildProfile');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. GET profile — read REAL persisted observations → BbsProfile  (STATEFUL)
// ────────────────────────────────────────────────────────────────────────

const profileQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

router.get(
  '/:projectId/bbs/profile',
  verifyAuth,
  validate(profileQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const { days } = req.validated as z.infer<typeof profileQuerySchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;

    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      // Read the project's REAL persisted observations within the window.
      // Honest empty-state: a project with none returns a zeroed profile (the
      // engine produces safePercentage:0, empty categories) — no fabrication.
      const snap = await admin
        .firestore()
        .collection(observationsPath(g.tenantId, projectId))
        .where('observedAt', '>=', windowStart.toISOString())
        .get();

      const observations: BbsObservation[] = snap.docs
        .map((d) => d.data() as Partial<BbsObservation>)
        .filter(
          (o): o is BbsObservation =>
            typeof o.observationId === 'string' &&
            typeof o.tenantId === 'string' &&
            typeof o.areaId === 'string' &&
            typeof o.category === 'string' &&
            typeof o.outcome === 'string' &&
            typeof o.observedAt === 'string',
        );

      const profile = buildProfile({
        tenantId: g.tenantId,
        observations,
        windowStart,
        windowEnd,
      });
      return res.json({ profile });
    } catch (err) {
      logger.error?.('bbs.profile.error', err);
      captureRouteError(err, 'bbs.profile');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
