// Praeventio Guard — Épica B1 (capa 2): DS 67 cotización-adicional
// simulator HTTP surface.
//
// Two endpoints over the PURE engine
// `src/services/compliance/ds67Simulator.ts` (which carries the LEGAL
// SOURCE comments — DS 67/1999, BCN idNorma=159800):
//
//   GET  /:projectId/ds67/simulator/prefill
//     The 3 períodos anuales DS 67 (1 julio → 30 junio, art. 2 b)) with
//     the REAL incident aggregates of the project (lost days + incident
//     count per period), so the UI can pre-fill "días perdidos" from
//     registered data and label its provenance.
//
//   POST /:projectId/ds67/simulator/simulate
//     body: { periods, currentAdditionalCotizacionPct?, annualPayrollClp? }
//     Per-period `lostDays` is optional: when omitted, the server fills it
//     from the project's registered incidents for that período anual and
//     marks `lostDaysSource: 'incidents'`. `averageWorkers` (dotación) and
//     invalidity/death events are ALWAYS user-provided — the incident
//     schema has no headcount and no invalidity gradings (those come from
//     the organismo administrador's resolution), so we never fabricate
//     them (Phase 5 directive: datos legales fabricados → exigir el dato
//     real).
//
// AUDIT LOG: deliberately none. Both endpoints are read-only simulations —
// no Firestore write, no state change — so hard convention #3 ("every
// STATE-CHANGING operation must write audit_logs") does not apply.
//
// Incidents can live top-level (`incidents` filtered by projectId) or
// nested under `tenants/{tid}/projects/{pid}/incidents` — same dual-path
// + de-dup strategy as `incidentTrends.ts`. If the tenant cannot be
// resolved we degrade to the top-level path only (a manual simulation must
// never fail because of a tenant lookup).

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
import {
  Ds67ValidationError,
  evaluationPeriodWindows,
  simulateDs67,
  type Ds67AnnualPeriodWindow,
  type Ds67SimulationInput,
} from '../../services/compliance/ds67Simulator.js';

const router = Router();

// ── Membership guard (mirrors incidentTrends.ts) ─────────────────────────
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

async function resolveTenantId(
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  try {
    const proj = await db.collection('projects').doc(projectId).get();
    const data = proj.exists ? proj.data() : null;
    if (data && typeof data.tenantId === 'string') return data.tenantId;
  } catch (err) {
    logger.warn?.('ds67.simulator.tenant_lookup_failed', err);
  }
  return null;
}

// ── Incident aggregation per período anual ───────────────────────────────

