// Praeventio Guard — Structural-load capture + predictive probe source.
//
// Closes the AlertScheduler gap: the predictive ladder fired no probes
// because (1) nobody captured the physical inputs the Bernoulli wind-load
// needs (area/Cp/NCh-432 limit) and (2) RootLayout mounted the scheduler
// with probes={[]}. This route is the REAL source of (1) and the bridge
// that turns stored inputs + REAL wind forecast into probes.
//
// Endpoints (mounted at /api/sprint-k):
//   GET  /:projectId/structural-loads             → list stored inputs
//   POST /:projectId/structural-loads             → create/update one input record
//   GET  /:projectId/structural-loads/build-probes → wire probes from
//        stored inputs × REAL Open-Meteo HOURLY wind (none if no inputs)
//
// TIME-SCALE: build-probes pulls HOURLY wind (fetchOpenMeteoHourlyWind), not
// daily, because the scheduler walks per-minute lead times. Each hourly sample
// sits at a real minute offset (60, 120 …). The matching scheduler window
// (windowMinutes / minLeadTimeMin) is returned so the client's evaluation
// window equals the data's real span — data cadence = scheduler window.
//
// Pattern mirrors residualRisk.ts (verifyAuth + assertProjectMember +
// tenant subcollection + zod validate + awaited audit + captureRouteError).

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
import { fetchOpenMeteoHourlyWind } from '../../services/b2d/externalClimate.js';
import {
  buildStructuralLoadProbes,
  deriveSchedulerWindow,
  FORECAST_MINUTES_PER_STEP,
  type StructuralLoadInputs,
} from '../../services/predictiveAlerts/structuralLoadProbe.js';

const router = Router();

// Number of hourly forecast samples to evaluate (next 6 hours of wind).
const FORECAST_HOURS = 6;

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
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── Stored shape ──────────────────────────────────────────────────────

interface StoredStructuralLoad {
  id: string;
  label: string;
  areaM2: number;
  pressureCoefficient: number;
  maxForceN: number;
  reference: string;
  createdAt: string;
  createdBy: string;
}

// ── Schemas ───────────────────────────────────────────────────────────

const finitePositive = z
  .number()
  .refine((n) => Number.isFinite(n) && n > 0, { message: 'must be finite > 0' });
const finiteNumber = z
  .number()
  .refine(Number.isFinite, { message: 'must be finite' });

const createSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(2).max(200),
  areaM2: finitePositive.refine((n) => n <= 100000, { message: 'area too large' }),
  // Cp can be negative (suction); magnitude used downstream. Bound it sanely.
  pressureCoefficient: finiteNumber.refine((n) => Math.abs(n) <= 10, {
    message: 'Cp out of range',
  }),
  maxForceN: finitePositive.refine((n) => n <= 1e12, { message: 'limit too large' }),
  reference: z.string().min(1).max(200).optional(),
});

function colPath(tenantId: string, projectId: string): string {
  return `tenants/${tenantId}/projects/${projectId}/structural_loads`;
}

// ── GET /:projectId/structural-loads ──────────────────────────────────

