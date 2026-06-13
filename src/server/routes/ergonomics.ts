// Praeventio Guard — Ergonomics REBA/RULA HTTP surface.
//
// Two stateless endpoints over the engines under `src/services/ergonomics/`:
//
//   POST /:projectId/ergonomics/calculate-reba
//     body: RebaInput
//     200:  { result: RebaResult }
//
//   POST /:projectId/ergonomics/calculate-rula
//     body: RulaInput
//     200:  { result: RulaResult }
//
// Pure compute — no Firestore writes. Canonical scoring per Hignett &
// McAtamney (REBA, 2000) and McAtamney & Corlett (RULA, 1993).
// Replaces AI delegation for safety-critical ergonomic scoring.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { callerTenantOr403 } from '../auth/callerTenant.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  calculateReba,
  type RebaInput,
} from '../../services/ergonomics/reba.js';
import {
  calculateRula,
  type RulaInput,
} from '../../services/ergonomics/rula.js';
import {
  triggerLegalConsequencesIfNeeded,
  crossesLegalThreshold,
} from '../../services/safety/ergonomicLegalTrigger.js';
import type { MinimalFolioStore } from '../../services/suseso/folioGenerator.js';

const router = Router();

// Admin-SDK folioStore for the DS-594 art. 110 legal trigger. The DIEP
// folio counter lives at `tenants/{tid}/suseso_counters/{year}-DIEP`, which
// `firestore.rules` denies to ALL clients (server-only). The browser wizard
// therefore CANNOT allocate a folio with the client SDK — it must round-trip
// through this route. Mirrors `buildFolioStore` in routes/suseso.ts.
function buildFolioStore(): MinimalFolioStore {
  const fs = admin.firestore();
  return {
    async runTransaction(fn) {
      return fs.runTransaction(async (tx) => {
        return fn({
          async get(path: string) {
            const ref = fs.doc(path);
            const snap = await tx.get(ref);
            return snap.exists
              ? { exists: true, data: snap.data() as { lastSeq?: number } }
              : { exists: false };
          },
          set(path: string, value: { lastSeq: number }) {
            tx.set(fs.doc(path), value);
          },
        });
      });
    },
  };
}

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

const COUPLINGS = ['good', 'fair', 'poor', 'unacceptable'] as const;
const FORCE_PATTERNS = ['intermittent', 'static', 'repeated', 'shock'] as const;

