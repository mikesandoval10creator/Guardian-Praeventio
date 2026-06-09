// Praeventio Guard — First Responder Map HTTP surface.
//
// Sprint 52 §219 — two stateless endpoints over the engine under
// `src/services/firstResponderMap/firstResponderMap.ts`:
//
//   POST /:projectId/first-responder-map/build-dispatch-plan
//     body: { responders, incident, options?, now? }
//     200:  { plan: DispatchPlan }
//
//   POST /:projectId/first-responder-map/analyze-coverage
//     body: { responders }
//     200:  { gaps: CoverageGap[] }
//
// Pure compute — no Firestore writes.

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
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  buildDispatchPlan,
  analyzeCoverage,
  type Responder,
  type ResponderRole,
  type AvailabilityState,
  type IncidentKind,
  type IncidentLocation,
} from '../../services/firstResponderMap/firstResponderMap.js';
import {
  buildResponderFeed,
  type LastKnownPosition,
} from '../../services/firstResponderMap/responderFeed.js';
import type {
  BrigadeMember,
  BrigadeRole,
} from '../../services/emergencyBrigade/emergencyBrigadeService.js';

const router = Router();

// Positions older than this (seconds) are dropped — a stale GPS fix must NOT
// drive a dispatch decision.
const POSITION_MAX_STALE_SECONDS = 1800; // 30 min

/** Resolve the tenant for a project (mirrors emergencyBrigade.ts:52). */
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
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

const ROLES: readonly ResponderRole[] = [
  'paramedic',
  'first_aid_certified',
  'fire_brigade',
  'rescue_specialist',
  'supervisor',
  'security_guard',
  'mutual_contact',
  'site_doctor',
];
const AVAILABILITIES: readonly AvailabilityState[] = [
  'on_duty',
  'on_break',
  'off_site',
  'unavailable',
  'in_response',
];
const KINDS: readonly IncidentKind[] = [
  'medical_emergency',
  'cardiac_arrest',
  'trauma_injury',
  'fire',
  'chemical_exposure',
  'fall_from_height',
  'confined_space_rescue',
  'electrical_injury',
  'mass_casualty',
];

const responderSchema = z.object({
  uid: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  roles: z.array(z.enum(ROLES as readonly [ResponderRole, ...ResponderRole[]])).max(ROLES.length),
  currentPosition: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      floor: z.number().int().min(-100).max(500).optional(),
    })
    .optional(),
  lastSeenAt: z.string().min(10).optional(),
  availability: z.enum(AVAILABILITIES as readonly [AvailabilityState, ...AvailabilityState[]]),
  sifCertified: z.boolean().optional(),
  activeAssignments: z.number().int().nonnegative().max(10_000).optional(),
  maxConcurrent: z.number().int().positive().max(10_000).optional(),
}) as unknown as z.ZodType<Responder>;

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  floor: z.number().int().min(-100).max(500).optional(),
  zoneId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<IncidentLocation>;

// ────────────────────────────────────────────────────────────────────────
// 1. build-dispatch-plan
// ────────────────────────────────────────────────────────────────────────

