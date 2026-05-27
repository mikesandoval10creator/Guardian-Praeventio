// Praeventio Guard — §69-71 Conducción Segura + Rutas Críticas + Alertas Ruta.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/driving/*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// REIMPLEMENTACIÓN — el bloque original en el monolito estaba severamente
// corrupto (handlers interleaved con §244-250 Apprentices, multiple `const
// body` declarations duplicadas, schemas referenciados antes de declaración).
// Este router reconstruye el contrato completo desde el hook
// (`useDrivingSafety.ts`) + el servicio `drivingSafetyService.ts`.
//
// 5 endpoints (matching hook):
//   GET  /:projectId/driving/routes[?status=active|critical|all]
//   POST /:projectId/driving/routes
//   POST /:projectId/driving/routes/:id/alert
//   GET  /:projectId/driving/drivers
//   POST /:projectId/driving/drivers/:uid/journey
//   GET  /:projectId/driving/ranking
//
// Storage:
//   tenants/{tid}/projects/{pid}/driving_routes/{id}
//   tenants/{tid}/projects/{pid}/driving_drivers/{workerUid}

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

type DrivingRouteCriticality = 'low' | 'medium' | 'high' | 'extreme';
type DrivingRouteHazard =
  | 'cliff'
  | 'rockfall'
  | 'flood_zone'
  | 'sharp_curves'
  | 'limited_visibility'
  | 'wildlife'
  | 'mining_traffic'
  | 'icy_surface'
  | 'fog'
  | 'debris'
  | 'accident_reported';
type DrivingRouteAlertKind =
  | 'icy'
  | 'fog'
  | 'debris'
  | 'accident_reported'
  | 'weather'
  | 'other';

const VALID_HAZARDS = new Set<DrivingRouteHazard>([
  'cliff',
  'rockfall',
  'flood_zone',
  'sharp_curves',
  'limited_visibility',
  'wildlife',
  'mining_traffic',
  'icy_surface',
  'fog',
  'debris',
  'accident_reported',
]);

function ensureValidHazards(input: unknown): DrivingRouteHazard[] {
  if (!Array.isArray(input)) return [];
  const out: DrivingRouteHazard[] = [];
  for (const h of input) {
    if (typeof h === 'string' && VALID_HAZARDS.has(h as DrivingRouteHazard)) {
      out.push(h as DrivingRouteHazard);
    }
  }
  return out;
}

interface DrivingRouteAlert {
  kind: DrivingRouteAlertKind;
  note: string | null;
  flaggedAt: string;
  flaggedBy: string;
  resolvedAt: string | null;
}

interface StoredDrivingRoute {
  id: string;
  name: string;
  origin: string;
  destination: string;
  distanceKm: number;
  criticality: DrivingRouteCriticality;
  hazards: DrivingRouteHazard[];
  weatherSensitive: boolean;
  recommendedMaxSpeedKmh: number;
  activeAlert: DrivingRouteAlert | null;
  alertHistory: DrivingRouteAlert[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

interface StoredDrivingDriver {
  workerUid: string;
  licenseClass: string;
  licenseExpiresAt: string;
  yearsExperience: number;
  incidents12m: number;
  speedingEvents30d: number;
  fatigueScore: number;
  hoursThisWeek: number;
  lastJourneyAt: string | null;
  updatedAt: string;
}

// ── Schemas ───────────────────────────────────────────────────────────

const drivingRouteCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(200),
  origin: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  distanceKm: z.number().min(0).max(10_000),
  criticality: z.enum(['low', 'medium', 'high', 'extreme']),
  hazards: z.array(z.string()).max(20).optional(),
  weatherSensitive: z.boolean().optional(),
  recommendedMaxSpeedKmh: z.number().min(0).max(200).optional(),
});

const drivingRouteAlertSchema = z.object({
  kind: z.enum([
    'icy',
    'fog',
    'debris',
    'accident_reported',
    'weather',
    'other',
  ]),
  note: z.string().max(2000).optional(),
  resolve: z.boolean().optional(),
});

const drivingJourneySchema = z
  .object({
    action: z.enum(['start', 'end']),
    journeyId: z.string().min(1).max(120).optional(),
    hours: z.number().min(0).max(24).optional(),
    note: z.string().max(2000).optional(),
  })
  .refine(
    (v) => v.action !== 'end' || (v.journeyId !== undefined && v.journeyId.length > 0),
    {
      message: "journeyId is required when action is 'end'",
      path: ['journeyId'],
    },
  );

// ── GET /:projectId/driving/routes ────────────────────────────────────

