// Praeventio Guard — Pricing Simulator HTTP surface.
//
// Sprint K §171-179 — calculadora pricing + simulador + overages +
// ROI + presupuesto EPP + OC sugerida. This service is the *core*
// estimation engine; the existing PricingCalculator page covers the
// commercial UX but the engine itself was never exposed for
// cross-feature simulation (e.g. "what would we pay if our crew grew
// to N workers next month?").
//
// 3 stateless endpoints over the engine under
// `src/services/pricingSimulator/pricingSimulator.ts`:
//
//   POST /:projectId/pricing/estimate-bill
//     body: { tier, usage, options? }
//     200:  { estimate: BillEstimate }
//     400:  PricingError → { error }
//
//   POST /:projectId/pricing/compare-tiers
//     body: { currentTier, usage, options? }
//     200:  { comparisons: TierComparison[] }
//
//   POST /:projectId/pricing/worker-break-even
//     body: { currentTier, nextTier, baseUsage, options? }
//     200:  { workers, found }
//
// Pure compute — no Firestore writes. Caller decides whether to expose
// recommendations to the user.

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
  estimateBill,
  compareTiers,
  workerBreakEven,
  PricingError,
  type EstimateOptions,
} from '../../services/pricingSimulator/pricingSimulator.js';

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

const TIERS = ['free', 'starter', 'pro', 'enterprise'] as const;

const usageSchema = z.object({
  workers: z.number().nonnegative().max(1_000_000),
  projects: z.number().nonnegative().max(100_000),
  aiCallsPerMonth: z.number().nonnegative().max(1_000_000_000),
  storageGb: z.number().nonnegative().max(1_000_000),
});

const tierLimitsSchema = z.object({
  monthlyBaseClp: z.number().nonnegative(),
  maxWorkers: z.number().positive(),
  maxProjects: z.number().positive(),
  includedAiCalls: z.number().nonnegative(),
  includedStorageGb: z.number().nonnegative(),
});

const overageRatesSchema = z.object({
  perWorkerClp: z.number().nonnegative(),
  perProjectClp: z.number().nonnegative(),
  perAiCallClp: z.number().nonnegative(),
  perStorageGbClp: z.number().nonnegative(),
});

const optionsSchema = z
  .object({
    rates: overageRatesSchema.optional(),
    customTiers: z
      .record(z.enum(TIERS), tierLimitsSchema.optional())
      .optional(),
  })
  .optional() as unknown as z.ZodType<EstimateOptions | undefined>;

// ────────────────────────────────────────────────────────────────────────
// 1. estimate-bill
// ────────────────────────────────────────────────────────────────────────

const estimateSchema = z.object({
  tier: z.enum(TIERS),
  usage: usageSchema,
  options: optionsSchema,
});

router.post(
  '/:projectId/pricing/estimate-bill',
  verifyAuth,
  validate(estimateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof estimateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const estimate = estimateBill(body.tier, body.usage, body.options);
      return res.json({ estimate });
    } catch (err) {
      if (err instanceof PricingError) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('pricing.estimateBill.error', err);
      captureRouteError(err, 'pricing.estimateBill');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. compare-tiers
// ────────────────────────────────────────────────────────────────────────

const compareSchema = z.object({
  currentTier: z.enum(TIERS),
  usage: usageSchema,
  options: optionsSchema,
});

router.post(
  '/:projectId/pricing/compare-tiers',
  verifyAuth,
  validate(compareSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof compareSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const comparisons = compareTiers(
        body.currentTier,
        body.usage,
        body.options,
      );
      return res.json({ comparisons });
    } catch (err) {
      if (err instanceof PricingError) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('pricing.compareTiers.error', err);
      captureRouteError(err, 'pricing.compareTiers');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. worker-break-even
// ────────────────────────────────────────────────────────────────────────

const breakEvenSchema = z.object({
  currentTier: z.enum(TIERS),
  nextTier: z.enum(TIERS),
  baseUsage: usageSchema,
  options: optionsSchema,
});

router.post(
  '/:projectId/pricing/worker-break-even',
  verifyAuth,
  validate(breakEvenSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof breakEvenSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = workerBreakEven(
        body.currentTier,
        body.nextTier,
        body.baseUsage,
        body.options,
      );
      return res.json(result);
    } catch (err) {
      if (err instanceof PricingError) {
        return res.status(400).json({ error: err.message });
      }
      logger.error?.('pricing.workerBreakEven.error', err);
      captureRouteError(err, 'pricing.workerBreakEven');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
