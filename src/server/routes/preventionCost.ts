// Praeventio Guard — Bloque 3.15 — Prevention Cost Simulator HTTP surface.
//
// Wires the `preventionCostCalculator.ts` engine into a higher-level
// `<CostSimulator />` flow. Distinct from `costCalculator.ts` (which exposes
// the two raw engine functions): this surface adds a fused "simulate"
// endpoint that produces both sides (cost-of-non-compliance vs prevention
// ROI) plus a derived ROI ratio, AND adds Firestore persistence so users
// can save scenarios and recall them per project.
//
// Endpoints:
//   POST /:projectId/cost/simulate
//     body: SimulateInput
//     200:  { simulation: CostSimulation }
//
//   POST /:projectId/cost/save-scenario
//     body: SaveScenarioInput
//     201:  { ok: true, scenario: StoredCostScenario }
//
//   GET  /:projectId/cost/scenarios
//     200:  { scenarios: StoredCostScenario[] }   (top-200, desc createdAt)
//
// Persistence path mirrors residualRisk.ts:
//   tenants/{tenantId}/projects/{projectId}/cost_scenarios/{id}
//
// Anti-blame: simulator is purely advisory — outputs are estimaciones
// basadas en Ley 16.744 + SUSESO/DT publications. No bloquea operación.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  estimateNonComplianceCost,
  estimatePreventionROI,
  type NonComplianceInput,
  type NonComplianceEstimate,
  type PreventionROIInput,
  type PreventionROIEstimate,
  type IncompletionKind,
} from '../../services/costCalculator/preventionCostCalculator.js';

const router = Router();

// ── Industry list (advisory only — does not affect engine math) ────────
//
// Used by the UI's industry picker; persisted with each scenario so a
// gerencia review can spot which sectors keep showing positive ROI. The
// engine itself is industry-agnostic; the field is metadata.
const INDUSTRIES = [
  'mining',
  'construction',
  'agriculture',
  'manufacturing',
  'energy',
  'transport',
  'services',
  'health',
  'education',
  'retail',
  'other',
] as const;
type Industry = (typeof INDUSTRIES)[number];

const KINDS: readonly IncompletionKind[] = [
  'document_missing',
  'training_overdue',
  'epp_expired',
  'safety_breach',
  'fatal_accident_risk',
];

// ── Guard helpers (mirror residualRisk.ts) ─────────────────────────────

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

// ── Role gate (mirror residualRisk.ts) ────────────────────────────────
// Saving a cost-benefit scenario is a prevention-PLANNING action, not a
// worker safety self-action — so it carries a role dimension on top of
// project membership. The no-blocking directive protects a worker
// recording their OWN safety action (check-in, inspection, stoppage
// recommendation); a financial planning artifact is none of those, so
// gating it to the planning roles is correct RBAC, not blocking. This
// restores what the file header always intended ("mirror residualRisk.ts")
// but originally dropped. Membership is still enforced first by guard().
const COST_SCENARIO_AUTHOR_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'gerente',
  'prevencionista',
]);

function callerCanSaveCostScenario(
  user: Express.PraeventioAuthUser,
): boolean {
  if (user.admin === true) return true;
  const role = typeof user.role === 'string' ? user.role : null;
  if (role && COST_SCENARIO_AUTHOR_ROLES.has(role)) return true;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  for (const r of roles) {
    if (typeof r === 'string' && COST_SCENARIO_AUTHOR_ROLES.has(r)) return true;
  }
  return false;
}

// ── Engine input schemas (mirror costCalculator.ts) ────────────────────

const nonComplianceInputSchema = z.object({
  kind: z.enum(KINDS as readonly [IncompletionKind, ...IncompletionKind[]]),
  affectedWorkerCount: z.number().int().nonnegative().max(1_000_000),
  estimatedStoppageDays: z.number().nonnegative().max(3650),
  dailyStoppageCostClp: z.number().nonnegative().max(1e12),
  adminHoursToFix: z.number().nonnegative().max(100_000),
  adminHourlyCostClp: z.number().positive().max(1e9).optional(),
  hasHistoryOfFines: z.boolean(),
}) as unknown as z.ZodType<NonComplianceInput>;

const roiInputSchema = z.object({
  expirationsCaughtEarly: z.number().int().nonnegative().max(1_000_000),
  adminHoursSaved: z.number().nonnegative().max(1_000_000),
  adminHourlyCostClp: z.number().positive().max(1e9).optional(),
  documentsGeneratedInternally: z.number().int().nonnegative().max(1_000_000),
  externalDocCostClp: z.number().positive().max(1e9).optional(),
  potentialStoppagesAvoided: z.number().int().nonnegative().max(1_000_000),
  avgStoppageCostClp: z.number().positive().max(1e12).optional(),
  nearMissesNotEscalated: z.number().int().nonnegative().max(1_000_000),
  avgIncidentCostClp: z.number().positive().max(1e12).optional(),
}) as unknown as z.ZodType<PreventionROIInput>;

// ── Fused simulate schema ──────────────────────────────────────────────

const simulateSchema = z.object({
  workerCount: z.number().int().nonnegative().max(1_000_000),
  industry: z.enum(INDUSTRIES),
  /** % de EPP cubierto por la empresa, 0-100. */
  eppCoveragePct: z.number().min(0).max(100),
  /** Horas de capacitación por trabajador por año. */
  trainingHoursPerYear: z.number().nonnegative().max(2000),
  nonCompliance: nonComplianceInputSchema,
  prevention: roiInputSchema,
  /** Inversión preventiva anual estimada (EPP + capacitación + equipos). */
  preventionInvestmentClp: z.number().nonnegative().max(1e13),
});