router.get(
  '/:projectId/driving/routes',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const statusParam =
        typeof req.query.status === 'string' ? req.query.status : 'all';
      const status: 'active' | 'critical' | 'all' = [
        'active',
        'critical',
        'all',
      ].includes(statusParam)
        ? (statusParam as 'active' | 'critical' | 'all')
        : 'all';

      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`drivingSafety.read.${label}.failed`, err);
          return [];
        }
      };

      const all = await safeRead<StoredDrivingRoute>('routes', async () => {
        const snap = await db
          .collection(
            `tenants/${g.tenantId}/projects/${projectId}/driving_routes`,
          )
          .limit(200)
          .get();
        return snap.docs.map(
          (d) =>
            ({ id: d.id, ...(d.data() as Omit<StoredDrivingRoute, 'id'>) }) as
              StoredDrivingRoute,
        );
      });

      let routes: StoredDrivingRoute[];
      if (status === 'active') {
        routes = all.filter((r) => r.activeAlert !== null);
      } else if (status === 'critical') {
        routes = all.filter(
          (r) =>
            r.criticality === 'high' || r.criticality === 'extreme',
        );
      } else {
        routes = all;
      }

      return res.json({ routes });
    } catch (err) {
      logger.error?.('drivingSafety.routes.list.error', err);
      captureRouteError(err, 'drivingSafety.routes.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/driving/routes ───────────────────────────────────

router.post(
  '/:projectId/driving/routes',
  verifyAuth,
  validate(drivingRouteCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof drivingRouteCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const id =
        body.id ??
        `route_${Date.now()}_${randomUUID()}`;
      const payload: StoredDrivingRoute = {
        id,
        name: body.name,
        origin: body.origin,
        destination: body.destination,
        distanceKm: body.distanceKm,
        criticality: body.criticality,
        hazards: ensureValidHazards(body.hazards),
        weatherSensitive: body.weatherSensitive ?? false,
        recommendedMaxSpeedKmh: body.recommendedMaxSpeedKmh ?? 60,
        activeAlert: null,
        alertHistory: [],
        createdAt: now,
        createdBy: callerUid,
        updatedAt: now,
      };
      await db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/driving_routes`,
        )
        .doc(id)
        .set(payload, { merge: true });
      return res.status(201).json({ ok: true, route: payload });
    } catch (err) {
      logger.error?.('drivingSafety.routes.create.error', err);
      captureRouteError(err, 'drivingSafety.routes.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/driving/routes/:id/alert ─────────────────────────

router.post(
  '/:projectId/driving/routes/:id/alert',
  verifyAuth,
  validate(drivingRouteAlertSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof drivingRouteAlertSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/driving_routes`,
        )
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'route_not_found' });
      }
      const existing = snap.data() as Omit<StoredDrivingRoute, 'id'>;
      const now = new Date().toISOString();

      if (body.resolve === true) {
        // Resolve current active alert
        if (!existing.activeAlert) {
          return res.status(200).json({ ok: true, activeAlert: null });
        }
        const resolved: DrivingRouteAlert = {
          ...existing.activeAlert,
          resolvedAt: now,
        };
        const newHistory = [
          ...(existing.alertHistory ?? []),
          resolved,
        ].slice(-50);
        await docRef.set(
          {
            activeAlert: null,
            alertHistory: newHistory,
            updatedAt: now,
          },
          { merge: true },
        );
        return res.status(200).json({ ok: true, activeAlert: null });
      }

      // Raise new alert (replaces current; previous gets moved to history)
      const newAlert: DrivingRouteAlert = {
        kind: body.kind,
        note: body.note ?? null,
        flaggedAt: now,
        flaggedBy: callerUid,
        resolvedAt: null,
      };
      const historyWithPrior =
        existing.activeAlert !== null
          ? [
              ...(existing.alertHistory ?? []),
              { ...existing.activeAlert, resolvedAt: now },
            ]
          : existing.alertHistory ?? [];
      const newHistory = historyWithPrior.slice(-50);
      await docRef.set(
        {
          activeAlert: newAlert,
          alertHistory: newHistory,
          updatedAt: now,
        },
        { merge: true },
      );
      return res.status(200).json({ ok: true, activeAlert: newAlert });
    } catch (err) {
      logger.error?.('drivingSafety.routes.alert.error', err);
      captureRouteError(err, 'drivingSafety.routes.alert');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/driving/drivers ───────────────────────────────────

router.get(
  '/:projectId/driving/drivers',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`drivingSafety.drivers.${label}.failed`, err);
          return [];
        }
      };
      const drivers = await safeRead<StoredDrivingDriver>(
        'list',
        async () => {
          const snap = await db
            .collection(
              `tenants/${g.tenantId}/projects/${projectId}/driving_drivers`,
            )
            .limit(500)
            .get();
          return snap.docs.map(
            (d) =>
              ({
                workerUid: d.id,
                ...(d.data() as Omit<StoredDrivingDriver, 'workerUid'>),
              }) as StoredDrivingDriver,
          );
        },
      );
      return res.json({ drivers });
    } catch (err) {
      logger.error?.('drivingSafety.drivers.list.error', err);
      captureRouteError(err, 'drivingSafety.drivers.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/driving/drivers/:uid/journey ─────────────────────

router.post(
  '/:projectId/driving/drivers/:uid/journey',
  verifyAuth,
  validate(drivingJourneySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, uid } = req.params;
    const body = req.body as z.infer<typeof drivingJourneySchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/driving_drivers`,
        )
        .doc(uid);
      const snap = await docRef.get();
      const now = new Date().toISOString();
      const existing = snap.exists
        ? (snap.data() as Omit<StoredDrivingDriver, 'workerUid'>)
        : ({
            licenseClass: '',
            licenseExpiresAt: now,
            yearsExperience: 0,
            incidents12m: 0,
            speedingEvents30d: 0,
            fatigueScore: 0,
            hoursThisWeek: 0,
            lastJourneyAt: null,
            updatedAt: now,
          } as Omit<StoredDrivingDriver, 'workerUid'>);
      // action: 'start' arranca un viaje (registra lastJourneyAt);
      // action: 'end' lo cierra y suma `hours` a hoursThisWeek.
      const update: Partial<StoredDrivingDriver> = {
        lastJourneyAt: now,
        updatedAt: now,
      };
      if (body.action === 'end' && typeof body.hours === 'number') {
        update.hoursThisWeek = Math.max(
          0,
          (existing.hoursThisWeek ?? 0) + body.hours,
        );
      }
      await docRef.set(update, { merge: true });

      // Audit log entry — journey-level history para forensics.
      try {
        await db
          .collection(
            `tenants/${g.tenantId}/projects/${projectId}/driving_drivers/${uid}/journeys`,
          )
          .add({
            action: body.action,
            journeyId: body.journeyId ?? null,
            hours: body.hours ?? null,
            note: body.note ?? null,
            recordedAt: now,
            recordedBy: callerUid,
          });
      } catch (err) {
        logger.warn?.('drivingSafety.journey.audit_failed', err);
      }

      const merged: StoredDrivingDriver = {
        workerUid: uid,
        ...existing,
        ...update,
      } as StoredDrivingDriver;
      return res.status(200).json({ ok: true, driver: merged });
    } catch (err) {
      logger.error?.('drivingSafety.journey.error', err);
      captureRouteError(err, 'drivingSafety.journey');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/driving/ranking ───────────────────────────────────

router.get(
  '/:projectId/driving/ranking',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const { computeDriverScore } = await import(
        '../../services/drivingSafety/drivingSafetyService.js'
      );
      const db = admin.firestore();
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`drivingSafety.ranking.read.${label}.failed`, err);
          return [];
        }
      };
      const drivers = await safeRead<StoredDrivingDriver>(
        'drivers',
        async () => {
          const snap = await db
            .collection(
              `tenants/${g.tenantId}/projects/${projectId}/driving_drivers`,
            )
            .limit(500)
            .get();
          return snap.docs.map(
            (d) =>
              ({
                workerUid: d.id,
                ...(d.data() as Omit<StoredDrivingDriver, 'workerUid'>),
              }) as StoredDrivingDriver,
          );
        },
      );
      const ranking = drivers
        .map((d) => {
          const report = computeDriverScore({
            workerUid: d.workerUid,
            licenseClass: d.licenseClass,
            licenseExpiresAt: d.licenseExpiresAt,
            yearsExperience: d.yearsExperience,
            incidents12m: d.incidents12m,
            speedingEvents30d: d.speedingEvents30d,
          });
          return {
            workerUid: d.workerUid,
            safetyScore: report.safetyScore,
            level: report.level,
            canOperate: report.canOperate,
            blockers: report.blockers,
            fatigueScore: d.fatigueScore ?? 0,
            hoursThisWeek: d.hoursThisWeek ?? 0,
            licenseExpiresAt: d.licenseExpiresAt,
          };
        })
        .sort((a, b) => b.safetyScore - a.safetyScore);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('drivingSafety.ranking.error', err);
      captureRouteError(err, 'drivingSafety.ranking');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
