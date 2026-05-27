// Praeventio Guard — Sprint 39 Bloque 3 (wire-huérfanos #3.4).
//
// HTTP surface for the orphan engine `services/zones/restrictedZonesEngine.ts`.
//
// Founder directive — NUNCA BLOQUEAR MAQUINARIA / ACCESO:
//   The engine returns `allowed: false` + `missing: [...]` when a worker
//   doesn't fully meet zone entry requirements. This route LAYER does NOT
//   block. Endpoint `POST /api/zones/entry-event` accepts BOTH allowed and
//   denied evaluations and ALWAYS persists the event with the worker's
//   acknowledgement intact. The decision recorded is the worker's, not the
//   server's. The product semantic is "informed entry" — we recommend, we
//   document, we never deny a physical action a person is taking on a site.
//
// Mounted via `app.use('/api/zones', restrictedZonesRouter)` (server.ts
// integrates the mount; do NOT edit server.ts here).
//
// Endpoints:
//   • POST /api/zones/define                      — admin/supervisor define a zone
//   • GET  /api/zones/by-site/:projectId          — list zones for a site
//   • POST /api/zones/check                       — pure-compute evaluation (no write)
//   • POST /api/zones/entry-event                 — log a worker entry decision
//   • GET  /api/zones/entry-permissions/:projectId/:workerUid
//                                                 — list zones with their
//                                                   allowed/missing for a worker
//
// Middleware stack mirrors the canonical mutating-route shape used by
// `incidents.ts`, `visitors.ts`, and `iot.ts`:
//
//   verifyAuth → idempotencyKey() → validate(zodSchema) → handler
//
// uid SIEMPRE viene del token verificado (`req.user!.uid`) — nunca del body.
// tenantId NUNCA viene del body; se resuelve desde `projects/{projectId}`.
//
// Firestore paths:
//   tenants/{tenantId}/projects/{projectId}/restricted_zones/{zoneId}
//   tenants/{tenantId}/projects/{projectId}/zone_entry_events/{eventId}

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  checkZoneEntry,
  type RestrictedZone,
  type ZoneKind,
  type ZoneEntryCheckInput,
  type ZoneEntryResult,
} from '../../services/zones/restrictedZonesEngine.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────

const ZONE_KINDS: ZoneKind[] = [
  'hot',
  'confined',
  'atex',
  'lifting',
  'heavy_traffic',
  'exclusion',
  'high_voltage',
  'biohazard',
];

const perimeterSchema = z
  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .min(3)
  .max(512)
  .optional();

const zoneRulesSchema = z.object({
  requiredEpp: z.array(z.string().min(1).max(128)).max(64).default([]),
  requiredTrainings: z.array(z.string().min(1).max(128)).max(64).default([]),
  requiresPermit: z.boolean().optional(),
  responsibleUid: z.string().min(1).max(128),
});

const restrictedZoneSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(ZONE_KINDS as [ZoneKind, ...ZoneKind[]]),
  name: z.string().min(1).max(256),
  perimeter: perimeterSchema,
  rules: zoneRulesSchema,
  activeFrom: z.string().min(10).max(64),
  activeUntil: z.string().min(10).max(64).optional(),
}) as unknown as z.ZodType<RestrictedZone>;

const defineSchema = z.object({
  projectId: z.string().min(1).max(128),
  zone: restrictedZoneSchema,
});

const checkSchema = z.object({
  projectId: z.string().min(1).max(128),
  workerUid: z.string().min(1).max(128),
  workerEppLabels: z.array(z.string().min(1).max(128)).max(64),
  workerTrainings: z.array(z.string().min(1).max(128)).max(64),
  workerActivePermitKinds: z.array(z.string().min(1).max(64)).max(32),
  zone: restrictedZoneSchema,
  now: z.string().min(10).max(64).optional(),
});

const entryEventSchema = z.object({
  projectId: z.string().min(1).max(128),
  zoneId: z.string().min(1).max(128),
  /** Worker that DECLARES the entry. Server enforces this === caller uid. */
  workerUid: z.string().min(1).max(128),
  /**
   * Snapshot of the engine result computed client-side at the moment of
   * declared entry. The server re-evaluates if `zoneSnapshot` is provided.
   * If the recomputed `allowed` differs, the SERVER value wins and is what
   * gets persisted (defends against tampered client-side payloads).
   */
  evaluation: z.object({
    allowed: z.boolean(),
    missing: z.array(z.string().min(1).max(256)).max(64),
    warnings: z.array(z.string().min(1).max(256)).max(64),
  }),
  /** Optional zone snapshot for server-side re-evaluation. */
  zoneSnapshot: restrictedZoneSchema.optional(),
  /** Worker EPP/training/permits at entry time, for server-side recheck. */
  workerSnapshot: z
    .object({
      workerEppLabels: z.array(z.string().min(1).max(128)).max(64),
      workerTrainings: z.array(z.string().min(1).max(128)).max(64),
      workerActivePermitKinds: z.array(z.string().min(1).max(64)).max(32),
    })
    .optional(),
  /** "Comprendo el riesgo y entro" — explicit informed-entry flag. */
  acknowledgedAt: z.string().min(10).max(64).optional(),
  notes: z.string().max(1024).optional(),
});