type SimulateBody = z.infer<typeof simulateSchema>;

interface CostSimulation {
  withoutPrevention: NonComplianceEstimate;
  withPrevention: PreventionROIEstimate;
  /** Total expected cost if NOT preventing (midpoint of min/max). */
  expectedNonComplianceClp: number;
  /** Total savings expected if preventing. */
  expectedSavingsClp: number;
  /** Net benefit = savings − preventionInvestment. */
  netBenefitClp: number;
  /** ROI as ratio: netBenefit / preventionInvestment. Infinity if invest = 0. */
  roiRatio: number;
  /** Coarse label of the ratio (negative / breakeven / positive / excellent). */
  roiLevel: 'underwater' | 'breakeven' | 'positive' | 'excellent';
  /** Snapshot of input meta so the UI can reflect it without re-querying. */
  meta: {
    workerCount: number;
    industry: Industry;
    eppCoveragePct: number;
    trainingHoursPerYear: number;
    preventionInvestmentClp: number;
  };
}

function classifyRoi(ratio: number): CostSimulation['roiLevel'] {
  if (!Number.isFinite(ratio)) return 'excellent';
  if (ratio < 0) return 'underwater';
  if (ratio < 0.5) return 'breakeven';
  if (ratio < 3) return 'positive';
  return 'excellent';
}

function computeSimulation(body: SimulateBody): CostSimulation {
  const withoutPrevention = estimateNonComplianceCost(body.nonCompliance);
  const withPrevention = estimatePreventionROI(body.prevention);

  const expectedNonComplianceClp = Math.round(
    (withoutPrevention.totalEstimatedClpMin +
      withoutPrevention.totalEstimatedClpMax) /
      2,
  );
  const expectedSavingsClp = withPrevention.totalSavingsClp;
  const netBenefitClp = expectedSavingsClp - body.preventionInvestmentClp;
  const roiRatio =
    body.preventionInvestmentClp === 0
      ? netBenefitClp > 0
        ? Number.POSITIVE_INFINITY
        : 0
      : netBenefitClp / body.preventionInvestmentClp;

  return {
    withoutPrevention,
    withPrevention,
    expectedNonComplianceClp,
    expectedSavingsClp,
    netBenefitClp,
    roiRatio,
    roiLevel: classifyRoi(roiRatio),
    meta: {
      workerCount: body.workerCount,
      industry: body.industry,
      eppCoveragePct: body.eppCoveragePct,
      trainingHoursPerYear: body.trainingHoursPerYear,
      preventionInvestmentClp: body.preventionInvestmentClp,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// 1. simulate — pure compute (no Firestore writes).
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/cost/simulate',
  verifyAuth,
  validate(simulateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as SimulateBody;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const simulation = computeSimulation(body);
      return res.json({ simulation });
    } catch (err) {
      logger.error?.('preventionCost.simulate.error', err);
      captureRouteError(err, 'preventionCost.simulate', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. save-scenario — persist a named simulation result.
// ────────────────────────────────────────────────────────────────────────

const saveScenarioSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  input: simulateSchema,
});

interface StoredCostScenario {
  id: string;
  name: string;
  description: string | null;
  input: SimulateBody;
  simulation: CostSimulation;
  createdAt: string;
  createdBy: string;
}

router.post(
  '/:projectId/cost/save-scenario',
  verifyAuth,
  idempotencyKey(),
  validate(saveScenarioSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof saveScenarioSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanSaveCostScenario(req.user!)) {
      return res.status(403).json({
        error: 'forbidden_role',
        message:
          'Guardar escenarios de costo requiere rol de prevención (admin, gerente o prevencionista).',
      });
    }
    try {
      const simulation = computeSimulation(body.input);
      const now = new Date().toISOString();
      const payload: StoredCostScenario = {
        id: body.id,
        name: body.name,
        description: body.description ?? null,
        input: body.input,
        simulation,
        createdAt: now,
        createdBy: callerUid,
      };
      await admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/cost_scenarios`,
        )
        .doc(body.id)
        .set(payload, { merge: true });
      await auditServerEvent(req, 'preventionCost.save-scenario', 'preventionCost', { projectId, scenarioId: body.id }, { projectId });
      return res.status(201).json({ ok: true, scenario: payload });
    } catch (err) {
      logger.error?.('preventionCost.saveScenario.error', err);
      captureRouteError(err, 'preventionCost.saveScenario', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. scenarios — list saved scenarios (top-200, newest first).
// ────────────────────────────────────────────────────────────────────────

router.get('/:projectId/cost/scenarios', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    let scenarios: StoredCostScenario[] = [];
    try {
      const snap = await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/cost_scenarios`)
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();
      scenarios = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StoredCostScenario, 'id'>),
      }));
    } catch (err) {
      // Missing index / empty collection — return [] instead of failing the
      // dashboard. Mirrors residualRisk.ts safeRead pattern.
      logger.warn?.('preventionCost.scenarios.list.failed', err);
      scenarios = [];
    }
    return res.json({ scenarios });
  } catch (err) {
    logger.error?.('preventionCost.scenarios.error', err);
    captureRouteError(err, 'preventionCost.scenarios', {
      callerUid,
      projectId,
    });
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
export type { CostSimulation, StoredCostScenario, SimulateBody, Industry };
