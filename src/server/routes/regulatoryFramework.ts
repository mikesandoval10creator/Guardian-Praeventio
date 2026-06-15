// Praeventio Guard — Regulatory Framework HTTP surface (ISO 45001 + 14 jurisdictions).
//
// Sprint 28-31 (B1, EE, OO) — surface HTTP sobre el engine en
// `src/services/regulatory/registry.ts`. Pure lookup: el engine ya
// resuelve ISO 45001 + país nativo + extra jurisdictions con respeto a
// `tier` limits.
//
//   POST /:projectId/regulatory/active-jurisdictions
//     body: { ctx, tier? }
//     200:  { jurisdictions: JurisdictionCode[] }
//
//   POST /:projectId/regulatory/cite
//     body: { controlId, jurisdictions, format? }
//     200:  { citations: string[] }
//
//   POST /:projectId/regulatory/resolve-control
//     body: { controlId, jurisdictions }
//     200:  { control?: ComplianceControl }
//
//   POST /:projectId/regulatory/list-controls
//     body: {}
//     200:  { controls: ComplianceControl[] }
//
//   POST /:projectId/regulatory/references
//     body: { controlId, jurisdictions }
//     200:  { references: RegulationRef[] }

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
  getActiveJurisdictions,
  cite,
  resolveControl,
  listControls,
  getReferencesForControl,
  type CiteOptions,
  type TenantRegulatoryContext,
} from '../../services/regulatory/registry.js';
import type { JurisdictionCode } from '../../services/regulatory/types.js';

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

const JURISDICTION_CODES = [
  'ISO-45001',
  'CL',
  'US-OSHA',
  'EU',
  'MX',
  'BR',
  'UK',
  'CA',
  'AU',
  'JP',
  'KR',
  'IN',
  'CN',
  'TW',
  'RU',
] as const satisfies readonly JurisdictionCode[];

const TIER_IDS = [
  'gratis',
  'cobre',
  'plata',
  'oro',
  'titanio',
  'platino',
  'diamante',
] as const;

const tenantContextSchema = z.object({
  country: z.string().min(1).max(100).optional(),
  dataResidency: z.string().min(1).max(100).optional(),
  extraCountries: z.array(z.string().min(1).max(100)).max(50).optional(),
}) as unknown as z.ZodType<TenantRegulatoryContext>;

// ────────────────────────────────────────────────────────────────────────
// 1. active-jurisdictions
// ────────────────────────────────────────────────────────────────────────

const activeSchema = z.object({
  ctx: tenantContextSchema,
  tier: z.enum(TIER_IDS).optional(),
});

router.post(
  '/:projectId/regulatory/active-jurisdictions',
  verifyAuth,
  validate(activeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof activeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const jurisdictions = getActiveJurisdictions(body.ctx, body.tier);
      return res.json({ jurisdictions });
    } catch (err) {
      logger.error?.('regulatory.activeJurisdictions.error', err);
      captureRouteError(err, 'regulatory.activeJurisdictions');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. cite
// ────────────────────────────────────────────────────────────────────────

const citeSchema = z.object({
  controlId: z.string().min(1).max(200),
  jurisdictions: z.array(z.enum(JURISDICTION_CODES)).min(1).max(JURISDICTION_CODES.length),
  format: z.enum(['short', 'long']).optional(),
});

router.post(
  '/:projectId/regulatory/cite',
  verifyAuth,
  validate(citeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof citeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const opts: CiteOptions = {
        jurisdictions: body.jurisdictions as JurisdictionCode[],
        format: body.format,
      };
      const citations = cite(body.controlId, opts);
      return res.json({ citations });
    } catch (err) {
      logger.error?.('regulatory.cite.error', err);
      captureRouteError(err, 'regulatory.cite');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. resolve-control
// ────────────────────────────────────────────────────────────────────────

const resolveSchema = z.object({
  controlId: z.string().min(1).max(200),
  jurisdictions: z.array(z.enum(JURISDICTION_CODES)).min(1).max(JURISDICTION_CODES.length),
});

router.post(
  '/:projectId/regulatory/resolve-control',
  verifyAuth,
  validate(resolveSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof resolveSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const control = resolveControl(
        body.controlId,
        body.jurisdictions as JurisdictionCode[],
      );
      return res.json({ control: control ?? null });
    } catch (err) {
      logger.error?.('regulatory.resolveControl.error', err);
      captureRouteError(err, 'regulatory.resolveControl');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. list-controls
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/regulatory/list-controls',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const controls = listControls();
      return res.json({ controls });
    } catch (err) {
      logger.error?.('regulatory.listControls.error', err);
      captureRouteError(err, 'regulatory.listControls');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. references
// ────────────────────────────────────────────────────────────────────────

const referencesSchema = z.object({
  controlId: z.string().min(1).max(200),
  jurisdictions: z.array(z.enum(JURISDICTION_CODES)).min(1).max(JURISDICTION_CODES.length),
});

router.post(
  '/:projectId/regulatory/references',
  verifyAuth,
  validate(referencesSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof referencesSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const references = getReferencesForControl(
        body.controlId,
        body.jurisdictions as JurisdictionCode[],
      );
      return res.json({ references });
    } catch (err) {
      logger.error?.('regulatory.references.error', err);
      captureRouteError(err, 'regulatory.references');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