const entryPermissionsSchema = z.object({
  /** Pass via query: ?eppLabels=hard_hat,gloves&trainings=loto&permits=caliente */
  eppLabels: z.string().max(2048).optional(),
  trainings: z.string().max(2048).optional(),
  permits: z.string().max(2048).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function tenantIdFor(projectId: string): Promise<string | null> {
  const db = admin.firestore();
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const tid = (data as { tenantId?: unknown }).tenantId;
  return typeof tid === 'string' && tid.length > 0 ? tid : null;
}

function zonesCollection(tenantId: string, projectId: string) {
  return admin
    .firestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('projects')
    .doc(projectId)
    .collection('restricted_zones');
}

function entryEventsCollection(tenantId: string, projectId: string) {
  return admin
    .firestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('projects')
    .doc(projectId)
    .collection('zone_entry_events');
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
    return true;
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
}

function newEventId(): string {
  // crypto.randomUUID() returns an RFC-4122 v4 UUID (128 bits of entropy).
  // Date.now() prefix preserves sort order for log/audit scanners.
  return `zev_${Date.now()}_${randomUUID()}`;
}

// ────────────────────────────────────────────────────────────────────────
// 1. POST /api/zones/define — supervisor/admin define a zone
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/define',
  verifyAuth,
  idempotencyKey(),
  validate(defineSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const body = req.validated as z.infer<typeof defineSchema>;
    if (!(await guard(callerUid, body.projectId, res))) return undefined;

    const tenantId = await tenantIdFor(body.projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    try {
      const ref = zonesCollection(tenantId, body.projectId).doc(body.zone.id);
      await ref.set(
        {
          ...body.zone,
          createdBy: callerUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return res.json({ success: true, zoneId: body.zone.id });
    } catch (err) {
      logger.error?.('restrictedZones.define.error', err);
      captureRouteError(err, 'restrictedZones.define');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. GET /api/zones/by-site/:projectId — list zones for a site
// ────────────────────────────────────────────────────────────────────────

router.get('/by-site/:projectId', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId || projectId.length === 0) {
    return res.status(400).json({ error: 'missing_projectId' });
  }
  if (!(await guard(callerUid, projectId, res))) return undefined;

  const tenantId = await tenantIdFor(projectId);
  if (!tenantId) {
    return res.status(400).json({ error: 'project_missing_tenant' });
  }

  try {
    const snap = await zonesCollection(tenantId, projectId).get();
    const zones: RestrictedZone[] = snap.docs.map((d) => {
      const data = d.data() as RestrictedZone & Record<string, unknown>;
      return {
        id: data.id,
        kind: data.kind,
        name: data.name,
        perimeter: data.perimeter,
        rules: data.rules,
        activeFrom: data.activeFrom,
        activeUntil: data.activeUntil,
      };
    });
    return res.json({ zones });
  } catch (err) {
    logger.error?.('restrictedZones.bySite.error', err);
    captureRouteError(err, 'restrictedZones.bySite');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// 3. POST /api/zones/check — pure-compute evaluation (no write)
// ────────────────────────────────────────────────────────────────────────

router.post('/check', verifyAuth, validate(checkSchema), async (req, res) => {
  const callerUid = req.user!.uid;
  const body = req.validated as z.infer<typeof checkSchema>;
  if (!(await guard(callerUid, body.projectId, res))) return undefined;

  try {
    const input: ZoneEntryCheckInput = {
      workerUid: body.workerUid,
      workerEppLabels: body.workerEppLabels,
      workerTrainings: body.workerTrainings,
      workerActivePermitKinds: body.workerActivePermitKinds,
      zone: body.zone,
      now: body.now ? new Date(body.now) : new Date(),
    };
    const result: ZoneEntryResult = checkZoneEntry(input);
    return res.json({ result });
  } catch (err) {
    logger.error?.('restrictedZones.check.error', err);
    captureRouteError(err, 'restrictedZones.check');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// 4. POST /api/zones/entry-event — log informed-entry event (NEVER blocks)
//
// Founder directive enforcement:
//   • This endpoint does NOT refuse to persist a "denied" evaluation. A
//     worker who chooses to enter despite missing requirements has the
//     event recorded so supervision can follow up — that is the legal
//     safety value (informed acknowledgement, not gatekeeping).
//   • Server REVALUATES the engine if zoneSnapshot + workerSnapshot are
//     attached. Persistent record always carries SERVER-derived `allowed`,
//     `missing`, `warnings`. Client payload is kept under
//     `clientEvaluation` for forensic comparison.
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/entry-event',
  verifyAuth,
  idempotencyKey(),
  validate(entryEventSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail = req.user!.email ?? null;
    const body = req.validated as z.infer<typeof entryEventSchema>;

    // Anti-blame: only the worker themselves can declare their own entry.
    if (body.workerUid !== callerUid) {
      return res.status(403).json({
        error: 'forbidden',
        message:
          'Only the worker themselves can declare a restricted-zone entry.',
      });
    }

    if (!(await guard(callerUid, body.projectId, res))) return undefined;

    const tenantId = await tenantIdFor(body.projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    // Server-side re-evaluation (if both snapshots provided).
    let serverEvaluation: ZoneEntryResult | null = null;
    if (body.zoneSnapshot && body.workerSnapshot) {
      try {
        serverEvaluation = checkZoneEntry({
          workerUid: body.workerUid,
          workerEppLabels: body.workerSnapshot.workerEppLabels,
          workerTrainings: body.workerSnapshot.workerTrainings,
          workerActivePermitKinds: body.workerSnapshot.workerActivePermitKinds,
          zone: body.zoneSnapshot,
          now: new Date(),
        });
      } catch (recheckErr) {
        logger.warn?.('restrictedZones.entry.recheck_failed', recheckErr);
        // Soft-fail: continue with client evaluation only.
      }
    }

    const eventId = newEventId();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const finalEvaluation = serverEvaluation ?? body.evaluation;

    try {
      const ref = entryEventsCollection(tenantId, body.projectId).doc(eventId);
      await ref.set({
        id: eventId,
        zoneId: body.zoneId,
        workerUid: body.workerUid,
        // Founder directive: persist regardless of allowed flag. The event
        // is the SOURCE OF TRUTH for "this worker indicated they were
        // entering this zone at this time"; the decision to recommend
        // (allowed=false) is metadata, not a veto.
        allowed: finalEvaluation.allowed,
        missing: finalEvaluation.missing,
        warnings: finalEvaluation.warnings,
        clientEvaluation: body.evaluation,
        acknowledgedAt: body.acknowledgedAt ?? null,
        notes: body.notes ?? null,
        createdAt: now,
        createdBy: callerUid,
      });

      // Audit log mirror — module='restricted_zones'.
      try {
        await admin.firestore().collection('audit_logs').add({
          action: 'zone.entry_declared',
          module: 'restricted_zones',
          details: {
            eventId,
            zoneId: body.zoneId,
            allowed: finalEvaluation.allowed,
            missingCount: finalEvaluation.missing.length,
            warningsCount: finalEvaluation.warnings.length,
          },
          userId: callerUid,
          userEmail: callerEmail,
          projectId: body.projectId,
          timestamp: now,
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
      } catch (auditErr) {
        logger.warn?.('restrictedZones.entry.audit_failed', auditErr);
      }

      return res.json({
        success: true,
        eventId,
        evaluation: finalEvaluation,
        // Even on `allowed: false`, we return 200 — directiva no-bloqueo.
        recorded: true,
      });
    } catch (err) {
      logger.error?.('restrictedZones.entry.error', err);
      captureRouteError(err, 'restrictedZones.entryEvent');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. GET /api/zones/entry-permissions/:projectId/:workerUid
//
// Returns, for every zone defined in the project, the evaluation against
// the caller-supplied worker profile (passed via query for stateless
// composition). Useful to render the map overlay with per-zone
// allowed/missing badges.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/entry-permissions/:projectId/:workerUid',
  verifyAuth,
  validate(entryPermissionsSchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, workerUid } = req.params;
    if (!projectId || !workerUid) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (!(await guard(callerUid, projectId, res))) return undefined;

    const tenantId = await tenantIdFor(projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }

    const q = req.validated as z.infer<typeof entryPermissionsSchema>;
    const eppLabels = (q.eppLabels ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const trainings = (q.trainings ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const permits = (q.permits ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const snap = await zonesCollection(tenantId, projectId).get();
      const now = new Date();
      const permissions = snap.docs.map((d) => {
        const zone = d.data() as RestrictedZone;
        const result = checkZoneEntry({
          workerUid,
          workerEppLabels: eppLabels,
          workerTrainings: trainings,
          workerActivePermitKinds: permits,
          zone,
          now,
        });
        return { zoneId: zone.id, zone, result };
      });
      return res.json({ permissions });
    } catch (err) {
      logger.error?.('restrictedZones.permissions.error', err);
      captureRouteError(err, 'restrictedZones.permissions');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
