// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.4 — B2D Hazmat / engineering calculations API.
//
// Mounted via `app.use('/api/b2d/v1/hazmat', hazmatRouter)`.
//
// Endpoints (all `hazmat.calculate` scope):
//   • POST /api/b2d/v1/hazmat/pipe-pressure
//   • POST /api/b2d/v1/hazmat/gas-dispersion
//   • POST /api/b2d/v1/hazmat/scaffold-uplift
//   • POST /api/b2d/v1/hazmat/extinguisher-coverage
//
// Each endpoint:
//   1. Validates input via zod.
//   2. Calls the pure Bernoulli generator with the integrator's payload.
//   3. Returns `{ result, citations, computedAt }`.
//
// Privacy boundary: NO tenant data accessed. All inputs come from the
// integrator's request body; the generators are pure functions over
// numeric inputs.

import { Router } from 'express';
import { z } from 'zod';

import { b2dAuth } from '../../middleware/b2dAuth.js';
import { trackB2dUsage } from '../../../services/b2d/usage.js';

import { generateHazmatPipeNode } from '../../../services/zettelkasten/bernoulli/hazmatPipePressure.js';
import { generateGasDispersionNode } from '../../../services/zettelkasten/bernoulli/gasDispersionCloud.js';
import { generateScaffoldUpliftNode } from '../../../services/zettelkasten/bernoulli/scaffoldWindSuction.js';
import {
  ruleExtinguisherCoverage,
  type PlacementContext,
} from '../../../services/digitalTwin/objectPlacement/normativaRules.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const PipePressureSchema = z.object({
  pipe: z.object({
    id: z.string().min(1),
    velocityInMs: z.number().positive(),
    velocityOutMs: z.number().positive(),
    heightDeltaM: z.number().finite(),
  }),
  fluid: z.object({
    id: z.string().min(1),
    densityKgM3: z.number().positive(),
    vaporPressurePa: z.number().nonnegative(),
  }),
  pumpHead: z.object({
    upstreamPressurePa: z.number().finite(),
  }),
});

const GasDispersionSchema = z.object({
  leak: z.object({
    id: z.string().min(1),
    releaseRateKgS: z.number().positive(),
    idlhMgM3: z.number().positive(),
    relativeDensity: z.number().positive(),
  }),
  weather: z.object({
    windKmh: z.number().positive(),
    pasquillStability: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
  }),
  terrain: z.object({
    id: z.string().min(1),
    roughnessM: z.number().positive(),
  }),
});

const ScaffoldUpliftSchema = z.object({
  scaffold: z.object({
    id: z.string().min(1),
    areaM2: z.number().positive(),
    pressureCoefficient: z.number().finite(),
  }),
  weather: z.object({
    windKmh: z.number().positive(),
  }),
  anchorage: z.object({
    ratedCapacityN: z.number().positive(),
    anchorCount: z.number().int().positive(),
  }),
});

const Vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

const ExtinguisherCoverageSchema = z.object({
  workstations: z
    .array(z.object({ id: z.string().min(1), position: Vec3Schema }))
    .min(1),
  extinguishers: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(['extinguisher_pqs', 'extinguisher_co2', 'extinguisher_water']),
        position: Vec3Schema,
        lifecycle: z
          .enum(['active', 'installed', 'planning', 'retired'])
          .default('active'),
      }),
    )
    .default([]),
});

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function bad(res: import('express').Response, issue: unknown) {
  return res.status(400).json({ error: 'invalid_input', issue });
}

async function track(req: import('express').Request) {
  const customerId = (req as any).b2dKey?.customerId as string;
  if (customerId) await trackB2dUsage(customerId);
}

// ────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────

router.post('/pipe-pressure', b2dAuth('hazmat.calculate'), async (req, res) => {
  const parsed = PipePressureSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed.error.flatten());

  const node = generateHazmatPipeNode(parsed.data.pipe, parsed.data.fluid, parsed.data.pumpHead);
  await track(req);
  return res.json({
    result: node ?? { ok: true, message: 'within_safe_envelope' },
    citations: ['DS 43/2015', 'NFPA 30'],
    computedAt: new Date().toISOString(),
  });
});

router.post('/gas-dispersion', b2dAuth('hazmat.calculate'), async (req, res) => {
  const parsed = GasDispersionSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed.error.flatten());

  const node = generateGasDispersionNode(
    parsed.data.leak,
    parsed.data.weather,
    parsed.data.terrain,
  );
  await track(req);
  return res.json({
    result: node ?? { ok: true, message: 'no_exclusion_zone' },
    citations: ['DS 144/1961', 'MINSAL ATSDR', 'Pasquill-Gifford'],
    computedAt: new Date().toISOString(),
  });
});

router.post('/scaffold-uplift', b2dAuth('hazmat.calculate'), async (req, res) => {
  const parsed = ScaffoldUpliftSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed.error.flatten());

  const node = generateScaffoldUpliftNode(
    parsed.data.scaffold,
    parsed.data.weather,
    parsed.data.anchorage,
  );
  await track(req);
  return res.json({
    result: node ?? { ok: true, message: 'anchorage_sufficient' },
    citations: ['NCh 432 Of.71', 'DS 594 Art. 78', 'OSHA 29 CFR 1926.451'],
    computedAt: new Date().toISOString(),
  });
});

router.post('/extinguisher-coverage', b2dAuth('hazmat.calculate'), async (req, res) => {
  const parsed = ExtinguisherCoverageSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed.error.flatten());

  const placedObjects = parsed.data.extinguishers.map((e) => ({
    id: e.id,
    kind: e.kind,
    position: e.position,
    lifecycle: e.lifecycle,
    // Fields not used by the rule but required by PlacedObject — provide
    // benign defaults so the type contract holds without leaking shape.
    rotationDeg: 0,
    placedAt: 0,
    placedBy: 'b2d-api',
  }));
  const ctx: PlacementContext = {
    placedObjects: placedObjects as any, // benign: rule reads only kind/position/lifecycle
    workstations: parsed.data.workstations,
  };
  const violations = ruleExtinguisherCoverage(ctx);
  await track(req);
  return res.json({
    result: {
      compliant: violations.length === 0,
      violations,
    },
    citations: ['DS 594 art. 47'],
    computedAt: new Date().toISOString(),
  });
});

export default router;