function tsToIso(raw: unknown): string | null {
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object') {
    const t = raw as { toDate?: () => Date; _seconds?: number; seconds?: number };
    if (typeof t.toDate === 'function') {
      const d = t.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    }
    const seconds =
      typeof t._seconds === 'number' ? t._seconds : typeof t.seconds === 'number' ? t.seconds : null;
    if (seconds !== null) {
      const d = new Date(seconds * 1000);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function occurredOf(rec: Record<string, unknown>): string | null {
  return tsToIso(rec.ts) ?? tsToIso(rec.occurredAt) ?? tsToIso(rec.createdAt) ?? null;
}

export interface Ds67PeriodAggregate {
  /** Sum of the numeric `lostDays` of registered incidents in the window. */
  registeredLostDays: number;
  /** Number of registered incidents in the window. */
  registeredIncidentCount: number;
}

async function aggregateIncidentsByWindow(
  db: admin.firestore.Firestore,
  projectId: string,
  tenantId: string | null,
  windows: Ds67AnnualPeriodWindow[],
): Promise<Ds67PeriodAggregate[]> {
  const safeRead = async (
    label: string,
    fn: () => Promise<Array<Record<string, unknown>>>,
  ): Promise<Array<Record<string, unknown>>> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn?.(`ds67.simulator.${label}.read_failed`, err);
      return [];
    }
  };

  const [topLevel, nested] = await Promise.all([
    safeRead('incidents_top', async () => {
      const snap = await db.collection('incidents').where('projectId', '==', projectId).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    }),
    tenantId
      ? safeRead('incidents_nested', async () => {
          const snap = await db
            .collection(`tenants/${tenantId}/projects/${projectId}/incidents`)
            .get();
          return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        })
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);

  const byId = new Map<string, Record<string, unknown>>();
  for (const rec of topLevel) {
    const id = String(rec.id ?? '');
    if (id) byId.set(id, rec);
  }
  for (const rec of nested) {
    const id = String(rec.id ?? '');
    if (id && !byId.has(id)) byId.set(id, rec);
  }

  const aggregates: Ds67PeriodAggregate[] = windows.map(() => ({
    registeredLostDays: 0,
    registeredIncidentCount: 0,
  }));
  for (const rec of byId.values()) {
    const iso = occurredOf(rec);
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    for (let i = 0; i < windows.length; i++) {
      const start = Date.parse(windows[i]!.startIso);
      const end = Date.parse(windows[i]!.endIso);
      if (ms >= start && ms < end) {
        const agg = aggregates[i]!;
        agg.registeredIncidentCount += 1;
        const lost = rec.lostDays;
        if (typeof lost === 'number' && Number.isFinite(lost) && lost > 0) {
          agg.registeredLostDays += Math.round(lost);
        }
        break;
      }
    }
  }
  return aggregates;
}

// ── 1. prefill ───────────────────────────────────────────────────────────

router.get('/:projectId/ds67/simulator/prefill', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'project_id_required' });
  if (!(await guard(callerUid, projectId, res))) return undefined;
  try {
    const db = admin.firestore();
    const windows = evaluationPeriodWindows(new Date(), 3);
    const tenantId = await resolveTenantId(projectId, db);
    const aggregates = await aggregateIncidentsByWindow(db, projectId, tenantId, windows);
    return res.json({
      generatedAt: new Date().toISOString(),
      periods: windows.map((w, i) => ({
        label: w.label,
        startIso: w.startIso,
        endIso: w.endIso,
        registeredLostDays: aggregates[i]!.registeredLostDays,
        registeredIncidentCount: aggregates[i]!.registeredIncidentCount,
      })),
    });
  } catch (err) {
    logger.error?.('ds67.simulator.prefill.error', err);
    captureRouteError(err, 'ds67.simulator.prefill');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── 2. simulate ──────────────────────────────────────────────────────────

const invalidityEventsSchema = z
  .object({
    invalidez_15_25: z.number().int().nonnegative().max(10_000).optional(),
    invalidez_27_5_37_5: z.number().int().nonnegative().max(10_000).optional(),
    invalidez_40_65: z.number().int().nonnegative().max(10_000).optional(),
    invalidez_70_plus: z.number().int().nonnegative().max(10_000).optional(),
    gran_invalidez: z.number().int().nonnegative().max(10_000).optional(),
    muerte: z.number().int().nonnegative().max(10_000).optional(),
  })
  .strict();

const periodSchema = z.object({
  label: z.string().max(120).optional(),
  averageWorkers: z.number().positive().max(10_000_000),
  // Optional: omitted → filled from registered incidents of the window.
  lostDays: z.number().int().nonnegative().max(10_000_000).optional(),
  invalidityEvents: invalidityEventsSchema.optional(),
});

const simulateSchema = z.object({
  periods: z.array(periodSchema).min(2).max(3),
  currentAdditionalCotizacionPct: z.number().min(0).max(100).optional(),
  annualPayrollClp: z.number().nonnegative().max(1e15).optional(),
});

router.post(
  '/:projectId/ds67/simulator/simulate',
  verifyAuth,
  validate(simulateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof simulateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const windows = evaluationPeriodWindows(new Date(), body.periods.length as 2 | 3);

      // Only hit Firestore when at least one period needs pre-filling.
      const needsAggregates = body.periods.some((p) => p.lostDays === undefined);
      let aggregates: Ds67PeriodAggregate[] = windows.map(() => ({
        registeredLostDays: 0,
        registeredIncidentCount: 0,
      }));
      if (needsAggregates) {
        const tenantId = await resolveTenantId(projectId, db);
        aggregates = await aggregateIncidentsByWindow(db, projectId, tenantId, windows);
      }

      const mergedPeriods = body.periods.map((p, i) => {
        const fromIncidents = p.lostDays === undefined;
        return {
          window: windows[i]!,
          lostDaysSource: fromIncidents ? ('incidents' as const) : ('manual' as const),
          input: {
            label: p.label ?? windows[i]!.label,
            averageWorkers: p.averageWorkers,
            lostDays: fromIncidents ? aggregates[i]!.registeredLostDays : p.lostDays!,
            invalidityEvents: p.invalidityEvents,
          },
        };
      });

      const simulationInput: Ds67SimulationInput = {
        periods: mergedPeriods.map((m) => m.input),
        currentAdditionalCotizacionPct: body.currentAdditionalCotizacionPct,
        annualPayrollClp: body.annualPayrollClp,
      };
      const result = simulateDs67(simulationInput);

      return res.json({
        generatedAt: new Date().toISOString(),
        result,
        periods: mergedPeriods.map((m, i) => ({
          label: m.input.label,
          startIso: m.window.startIso,
          endIso: m.window.endIso,
          lostDays: m.input.lostDays,
          lostDaysSource: m.lostDaysSource,
          registeredLostDays: aggregates[i]!.registeredLostDays,
          registeredIncidentCount: aggregates[i]!.registeredIncidentCount,
        })),
      });
    } catch (err) {
      if (err instanceof Ds67ValidationError) {
        // Engine-level rejection (e.g. boundary not representable) — the
        // request was syntactically valid but legally inconsistent.
        return res.status(400).json({ error: 'invalid_simulation_input', code: err.code });
      }
      logger.error?.('ds67.simulator.simulate.error', err);
      captureRouteError(err, 'ds67.simulator.simulate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
