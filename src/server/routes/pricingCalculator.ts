// Praeventio Guard — Pricing calculator HTTP surface.
//
// Sprint K §172-179 — four stateless endpoints over the engine under
// `src/services/pricingCalculator/pricingCalculator.ts`:
//
//   POST /:projectId/pricing-calculator/estimate-tier-cost
//   POST /:projectId/pricing-calculator/compare-tiers
//   POST /:projectId/pricing-calculator/compute-roi
//   POST /:projectId/pricing-calculator/suggest-purchase-orders
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
import {
  estimateTierCost,
  compareTiers,
  computeROI,
  suggestPurchaseOrders,
  type TierPlan,
  type CurrentUsage,
  type ROIInputs,
  type ConsumableUsage,
} from '../../services/pricingCalculator/pricingCalculator.js';

const router = Router();

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

const tierPlanSchema = z.object({
  id: z.string().min(1).max(200),
  monthlyPriceClp: z.number().nonnegative().max(1e15),
  workerLimit: z.number().int().nonnegative().max(10_000_000),
  projectLimit: z.number().int().nonnegative().max(10_000_000),
  overagePerWorkerClp: z.number().nonnegative().max(1e9),
  overagePerProjectClp: z.number().nonnegative().max(1e9),
  features: z.array(z.string().min(1).max(200)).max(500),
}) as unknown as z.ZodType<TierPlan>;

const usageSchema = z.object({
  activeWorkers: z.number().int().nonnegative().max(10_000_000),
  activeProjects: z.number().int().nonnegative().max(10_000_000),
}) as unknown as z.ZodType<CurrentUsage>;

// ────────────────────────────────────────────────────────────────────────
// 1. estimate-tier-cost
// ────────────────────────────────────────────────────────────────────────

const estimateSchema = z.object({
  plan: tierPlanSchema,
  usage: usageSchema,
});

router.post(
  '/:projectId/pricing-calculator/estimate-tier-cost',
  verifyAuth,
  validate(estimateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof estimateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const estimate = estimateTierCost(body.plan, body.usage);
      return res.json({ estimate });
    } catch (err) {
      logger.error?.('pricingCalculator.estimateTierCost.error', err);
      captureRouteError(err, 'pricingCalculator.estimateTierCost');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. compare-tiers
// ────────────────────────────────────────────────────────────────────────

const compareSchema = z.object({
  plans: z.array(tierPlanSchema).max(50),
  usage: usageSchema,
});

router.post(
  '/:projectId/pricing-calculator/compare-tiers',
  verifyAuth,
  validate(compareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof compareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const comparison = compareTiers(body.plans, body.usage);
      return res.json({ comparison });
    } catch (err) {
      logger.error?.('pricingCalculator.compareTiers.error', err);
      captureRouteError(err, 'pricingCalculator.compareTiers');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. compute-roi
// ────────────────────────────────────────────────────────────────────────

const roiSchema = z.object({
  inputs: z.object({
    costPerPreventedIncident: z.number().nonnegative().max(1e12),
    preventedIncidents: z.number().int().nonnegative().max(1_000_000),
    costPerAvoidedFine: z.number().nonnegative().max(1e12),
    finesAvoided: z.number().int().nonnegative().max(1_000_000),
    adminHoursSaved: z.number().nonnegative().max(1_000_000),
    adminHourlyRateClp: z.number().nonnegative().max(1e9),
    monthlyPlanClp: z.number().nonnegative().max(1e12),
    additionalSafetyInvestmentClp: z.number().nonnegative().max(1e12),
  }) as unknown as z.ZodType<ROIInputs>,
});

router.post(
  '/:projectId/pricing-calculator/compute-roi',
  verifyAuth,
  validate(roiSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof roiSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = computeROI(body.inputs);
      return res.json({ report });
    } catch (err) {
      logger.error?.('pricingCalculator.computeROI.error', err);
      captureRouteError(err, 'pricingCalculator.computeROI');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. suggest-purchase-orders
// ────────────────────────────────────────────────────────────────────────

const consumableSchema = z.object({
  itemId: z.string().min(1).max(200),
  itemName: z.string().min(1).max(500),
  currentStock: z.number().nonnegative().max(1_000_000_000),
  monthlyConsumption: z.number().nonnegative().max(1_000_000_000),
  safetyStock: z.number().nonnegative().max(1_000_000_000),
  leadTimeDays: z.number().int().min(0).max(365),
  unitPriceClp: z.number().nonnegative().max(1e12),
}) as unknown as z.ZodType<ConsumableUsage>;

const suggestSchema = z.object({
  consumables: z.array(consumableSchema).max(10_000),
});

router.post(
  '/:projectId/pricing-calculator/suggest-purchase-orders',
  verifyAuth,
  validate(suggestSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof suggestSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const suggestions = suggestPurchaseOrders(body.consumables);
      return res.json({ suggestions });
    } catch (err) {
      logger.error?.('pricingCalculator.suggestPurchaseOrders.error', err);
      captureRouteError(err, 'pricingCalculator.suggestPurchaseOrders');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
