// Praeventio Guard — PIN Sign HTTP surface (F.25 fallback sin biometría).
//
// Sprint K reformulado §F.25 — five stateless endpoints over
// `src/services/pinSign/pinSignService.ts`. La persistencia (Firestore)
// queda a cargo del caller; este surface valida + computa puro.
//
//   POST /:projectId/pin-sign/register     (workerUid forced from caller)
//   POST /:projectId/pin-sign/verify       (workerUid forced)
//   POST /:projectId/pin-sign/sign-item    (verify + build ack en una llamada)
//   POST /:projectId/pin-sign/validate-policy
//   POST /:projectId/pin-sign/verify-acknowledgement
//
// El `serverSecret` para attestation HMAC se lee de
// `PIN_SIGN_SERVER_SECRET` (env). Falla si no está presente. NUNCA cruza
// al cliente.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { randomBytes } from 'crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  registerPin,
  verifyPin,
  buildAcknowledgement,
  verifyAcknowledgement,
  validatePinPolicy,
  PinSignValidationError,
  type PinCredential,
  type PinSignItemKind,
  type PinSignedAcknowledgement,
} from '../../services/pinSign/pinSignService.js';

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

function getServerSecret(): string {
  const s = process.env.PIN_SIGN_SERVER_SECRET;
  if (!s || s.length < 16) {
    throw new PinSignValidationError(
      'MISSING_SERVER_SECRET',
      'PIN_SIGN_SERVER_SECRET env var must be set to a value of length >= 16',
    );
  }
  return s;
}

const ITEM_KINDS = [
  'epp_delivery',
  'safety_talk',
  'document_read',
  'training_completion',
  'permit_acknowledgement',
  'inspection_handover',
] as const satisfies readonly PinSignItemKind[];

const pinSchema = z.string().regex(/^\d{4,6}$/);

const credentialSchema = z.object({
  workerUid: z.string().min(1).max(200),
  saltHex: z.string().min(32).max(128),
  hashHex: z.string().min(32).max(128),
  iterations: z.number().int().positive().max(10_000_000),
  createdAt: z.string().min(10).max(64),
  consecutiveFailures: z.number().int().nonnegative().max(1000),
  lockedUntil: z.string().min(10).max(64).optional(),
}) as unknown as z.ZodType<PinCredential>;

const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .optional();

function asEngineError(err: unknown): { code: number; body: { error: string } } | null {
  if (err instanceof PinSignValidationError) {
    if (err.message.includes('MISSING_SERVER_SECRET')) {
      return { code: 500, body: { error: 'server_misconfigured' } };
    }
    return { code: 400, body: { error: err.message } };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 1. validate-policy  (preflight UI)
// ────────────────────────────────────────────────────────────────────────

const validatePolicySchema = z.object({
  pin: pinSchema,
});

router.post(
  '/:projectId/pin-sign/validate-policy',
  verifyAuth,
  validate(validatePolicySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validatePolicySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      validatePinPolicy(body.pin);
      return res.json({ ok: true });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('pinSign.validatePolicy.error', err);
      captureRouteError(err, 'pinSign.validatePolicy');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. register  (workerUid = caller; salt generado server-side)
// ────────────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  pin: pinSchema,
});

router.post(
  '/:projectId/pin-sign/register',
  verifyAuth,
  validate(registerSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof registerSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      // Generate cryptographic salt server-side (do NOT trust caller).
      const saltHex = randomBytes(16).toString('hex');
      const credential = registerPin({
        workerUid: callerUid,
        pin: body.pin,
        saltHex,
      });
      // NEVER return the hash to the client; only confirm registration.
      return res.json({
        registered: true,
        workerUid: credential.workerUid,
        createdAt: credential.createdAt,
      });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('pinSign.register.error', err);
      captureRouteError(err, 'pinSign.register');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. verify  (returns ok + lockout info, but updated cred is opaque)
// ────────────────────────────────────────────────────────────────────────

const verifySchema = z.object({
  credential: credentialSchema,
  pin: pinSchema,
});

router.post(
  '/:projectId/pin-sign/verify',
  verifyAuth,
  validate(verifySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof verifySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    // The credential must belong to the authenticated caller.
    if (body.credential.workerUid !== callerUid) {
      return res.status(403).json({ error: 'forbidden_credential' });
    }
    try {
      const outcome = verifyPin({ credential: body.credential, pin: body.pin });
      return res.json({
        ok: outcome.ok,
        justLockedOut: outcome.justLockedOut,
        remainingLockoutMinutes: outcome.remainingLockoutMinutes,
        // The updated credential is returned so the caller (typically a
        // server-side persistence layer) can write it back to Firestore.
        // The hashHex stays intact — re-derivable later.
        credential: outcome.credential,
      });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('pinSign.verify.error', err);
      captureRouteError(err, 'pinSign.verify');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. sign-item  (verify + build ack atomically; preferido por las UIs)
// ────────────────────────────────────────────────────────────────────────

const signItemSchema = z.object({
  credential: credentialSchema,
  pin: pinSchema,
  itemId: z.string().min(1).max(200),
  kind: z.enum(ITEM_KINDS),
  location: locationSchema,
});

router.post(
  '/:projectId/pin-sign/sign-item',
  verifyAuth,
  validate(signItemSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof signItemSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (body.credential.workerUid !== callerUid) {
      return res.status(403).json({ error: 'forbidden_credential' });
    }
    try {
      const outcome = verifyPin({ credential: body.credential, pin: body.pin });
      if (!outcome.ok) {
        return res.status(401).json({
          ok: false,
          justLockedOut: outcome.justLockedOut,
          remainingLockoutMinutes: outcome.remainingLockoutMinutes,
          credential: outcome.credential,
        });
      }
      const serverSecret = getServerSecret();
      const acknowledgement = buildAcknowledgement(
        {
          itemId: body.itemId,
          kind: body.kind,
          projectId,
          signedByUid: callerUid,
          location: body.location,
        },
        serverSecret,
      );
      return res.json({
        ok: true,
        acknowledgement,
        credential: outcome.credential,
      });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('pinSign.signItem.error', err);
      captureRouteError(err, 'pinSign.signItem');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. verify-acknowledgement  (audit-time tamper detection)
// ────────────────────────────────────────────────────────────────────────

const ackSchema = z.object({
  itemId: z.string().min(1).max(200),
  kind: z.enum(ITEM_KINDS),
  projectId: z.string().min(1).max(200),
  signedByUid: z.string().min(1).max(200),
  signedAt: z.string().min(10).max(64),
  attestationHex: z.string().min(32).max(128),
  biometricUsed: z.literal(false),
  location: locationSchema,
}) as unknown as z.ZodType<PinSignedAcknowledgement>;

const verifyAckSchema = z.object({
  acknowledgement: ackSchema,
});

router.post(
  '/:projectId/pin-sign/verify-acknowledgement',
  verifyAuth,
  validate(verifyAckSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof verifyAckSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const serverSecret = getServerSecret();
      const ok = verifyAcknowledgement(body.acknowledgement, serverSecret);
      return res.json({ ok });
    } catch (err) {
      const m = asEngineError(err);
      if (m) return res.status(m.code).json(m.body);
      logger.error?.('pinSign.verifyAcknowledgement.error', err);
      captureRouteError(err, 'pinSign.verifyAcknowledgement');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