router.get('/:projectId/structural-loads', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    // B2 (Fase 5): surface read failures — never mask a failed read of a
    // safety input as an empty list. Rethrow → outer catch → 500.
    const snap = await db
      .collection(colPath(g.tenantId, projectId))
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    const records = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<StoredStructuralLoad, 'id'>),
    }));
    return res.json({ records });
  } catch (err) {
    logger.error?.('structuralLoads.list.error', err);
    captureRouteError(err, 'structuralLoads.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/structural-loads ─────────────────────────────────

router.post(
  '/:projectId/structural-loads',
  verifyAuth,
  validate(createSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const payload: StoredStructuralLoad = {
        id: body.id,
        label: body.label,
        areaM2: body.areaM2,
        pressureCoefficient: body.pressureCoefficient,
        maxForceN: body.maxForceN,
        reference: body.reference ?? 'NCh 432 Of.71',
        createdAt: now,
        createdBy: callerUid,
      };
      await db
        .collection(colPath(g.tenantId, projectId))
        .doc(body.id)
        .set(payload, { merge: true });
      try {
        await auditServerEvent(
          req,
          'structuralLoads.create',
          'structuralLoads',
          { projectId, structuralLoadId: body.id },
          { projectId },
        );
      } catch (auditErr) {
        logger.error?.('structuralLoads.audit_failed', auditErr);
        captureRouteError(auditErr, 'structuralLoads.audit');
      }
      return res.status(201).json({ ok: true, record: payload });
    } catch (err) {
      logger.error?.('structuralLoads.create.error', err);
      captureRouteError(err, 'structuralLoads.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/structural-loads/build-probes ─────────────────────
//
// Returns wire probes derived from the stored inputs × REAL Open-Meteo
// HOURLY wind forecast for the project's coordinates, plus the scheduler
// window that matches the forecast cadence. Honest degradation: no stored
// inputs OR no coords OR weather unavailable ⇒ probes:[] (never a fabricated
// wind value). `forecastValues[i]` is the predicted FORCE (N) at sample i,
// and `window` carries windowMinutes/minLeadTimeMin so the client evaluates
// over the data's real minute span (each sample = `minutesPerStep` minutes).
router.get(
  '/:projectId/structural-loads/build-probes',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const snap = await db
        .collection(colPath(g.tenantId, projectId))
        .limit(500)
        .get();
      const records: StructuralLoadInputs[] = snap.docs.map((d) => {
        const data = d.data() ?? {};
        return {
          id: d.id,
          areaM2: typeof data.areaM2 === 'number' ? data.areaM2 : NaN,
          pressureCoefficient:
            typeof data.pressureCoefficient === 'number'
              ? data.pressureCoefficient
              : NaN,
          maxForceN: typeof data.maxForceN === 'number' ? data.maxForceN : NaN,
        };
      });
      if (records.length === 0) {
        return res.json({ probes: [], wind: null, window: null });
      }

      // REAL wind source: the project's stored coordinates drive Open-Meteo.
      const proj = await db.collection('projects').doc(projectId).get();
      const pdata = proj.exists ? proj.data() : null;
      const lat =
        pdata && typeof pdata.latitude === 'number' ? pdata.latitude : null;
      const lng =
        pdata && typeof pdata.longitude === 'number' ? pdata.longitude : null;
      if (lat === null || lng === null) {
        // No coordinates ⇒ no real wind ⇒ no probe (honest, not fabricated).
        return res.json({ probes: [], wind: null, window: null });
      }

      // HOURLY wind (short-horizon) so the per-minute scheduler sees a real
      // minute cadence, not a daily index masquerading as minutes.
      const forecast = await fetchOpenMeteoHourlyWind(lat, lng, FORECAST_HOURS);
      if (!forecast || forecast.data.windKmh.length === 0) {
        return res.json({ probes: [], wind: null, window: null });
      }
      const forecastWindKmh = forecast.data.windKmh;
      const currentWindKmh = forecastWindKmh[0] ?? 0;

      const window = deriveSchedulerWindow(forecastWindKmh.length);
      if (!window) {
        return res.json({ probes: [], wind: null, window: null });
      }

      const probes = buildStructuralLoadProbes(
        records,
        currentWindKmh,
        forecastWindKmh,
      );
      // Inline the numeric forecast curve so the client/evaluate-probes route
      // can reconstruct the closure (probes carry functions, not JSON-safe).
      // forecastValues[i] = predicted FORCE at sample i (i.e. at
      // (i+1)*minutesPerStep minutes ahead).
      const wire = probes.map((p) => ({
        id: p.id,
        threshold: p.threshold,
        currentValue: p.currentValue,
        forecastValues: forecastWindKmh.map((_, i) =>
          p.forecast((i + 1) * FORECAST_MINUTES_PER_STEP),
        ),
      }));
      return res.json({
        probes: wire,
        wind: {
          currentWindKmh,
          forecastWindKmh,
          minutesPerStep: FORECAST_MINUTES_PER_STEP,
          source: forecast.source,
        },
        window,
      });
    } catch (err) {
      logger.error?.('structuralLoads.buildProbes.error', err);
      captureRouteError(err, 'structuralLoads.buildProbes');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
