// Praeventio Guard — QR Acknowledgement Sessions HTTP surface.
//
// Sprint 43 Fase F.5 — two stateful endpoints over the engine under
// `src/services/qrAck/qrAckSessionEngine.ts` plus HMAC signer/verifier
// and Firestore-backed replay protection:
//
//   POST /:projectId/qr-ack/create-session
//     body: { itemKind, itemId, itemLabel, ttlSeconds? }
//     200:  { session: AckSession }
//
//   POST /:projectId/qr-ack/validate-scan
//     body: { qrPayload, signature, consent, biometricUsed, scannedAtLocation? }
//     200:  { result: ScanResult }
//     400:  { result: ScanResult } (engine refused — bad payload / signature /
//            expired / no_consent / replay / creator_cannot_self_sign)
//
// HMAC secret comes from `QR_ACK_HMAC_SECRET` env var. Replay protection
// uses a Firestore collection `qr_ack_used_scans` keyed by
// `${sessionId}|${workerUid}` and stored under a Firestore transaction so
// double-spend races are impossible.
//
// Server-side identity overrides:
//   - createdByUid (session creator) forced from the authenticated caller.
//   - scannedByUid (worker firmando) forced from the authenticated caller.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  createAckSession,
  validateAckScan,
  replayKey,
  QrAckValidationError,
  type AckSessionInput,
  type AckScanRequest,
  type AckItemKind,
  type Signer,
  type Verifier,
  type ScanResult,
} from '../../services/qrAck/qrAckSessionEngine.js';

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

function getHmacSecret(): string | null {
  const secret = process.env.QR_ACK_HMAC_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

function buildSigner(secret: string): Signer {
  return (payload) => createHmac('sha256', secret).update(payload).digest('hex');
}

function buildVerifier(secret: string): Verifier {
  return (payload, signature) => {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    if (signature.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  };
}

const ACK_ITEM_KINDS: readonly AckItemKind[] = ['epp', 'training', 'talk', 'document', 'protocol'];

// ────────────────────────────────────────────────────────────────────────
// 1. create-session
// ────────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  itemKind: z.enum(ACK_ITEM_KINDS as readonly [AckItemKind, ...AckItemKind[]]),
  itemId: z.string().min(1).max(200),
  itemLabel: z.string().min(1).max(500),
  ttlSeconds: z.number().int().min(60).max(1800).optional(),
});

router.post(
  '/:projectId/qr-ack/create-session',
  verifyAuth,
  validate(createSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const secret = getHmacSecret();
    if (!secret) {
      logger.error?.('qrAck.createSession.error', 'QR_ACK_HMAC_SECRET not configured');
      return res.status(503).json({ error: 'qr_ack_not_configured' });
    }
    try {
      const input: AckSessionInput = {
        projectId,
        createdByUid: callerUid,
        itemKind: body.itemKind,
        itemId: body.itemId,
        itemLabel: body.itemLabel,
        ttlSeconds: body.ttlSeconds,
      };
      const session = createAckSession(input, buildSigner(secret));
      return res.json({ session });
    } catch (err) {
      if (err instanceof QrAckValidationError) {
        return res.status(400).json({ error: 'validation_error', code: err.code, message: err.message });
      }
      logger.error?.('qrAck.createSession.error', err);
      captureRouteError(err, 'qrAck.createSession');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. validate-scan — Firestore-backed replay protection
// ────────────────────────────────────────────────────────────────────────

const scanSchema = z.object({
  qrPayload: z.string().min(1).max(8000),
  signature: z.string().min(1).max(200),
  consent: z.boolean(),
  biometricUsed: z.boolean(),
  scannedAtLocation: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
});

interface UsedScanRecord {
  sessionId: string;
  workerUid: string;
  projectId: string;
  signedAt: string;
  /** Firestore TTL field (7 days after sign). */
  ttlAt: admin.firestore.Timestamp;
}

const USED_SCANS_COLLECTION = 'qr_ack_used_scans';

router.post(
  '/:projectId/qr-ack/validate-scan',
  verifyAuth,
  validate(scanSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof scanSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const secret = getHmacSecret();
    if (!secret) {
      logger.error?.('qrAck.validateScan.error', 'QR_ACK_HMAC_SECRET not configured');
      return res.status(503).json({ error: 'qr_ack_not_configured' });
    }
    const verifier = buildVerifier(secret);
    const firestore = admin.firestore();

    const scanRequest: AckScanRequest = {
      qrPayload: body.qrPayload,
      signature: body.signature,
      scannedByUid: callerUid,
      consent: body.consent,
      biometricUsed: body.biometricUsed,
      scannedAtLocation: body.scannedAtLocation,
    };

    // First pass with empty usedScans to extract sessionId from payload.
    // If anything is wrong with the payload itself (bad_payload, bad_signature,
    // expired, no_consent, creator_cannot_self_sign), return 400 without
    // touching Firestore.
    const probe = validateAckScan(scanRequest, verifier, { usedScans: new Set() });
    if (!probe.ok) {
      return res.status(400).json({ result: probe });
    }

    const sessionId = probe.inner.sid;
    const key = replayKey(sessionId, callerUid);
    const docRef = firestore.collection(USED_SCANS_COLLECTION).doc(key);

    try {
      const result = await firestore.runTransaction<ScanResult>(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          return {
            ok: false,
            code: 'replay',
            detail: `worker ${callerUid} ya firmó la sesión ${sessionId}`,
          };
        }
        // Re-run validation under the transaction with the same empty set —
        // the transaction itself is the replay defense.
        const txResult = validateAckScan(scanRequest, verifier, { usedScans: new Set() });
        if (!txResult.ok) {
          return txResult;
        }
        const ttlAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + 7 * 24 * 3_600_000,
        );
        const record: UsedScanRecord = {
          sessionId,
          workerUid: callerUid,
          projectId,
          signedAt: txResult.ack.signedAt,
          ttlAt,
        };
        tx.set(docRef, record);
        return txResult;
      });
      if (!result.ok) {
        return res.status(400).json({ result });
      }
      return res.json({ result });
    } catch (err) {
      logger.error?.('qrAck.validateScan.error', err);
      captureRouteError(err, 'qrAck.validateScan');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
