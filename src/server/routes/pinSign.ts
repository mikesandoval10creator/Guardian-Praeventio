// Praeventio Guard — PIN Sign HTTP surface (F.25 fallback sin biometría).
//
// Sprint K reformulado §F.25 — endpoints over
// `src/services/pinSign/pinSignService.ts`.
//
//   POST /:projectId/pin-sign/register     (workerUid forced from caller)
//   POST /:projectId/pin-sign/verify       (workerUid forced)
//   POST /:projectId/pin-sign/sign-item    (verify + build ack en una llamada)
//   POST /:projectId/pin-sign/validate-policy
//   POST /:projectId/pin-sign/verify-acknowledgement
//
// SECURITY (B17, Fase 5): la credencial PIN (salt + PBKDF2 hash + contador
// de fallos + lockout) se persiste **server-side** en la colección top-level
// `pin_credentials/{projectId}__{workerUid}` (Admin SDK, server-only —
// default-deny para clientes; el hash NUNCA cruza al cliente). Antes el
// surface era "stateless" y recibía la `PinCredential` COMPLETA en el body,
// lo que permitía dos ataques triviales: (a) un atacante fabricaba una
// credencial cuyo hash correspondía a un PIN elegido por él y "verificaba"
// con éxito; (b) reseteaba `consecutiveFailures: 0` en cada intento,
// anulando el lockout anti-fuerza-bruta. Ahora `verify`/`sign-item` LEEN la
// credencial desde Firestore (404 si no está registrada) y escriben el
// contador de vuelta dentro de una transacción.
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
import { auditServerEvent } from '../middleware/auditLog.js';
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

// ── Server-side credential persistence (B17) ───────────────────────────────
// TOP-LEVEL collection `pin_credentials/{projectId}__{workerUid}` (server-only
// via the Admin SDK). It is deliberately NOT a `projects/{id}/...`
// subcollection: the firestore.rules master-gate
// (`projects/{projectId}/{subCollection=**}/{docId}` → read for members) would
// otherwise expose the PBKDF2 hash to every project member (Firestore rules are
// OR-combined, so a narrower deny can't revoke that grant). A top-level
// collection with no client rule is default-denied — the hash never leaves the
// server. Mirrors the `webauthn_credentials` design.
function pinCredentialDocId(projectId: string, workerUid: string): string {
  return `${projectId}__${workerUid}`;
}

function pinCredentialRef(projectId: string, workerUid: string) {
  return admin
    .firestore()
    .collection('pin_credentials')
    .doc(pinCredentialDocId(projectId, workerUid));
}

/**
 * Firestore rejects `undefined` fields. `verifyPin` clears `lockedUntil` to
 * `undefined` on success, so we omit the key entirely when absent (the doc is
 * written with `set`, which replaces — dropping any prior lockout).
 */
function credentialToDoc(c: PinCredential): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    workerUid: c.workerUid,
    saltHex: c.saltHex,
    hashHex: c.hashHex,
    iterations: c.iterations,
    createdAt: c.createdAt,
    consecutiveFailures: c.consecutiveFailures,
  };
  if (c.lockedUntil) doc.lockedUntil = c.lockedUntil;
  return doc;
}

function docToCredential(data: Record<string, unknown>): PinCredential {
  return {
    workerUid: String(data.workerUid ?? ''),
    saltHex: String(data.saltHex ?? ''),
    hashHex: String(data.hashHex ?? ''),
    iterations: Number(data.iterations ?? 0),
    createdAt: String(data.createdAt ?? ''),
    consecutiveFailures: Number(data.consecutiveFailures ?? 0),
    ...(typeof data.lockedUntil === 'string' ? { lockedUntil: data.lockedUntil } : {}),
  };
}

/**
 * Read the caller's stored credential, run `verifyPin`, and persist the updated
 * lockout counters back — all in one transaction so concurrent brute-force
 * attempts can't race the failure counter. Returns `null` when no credential is
 * registered (caller maps to 404).
 */
async function verifyAndPersist(
  projectId: string,
  workerUid: string,
  pin: string,
): Promise<ReturnType<typeof verifyPin> | null> {
  const ref = pinCredentialRef(projectId, workerUid);
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const credential = docToCredential(snap.data() as Record<string, unknown>);
    const outcome = verifyPin({ credential, pin });
    tx.set(ref, credentialToDoc(outcome.credential));
    return outcome;
  });
}

async function safeAudit(
  req: import('express').Request,
  action: string,
  details: Record<string, unknown>,
  projectId: string,
): Promise<void> {
  try {
    await auditServerEvent(req, action, 'pinSign', details, { projectId });
  } catch (err) {
    logger.error?.('pinSign.audit.error', err);
    captureRouteError(err, 'pinSign.audit');
  }
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
      // Persist server-side — the hash/salt live ONLY in Firestore, never
      // round-tripped through the client.
      await pinCredentialRef(projectId, callerUid).set(credentialToDoc(credential));
      await safeAudit(req, 'pinSign.register', { projectId, workerUid: callerUid }, projectId);
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
    try {
      // Read the caller's OWN stored credential (never client-supplied) and
      // persist the updated lockout counter in one transaction.
      const outcome = await verifyAndPersist(projectId, callerUid, body.pin);
      if (outcome === null) {
        return res.status(404).json({ error: 'not_registered' });
      }
      return res.json({
        ok: outcome.ok,
        justLockedOut: outcome.justLockedOut,
        remainingLockoutMinutes: outcome.remainingLockoutMinutes,
        // NOTE: the credential (hash/salt/counters) is NOT returned — it lives
        // server-side only.
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
    try {
      // Resolve the server-side secret BEFORE mutating the failure counter so a
      // misconfigured server doesn't burn an attempt (still 500, no state change).
      const serverSecret = getServerSecret();
      const outcome = await verifyAndPersist(projectId, callerUid, body.pin);
      if (outcome === null) {
        return res.status(404).json({ error: 'not_registered' });
      }
      if (!outcome.ok) {
        return res.status(401).json({
          ok: false,
          justLockedOut: outcome.justLockedOut,
          remainingLockoutMinutes: outcome.remainingLockoutMinutes,
        });
      }
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
      await safeAudit(
        req,
        'pinSign.signItem',
        { projectId, workerUid: callerUid, itemId: body.itemId, kind: body.kind },
        projectId,
      );
      return res.json({
        ok: true,
        acknowledgement,
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