// The pure engines (reba.ts / rula.ts) throw on bad input: RULA raises
// `RangeError`, REBA raises `Error` with a message prefixed `REBA:` (RULA
// also prefixes `RULA:`). Those are client-input faults → 400, not 500.
// Defense-in-depth behind the zod `validate()` barrier: if the schema ever
// drifts looser than the engine, a bad request still surfaces as 400 rather
// than a misleading 500 (CLAUDE.md #8).
function isValidationError(err: unknown): boolean {
  if (err instanceof RangeError) return true;
  if (err instanceof Error && /^(REBA|RULA):/.test(err.message)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// 1. calculate-reba
// ────────────────────────────────────────────────────────────────────────

const rebaSchema = z.object({
  trunk: z.object({
    flexionDeg: z.number().min(-90).max(180),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  neck: z.object({
    flexionDeg: z.number().min(-90).max(180),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  legs: z.object({
    bilateralSupport: z.boolean(),
    kneeFlexionDeg: z.number().min(0).max(180),
  }),
  upperArm: z.object({
    flexionDeg: z.number().min(-90).max(180),
    shoulderRaised: z.boolean().optional(),
    abducted: z.boolean().optional(),
    supported: z.boolean().optional(),
  }),
  lowerArm: z.object({
    flexionDeg: z.number().min(0).max(180),
  }),
  wrist: z.object({
    flexionDeg: z.number().min(-90).max(90),
    twistedOrDeviated: z.boolean().optional(),
  }),
  load: z.object({
    kg: z.number().nonnegative().max(1000),
    shockOrRapid: z.boolean().optional(),
  }),
  coupling: z.enum(COUPLINGS),
  activity: z.object({
    staticOver1Min: z.boolean().optional(),
    repeatedSmallRange: z.boolean().optional(),
    rapidLargeRangeChanges: z.boolean().optional(),
  }),
}) as unknown as z.ZodType<RebaInput>;

router.post(
  '/:projectId/ergonomics/calculate-reba',
  verifyAuth,
  validate(rebaSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rebaSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculateReba(body);
      return res.json({ result });
    } catch (err) {
      if (isValidationError(err)) {
        logger.warn('ergonomics.calculateReba.invalid_input', {
          message: err instanceof Error ? err.message : String(err),
        });
        return res.status(400).json({ error: 'invalid_input' });
      }
      logger.error?.('ergonomics.calculateReba.error', err);
      captureRouteError(err, 'ergonomics.calculateReba');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. calculate-rula
// ────────────────────────────────────────────────────────────────────────

const rulaSchema = z.object({
  upperArm: z.object({
    flexionDeg: z.number().min(-90).max(180),
    shoulderRaised: z.boolean().optional(),
    abducted: z.boolean().optional(),
    supported: z.boolean().optional(),
  }),
  lowerArm: z.object({
    flexionDeg: z.number().min(0).max(180),
    acrossMidlineOrOut: z.boolean().optional(),
  }),
  wrist: z.object({
    flexionDeg: z.number().min(-90).max(90),
    deviated: z.boolean().optional(),
  }),
  wristTwist: z.enum(['mid', 'end']),
  neck: z.object({
    flexionDeg: z.number().min(-90).max(180),
    inExtension: z.boolean().optional(),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  trunk: z.object({
    flexionDeg: z.number().min(-90).max(180),
    wellSupported: z.boolean().optional(),
    twisted: z.boolean().optional(),
    sideBent: z.boolean().optional(),
  }),
  legs: z.object({
    supportedAndBalanced: z.boolean(),
  }),
  muscleUse: z.object({
    staticOver1Min: z.boolean().optional(),
    repeatedOver4Min: z.boolean().optional(),
  }),
  force: z.object({
    kg: z.number().nonnegative().max(1000),
    pattern: z.enum(FORCE_PATTERNS),
  }),
}) as unknown as z.ZodType<RulaInput>;

router.post(
  '/:projectId/ergonomics/calculate-rula',
  verifyAuth,
  validate(rulaSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof rulaSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculateRula(body);
      return res.json({ result });
    } catch (err) {
      if (isValidationError(err)) {
        logger.warn('ergonomics.calculateRula.invalid_input', {
          message: err instanceof Error ? err.message : String(err),
        });
        return res.status(400).json({ error: 'invalid_input' });
      }
      logger.error?.('ergonomics.calculateRula.error', err);
      captureRouteError(err, 'ergonomics.calculateRula');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. legal-trigger — DS-594 art. 110 DIEP folio + Zettelkasten node + audit
// ────────────────────────────────────────────────────────────────────────
//
// WHY a server route: REBA>=11 / RULA>=7 cross the legal action threshold and
// must pre-allocate a DIEP folio (Circular SUSESO 3596 / ISO 11226). That
// folio counter is Admin-SDK-only (firestore.rules denies clients), so the
// browser wizard (AddErgonomicsModal) cannot do it directly — it persists the
// technical assessment with the client SDK, then fire-and-forget POSTs here so
// the legal consequence still fires in PRODUCTION (the previous wiring never
// supplied folioStore+tenantId, so the trigger was dead code in the browser).
//
// The assessment itself is already saved + audited by the client; this route
// only emits the LEGAL side-effects. Identity + tenant come from the verified
// token, never the body (CLAUDE.md #3). Audit write is awaited (CLAUDE.md #14).

const legalTriggerSchema = z.object({
  assessmentId: z.string().min(1),
  workerId: z.string().min(1),
  type: z.enum(['REBA', 'RULA']),
  score: z.number().finite(),
  computedAt: z.string().min(1),
  // Echoed back for the cross-tenant guard; authoritative value is the token.
  tenantId: z.string().min(1).optional(),
});

router.post(
  '/:projectId/ergonomics/legal-trigger',
  verifyAuth,
  validate(legalTriggerSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof legalTriggerSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    // Tenant is authoritative from the verified token — never the body.
    const tenantId = callerTenantOr403(req, res, body.tenantId);
    if (tenantId === null) return undefined;

    // Below the legal threshold there is nothing to do — short-circuit so a
    // routine assessment never wastes a folio or writes a misleading audit.
    if (!crossesLegalThreshold(body.type, body.score)) {
      return res.json({ triggered: false });
    }

    try {
      const result = await triggerLegalConsequencesIfNeeded(
        {
          assessmentId: body.assessmentId,
          workerId: body.workerId,
          projectId,
          tenantId,
          type: body.type,
          score: body.score,
          computedAt: body.computedAt,
        },
        {
          folioStore: buildFolioStore(),
          // Server-stamped audit (actor from the verified token). The default
          // `logAuditAction` only works in the browser (auth.currentUser +
          // relative fetch), so on the server we route through auditServerEvent.
          auditLog: async (action, _module, details) => {
            await auditServerEvent(req, action, 'safety', details, { projectId });
          },
        },
      );
      return res.json({
        triggered: result.triggered,
        diepFolio: result.diepFolio ?? null,
        derivedNodeId: result.nodeSpec?.id ?? null,
      });
    } catch (err) {
      logger.error?.('ergonomics.legalTrigger.error', err);
      captureRouteError(err, 'ergonomics.legalTrigger');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
