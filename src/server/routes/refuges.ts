// Praeventio Guard — Mountain Refuges (CONAF + clubes andinos) HTTP surface.
//
// Sprint C 2026-05-15 — three stateless endpoints over the catalog under
// `src/services/refuges/mountainRefuges.ts`:
//
//   POST /:projectId/refuges/list-catalog
//     body: { region?, requireYearRound? }
//     200:  { refuges: MountainRefuge[] }
//
//   POST /:projectId/refuges/find-nearest
//     body: { lat, lng, count?, region?, requireYearRound? }
//     200:  { refuges: RefugeWithDistance[] }
//
//   POST /:projectId/refuges/availability
//     body: { season }
//     200:  { availability: 'open'|'check'|'closed' }
//
// Catálogo curado, verificado contra OpenStreetMap (2026-05-15).

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
  MOUNTAIN_REFUGES_CHILE,
  findNearestRefuges,
  refugeAvailability,
  type MountainRefuge,
} from '../../services/refuges/mountainRefuges.js';

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

const REGIONS = [
  'norte_grande',
  'norte_chico',
  'central',
  'sur',
  'austral',
] as const satisfies readonly MountainRefuge['region'][];

const SEASONS = [
  'year_round',
  'spring_summer_autumn',
  'summer_only',
  'winter_only',
  'closed',
] as const satisfies readonly MountainRefuge['season'][];

// ────────────────────────────────────────────────────────────────────────
// 1. list-catalog
// ────────────────────────────────────────────────────────────────────────

const listCatalogSchema = z.object({
  region: z.enum(REGIONS).optional(),
  requireYearRound: z.boolean().optional(),
});

router.post(
  '/:projectId/refuges/list-catalog',
  verifyAuth,
  validate(listCatalogSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof listCatalogSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      let refuges = MOUNTAIN_REFUGES_CHILE;
      if (body.region) refuges = refuges.filter((r) => r.region === body.region);
      if (body.requireYearRound) refuges = refuges.filter((r) => r.season === 'year_round');
      return res.json({ refuges });
    } catch (err) {
      logger.error?.('refuges.listCatalog.error', err);
      captureRouteError(err, 'refuges.listCatalog');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. find-nearest
// ────────────────────────────────────────────────────────────────────────

const findNearestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  count: z.number().int().positive().max(50).optional(),
  region: z.enum(REGIONS).optional(),
  requireYearRound: z.boolean().optional(),
});

router.post(
  '/:projectId/refuges/find-nearest',
  verifyAuth,
  validate(findNearestSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof findNearestSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const refuges = findNearestRefuges(body.lat, body.lng, {
        count: body.count,
        region: body.region,
        requireYearRound: body.requireYearRound,
      });
      return res.json({ refuges });
    } catch (err) {
      logger.error?.('refuges.findNearest.error', err);
      captureRouteError(err, 'refuges.findNearest');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. availability
// ────────────────────────────────────────────────────────────────────────

const availabilitySchema = z.object({
  season: z.enum(SEASONS),
});

router.post(
  '/:projectId/refuges/availability',
  verifyAuth,
  validate(availabilitySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof availabilitySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const availability = refugeAvailability({ season: body.season });
      return res.json({ availability });
    } catch (err) {
      logger.error?.('refuges.availability.error', err);
      captureRouteError(err, 'refuges.availability');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
