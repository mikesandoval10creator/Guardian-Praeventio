// Praeventio Guard — Bowtie Risk Analysis HTTP surface.
//
// Sprint K (gestión de riesgos): bowtie diagram is the international
// standard in high-risk industries (mining, petrochem, aviation) for
// visualizing threats → barriers → event → barriers → consequences.
//
// 3 stateless endpoints over the engine under
// `src/services/bowtie/bowtieAnalysisBuilder.ts`:
//
//   POST /:projectId/bowtie/build
//     body: BuildBowtieInput (without tenantId — server fills it)
//     200:  { diagram: BowtieDiagram }
//     400:  BowtieValidationError → { error, code }
//
//   POST /:projectId/bowtie/list-unprotected-threats
//     body: { diagram }
//     200:  { threats: Threat[] }
//
//   POST /:projectId/bowtie/recommend-next-barrier
//     body: { threat }
//     200:  { barrierType: BarrierType }
//
// Engine is fully deterministic — no Firestore writes. Caller persists
// the resulting BowtieDiagram to their own collection.

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
  buildBowtie,
  listUnprotectedThreats,
  recommendNextBarrierType,
  BowtieValidationError,
  type BowtieDiagram,
  type Threat,
} from '../../services/bowtie/bowtieAnalysisBuilder.js';

const router = Router();

async function resolveTenantId(
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
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
  const tenantId = await resolveTenantId(projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ────────────────────────────────────────────────────────────────────────
// Engine enums
// ────────────────────────────────────────────────────────────────────────

const BARRIER_TYPES = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'ppe',
] as const;

const BARRIER_STATUSES = [
  'in_place',
  'planned',
  'missing',
  'degraded',
] as const;

const SEVERITY_LEVELS = ['low', 'medium', 'high', 'catastrophic'] as const;

// ────────────────────────────────────────────────────────────────────────
// Schema fragments
// ────────────────────────────────────────────────────────────────────────

const barrierSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  type: z.enum(BARRIER_TYPES),
  status: z.enum(BARRIER_STATUSES),
  effectiveness: z.number().min(0).max(1),
  ownerRole: z.string().min(1).max(120).optional(),
});

const threatSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  preventiveBarriers: z.array(barrierSchema).max(50),
}) as unknown as z.ZodType<Threat>;

const consequenceSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  severity: z.enum(SEVERITY_LEVELS),
  mitigatingBarriers: z.array(barrierSchema).max(50),
});

const hazardousEventSchema = z.object({
  id: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  category: z.string().min(1).max(120),
});

// ────────────────────────────────────────────────────────────────────────
// 1. build (server-side fills tenantId from projectId)
// ────────────────────────────────────────────────────────────────────────

const buildSchema = z.object({
  diagramId: z.string().min(1).max(200),
  hazardousEvent: hazardousEventSchema,
  threats: z.array(threatSchema).min(1).max(100),
  consequences: z.array(consequenceSchema).min(1).max(100),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/bowtie/build',
  verifyAuth,
  validate(buildSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof buildSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const diagram = buildBowtie({
        diagramId: body.diagramId,
        tenantId: g.tenantId,
        hazardousEvent: body.hazardousEvent,
        threats: body.threats,
        consequences: body.consequences,
        now: body.now ? new Date(body.now) : undefined,
      });
      return res.json({ diagram });
    } catch (err) {
      if (err instanceof BowtieValidationError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      logger.error?.('bowtie.build.error', err);
      captureRouteError(err, 'bowtie.build');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. list-unprotected-threats
// ────────────────────────────────────────────────────────────────────────

// The engine's BowtieDiagram is a deep shape; accept it loosely.
const diagramSchema = z.unknown() as unknown as z.ZodType<BowtieDiagram>;

const listUnprotectedSchema = z.object({
  diagram: diagramSchema,
});

router.post(
  '/:projectId/bowtie/list-unprotected-threats',
  verifyAuth,
  validate(listUnprotectedSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof listUnprotectedSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const threats = listUnprotectedThreats(body.diagram);
      return res.json({ threats });
    } catch (err) {
      logger.error?.('bowtie.listUnprotected.error', err);
      captureRouteError(err, 'bowtie.listUnprotected');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. recommend-next-barrier
// ────────────────────────────────────────────────────────────────────────

const recommendNextSchema = z.object({
  threat: threatSchema,
});

router.post(
  '/:projectId/bowtie/recommend-next-barrier',
  verifyAuth,
  validate(recommendNextSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof recommendNextSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const barrierType = recommendNextBarrierType(body.threat);
      return res.json({ barrierType });
    } catch (err) {
      logger.error?.('bowtie.recommendNext.error', err);
      captureRouteError(err, 'bowtie.recommendNext');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
