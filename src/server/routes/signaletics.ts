// Praeventio Guard — Signaletics HTTP surface.
//
// 3 stateless endpoints (pure compute over caller-supplied inputs):
//   POST /:projectId/signaletics/audit-zone
//     body: SignageZoneAudit
//     200:  { result: ZoneAuditResult }
//   POST /:projectId/signaletics/rank-site
//     body: { audits: ZoneAuditResult[] }
//     200:  { ranking: SiteRanking }
//   POST /:projectId/signaletics/evacuation-paths
//     body: { nodes: EvacuationNode[], startId: string, riskyZones?: string[],
//             maxRoutes?: number }
//     200:  { paths: EvacuationPath[] }
//
// No Firestore writes — the engine is pure compute and zone storage
// lives in different collections per project. Storage of audit history
// is a separate follow-up wire-up.

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
  auditZoneSignage,
  rankSiteSignage,
  findEvacuationPaths,
  type SignageCode,
  type SignagePlacement,
  type ZoneKind,
  type ZoneAuditResult,
  type EvacuationNode,
} from '../../services/signaletics/signageValidator.js';

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

const ZONE_KINDS = [
  'office',
  'corridor',
  'production_floor',
  'electrical_room',
  'chemical_storage',
  'restricted_area',
  'evacuation_route',
  'first_aid_room',
  'maintenance_workshop',
  'forklift_area',
  'high_temperature_area',
  'biological_lab',
  'fueling_station',
  'confined_space_access',
] as const satisfies readonly ZoneKind[];

// Loose check on signage codes — the engine has an exhaustive list; the
// router accepts any non-empty string + a length cap so future code
// additions don't require a route update.
const signageCodeSchema = z.string().min(2).max(64) as unknown as z.ZodType<SignageCode>;

const placementSchema = z.object({
  code: signageCodeSchema,
  position: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    floor: z.number().optional(),
    description: z.string().max(500).optional(),
  }).passthrough(),
  installedAt: z.string().min(10).optional(),
  lastInspectionAt: z.string().min(10).optional(),
  condition: z
    .enum(['ok', 'damaged', 'obscured', 'illegible', 'wrong_position'])
    .optional(),
}).passthrough() as unknown as z.ZodType<SignagePlacement>;

const zoneAuditSchema = z.object({
  zoneId: z.string().min(1).max(200),
  zoneKind: z.enum(ZONE_KINDS),
  placedSignage: z.array(placementSchema).max(500),
  extraRequired: z.array(signageCodeSchema).max(50).optional(),
});

router.post(
  '/:projectId/signaletics/audit-zone',
  verifyAuth,
  validate(zoneAuditSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof zoneAuditSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = auditZoneSignage(body, new Date());
      return res.json({ result });
    } catch (err) {
      logger.error?.('signaletics.auditZone.error', err);
      captureRouteError(err, 'signaletics.auditZone');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ZoneAuditResult is the engine's output shape — we accept it as input
// for the rank-site endpoint with a loose schema (no zod for the gap
// shape since clients build it from a prior audit-zone response).
const rankSiteSchema = z.object({
  audits: z
    .array(z.unknown())
    .min(1)
    .max(500) as unknown as z.ZodType<ZoneAuditResult[]>,
});

router.post(
  '/:projectId/signaletics/rank-site',
  verifyAuth,
  validate(rankSiteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as { audits: ZoneAuditResult[] };
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const ranking = rankSiteSignage(body.audits);
      return res.json({ ranking });
    } catch (err) {
      logger.error?.('signaletics.rankSite.error', err);
      captureRouteError(err, 'signaletics.rankSite');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const evacNodeSchema = z.object({
  id: z.string().min(1).max(120),
  position: z.object({
    lat: z.number(),
    lng: z.number(),
    floor: z.number().optional(),
  }),
  isExit: z.boolean().optional(),
  blocked: z.boolean().optional(),
  connectsTo: z.array(z.string().min(1).max(120)).max(50),
}) as unknown as z.ZodType<EvacuationNode>;

const evacPathsSchema = z.object({
  nodes: z.array(evacNodeSchema).min(2).max(500),
  startId: z.string().min(1).max(120),
  riskyZones: z.array(z.string().min(1).max(120)).max(100).optional(),
  maxRoutes: z.number().int().min(1).max(10).optional(),
});

router.post(
  '/:projectId/signaletics/evacuation-paths',
  verifyAuth,
  validate(evacPathsSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evacPathsSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const paths = findEvacuationPaths(
        body.nodes,
        body.startId,
        new Set(body.riskyZones ?? []),
        body.maxRoutes ?? 3,
      );
      return res.json({ paths });
    } catch (err) {
      logger.error?.('signaletics.evacPaths.error', err);
      captureRouteError(err, 'signaletics.evacPaths');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