const dispatchSchema = z.object({
  responders: z.array(responderSchema).max(10_000),
  incident: z.object({
    kind: z.enum(KINDS as readonly [IncidentKind, ...IncidentKind[]]),
    location: locationSchema,
  }),
  options: z
    .object({
      walkSpeedMps: z.number().positive().max(20).optional(),
      maxLastSeenStaleSeconds: z.number().int().positive().max(86_400).optional(),
    })
    .optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/first-responder-map/build-dispatch-plan',
  verifyAuth,
  validate(dispatchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof dispatchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const now = body.now ? new Date(body.now) : new Date();
      const plan = buildDispatchPlan(
        body.responders,
        body.incident,
        now,
        body.options ?? {},
      );
      return res.json({ plan });
    } catch (err) {
      logger.error?.('firstResponderMap.buildDispatchPlan.error', err);
      captureRouteError(err, 'firstResponderMap.buildDispatchPlan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. analyze-coverage
// ────────────────────────────────────────────────────────────────────────

const coverageSchema = z.object({
  responders: z.array(responderSchema).max(10_000),
});

router.post(
  '/:projectId/first-responder-map/analyze-coverage',
  verifyAuth,
  validate(coverageSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof coverageSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const gaps = analyzeCoverage(body.responders);
      return res.json({ gaps });
    } catch (err) {
      logger.error?.('firstResponderMap.analyzeCoverage.error', err);
      captureRouteError(err, 'firstResponderMap.analyzeCoverage');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. responder-feed — BUILD the real Responder[] from existing data.
//
//   GET /:projectId/first-responder-map/responder-feed
//   200: { responders: Responder[], coverageGaps: CoverageGap[] }
//
// Real sources (NO fabrication):
//   • Roster:    tenants/{tid}/projects/{pid}/emergency_brigade (docType=member)
//   • Position:  tenants/{tid}/emergency_alerts (uid + geo{lat,lng} + createdAt)
//   • Name:      users/{uid}.displayName (fallback: uid)
// A member with no recent position ping ⇒ position omitted ⇒ the engine emits
// `no_position_known` and the responder is honestly unavailable for dispatch.
// Read-only derivation over existing collections — no new state written.
// ────────────────────────────────────────────────────────────────────────

async function readLastKnownPosition(
  db: admin.firestore.Firestore,
  tenantId: string,
  uid: string,
  nowMs: number,
): Promise<LastKnownPosition | undefined> {
  try {
    const snap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('emergency_alerts')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return undefined;
    const data = (snap.docs[0]?.data() ?? {}) as Record<string, unknown>;
    const geo = data.geo as
      | { lat?: unknown; lng?: unknown; floor?: unknown }
      | null
      | undefined;
    if (
      !geo ||
      typeof geo.lat !== 'number' ||
      typeof geo.lng !== 'number' ||
      !Number.isFinite(geo.lat) ||
      !Number.isFinite(geo.lng)
    ) {
      return undefined;
    }
    // createdAt may be a Firestore Timestamp (.toDate()) or an ISO string.
    const rawTs = data.createdAt as { toDate?: () => Date } | string | null | undefined;
    let seenMs: number;
    let seenIso: string;
    if (rawTs && typeof rawTs === 'object' && typeof rawTs.toDate === 'function') {
      const d = rawTs.toDate();
      seenMs = d.getTime();
      seenIso = d.toISOString();
    } else if (typeof rawTs === 'string') {
      seenMs = Date.parse(rawTs);
      seenIso = rawTs;
    } else {
      return undefined;
    }
    if (!Number.isFinite(seenMs)) return undefined;
    // Drop stale fixes — never let an old position drive dispatch.
    if ((nowMs - seenMs) / 1000 > POSITION_MAX_STALE_SECONDS) return undefined;
    const pos: LastKnownPosition = {
      uid,
      lat: geo.lat,
      lng: geo.lng,
      seenAt: seenIso,
    };
    if (typeof geo.floor === 'number' && Number.isFinite(geo.floor)) {
      pos.floor = geo.floor;
    }
    return pos;
  } catch (err) {
    logger.warn?.('firstResponderMap.readLastKnownPosition.failed', err);
    return undefined; // honest: no position known on read failure
  }
}

router.get(
  '/:projectId/first-responder-map/responder-feed',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const tenantId = await resolveTenantId(callerUid, projectId, db);
      if (!tenantId) {
        return res.status(404).json({ error: 'tenant_not_found' });
      }
      const now = new Date();
      const nowMs = now.getTime();

      // 1. Real roster (brigade members).
      let roster: BrigadeMember[] = [];
      try {
        const snap = await db
          .collection(
            `tenants/${tenantId}/projects/${projectId}/emergency_brigade`,
          )
          .where('docType', '==', 'member')
          .get();
        roster = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              workerUid: String(data.workerUid ?? ''),
              role: (data.role ?? 'brigade_chief') as BrigadeRole,
              trainedAt: String(data.trainedAt ?? ''),
              trainingValidYears:
                typeof data.trainingValidYears === 'number'
                  ? data.trainingValidYears
                  : 2,
              active: data.active !== false,
            };
          })
          .filter((m) => m.workerUid.length > 0);
      } catch (err) {
        logger.warn?.('firstResponderMap.roster.read.failed', err);
        roster = []; // honest empty feed → coverage gaps surface, no 5xx
      }

      // 2. Real last-known position + display name per ACTIVE member.
      const uniqueUids = Array.from(
        new Set(roster.filter((m) => m.active).map((m) => m.workerUid)),
      );
      const positionsByUid: Record<string, LastKnownPosition> = {};
      const nameByUid: Record<string, string> = {};
      await Promise.all(
        uniqueUids.map(async (uid) => {
          const pos = await readLastKnownPosition(db, tenantId, uid, nowMs);
          if (pos) positionsByUid[uid] = pos;
          try {
            const u = await db.collection('users').doc(uid).get();
            const name = u.exists
              ? (u.data() as { displayName?: unknown }).displayName
              : undefined;
            if (typeof name === 'string' && name.length > 0) {
              nameByUid[uid] = name;
            }
          } catch (err) {
            logger.warn?.('firstResponderMap.name.read.failed', err);
          }
        }),
      );

      // 3. Pure mapping → Responder[].
      const responders = buildResponderFeed(
        roster,
        nameByUid,
        positionsByUid,
        now,
      );
      const coverageGaps = analyzeCoverage(responders);

      // 4. PII-position read is audited (Ley 19.628 access trail).
      try {
        await auditServerEvent(
          req,
          'firstResponderMap.responderFeed',
          'firstResponderMap',
          {
            projectId,
            responderCount: responders.length,
            withPosition: Object.keys(positionsByUid).length,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error?.(
          'firstResponderMap.responderFeed.audit_failed',
          auditErr,
        );
      }

      return res.json({ responders, coverageGaps });
    } catch (err) {
      logger.error?.('firstResponderMap.responderFeed.error', err);
      captureRouteError(err, 'firstResponderMap.responderFeed');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
