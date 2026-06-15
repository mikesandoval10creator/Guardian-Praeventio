// Praeventio Guard — account self-service: cascarón soft-delete (block 3a).
//
// POST /api/account/anonymize — the IRREVERSIBLE "cascarón" de-identification,
// 2FA-gated by a fresh WebAuthn assertion (the huella = universal signature,
// per the product directive). Because this scrubs ALL of the caller's PII to an
// anonymous shell and DISABLES the account with no undo, it demands a
// cryptographic re-authentication BEFORE any destructive work — exactly the
// canonical verifier the SUSESO / DTE / SiteBook / DS76 signing paths use.
//
// Flow (fail-closed at every step):
//   1. verifyAuth → uid from the verified token (we anonymize ONLY the caller).
//   2. Verify the WebAuthn assertion via `verifyWebAuthnAssertion` (single-use
//      challenge consume + COSE-pubkey signature + origin/RPID binding +
//      monotonic counter). On any failure → 401, audited, NO scrub.
//   3. Export-before-delete (Ley 21.719 portability): snapshot users/{uid},
//      canonical-serialize, SHA-256 checksum. Returned to the client for
//      download + recorded as the immutable proof.
//   4. Audit `account.anonymization_initiated` BEFORE the scrub (intent
//      survives a mid-scrub failure).
//   5. `anonymizeUser(...)` — the irreversible scrub (auth + Firestore + posts).
//   6. Audit `account.anonymization_completed`.
//
// Identity ALWAYS from the token; nothing here trusts a client-supplied uid.

import { Router } from 'express';
import admin from 'firebase-admin';
import crypto from 'node:crypto';

import { verifyAuth } from '../middleware/verifyAuth.js';
import { webauthnVerifyLimiter } from '../middleware/limiters.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { getWebauthnRpId } from '../auth/rpId.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { anonymizeUser } from '../services/anonymizeUser.js';

export const accountRouter = Router();

/** Deterministic JSON (recursively sorted keys) so the export checksum is stable. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (v as Record<string, unknown>)[k];
            return acc;
          }, {})
      : v,
  );
}

function internalError(err: unknown): string {
  return process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err instanceof Error
      ? err.message
      : String(err);
}

// POST /api/account/anonymize — 2FA-gated irreversible cascarón soft-delete.
accountRouter.post('/anonymize', verifyAuth, webauthnVerifyLimiter, async (req, res) => {
  const uid = req.user!.uid;
  const biometric = (req.body as { biometric?: Record<string, unknown> } | undefined)?.biometric;
  if (!biometric || typeof biometric !== 'object') {
    return res.status(400).json({ error: 'biometric assertion is required' });
  }

  // ── 1. 2FA: verify the WebAuthn assertion BEFORE any destructive work ──────
  try {
    const { verifyWebAuthnAssertion } = await import('../auth/webauthnAssertion.js');
    const { buildWebAuthnDb, buildWebAuthnCredentialsDb } = await import('./curriculum.js');
    const verdict = await verifyWebAuthnAssertion({
      uid,
      credentialId: String(biometric.credentialId ?? ''),
      rawId: String(biometric.rawId ?? ''),
      clientDataJSON: String(biometric.clientDataJSON ?? ''),
      authenticatorData: String(biometric.authenticatorData ?? ''),
      signature: String(biometric.signature ?? ''),
      clientExtensionResults: (biometric.clientExtensionResults ?? {}) as Record<string, unknown>,
      type: String(biometric.type ?? ''),
      challengeId: String(biometric.challengeId ?? ''),
      expectedOrigin: process.env.APP_BASE_URL ?? 'http://localhost:5173',
      expectedRpId: getWebauthnRpId(),
      challengesDb: buildWebAuthnDb(),
      credentialsDb: buildWebAuthnCredentialsDb(),
    });
    if (!verdict.verified) {
      logger.warn('account.anonymize webauthn verification failed', { uid, reason: verdict.reason });
      // Audit the rejected attempt (Regla #14: awaited, non-throwing). Only the
      // public credentialId + typed reason — never the assertion bytes.
      try {
        await auditServerEvent(req, 'account.anonymize_2fa_failed', 'account', {
          reason: verdict.reason ?? 'signature_invalid',
        });
      } catch (auditErr) {
        logger.error('audit_event_failed', auditErr as Error, { action: 'account.anonymize_2fa_failed' });
        captureRouteError(auditErr, 'account.anonymize.audit_2fa_failed', { uid });
      }
      return res.status(401).json({ error: 'webauthn_verification_failed', reason: verdict.reason });
    }
  } catch (verifyErr) {
    logger.error('account.anonymize webauthn verify threw', verifyErr as Error, { uid });
    captureRouteError(verifyErr, 'account.anonymize.webauthn', { uid });
    return res.status(401).json({ error: 'webauthn_verification_failed' });
  }

  const db = admin.firestore();

  // ── 2. Export-before-delete (Ley 21.719 portability) + checksum proof ──────
  let dataExport: string;
  let dataExportChecksum: string;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const exportObj = {
      schemaVersion: '1.0.0',
      uid,
      exportedAt: new Date().toISOString(),
      user: snap.exists ? snap.data() ?? {} : {},
    };
    dataExport = canonicalJson(exportObj);
    dataExportChecksum = crypto.createHash('sha256').update(dataExport, 'utf8').digest('hex');
  } catch (exportErr) {
    logger.error('account.anonymize export failed', exportErr as Error, { uid });
    captureRouteError(exportErr, 'account.anonymize.export', { uid });
    return res.status(500).json({ error: internalError(exportErr) });
  }

  // ── 3. Audit INTENT before the irreversible scrub ─────────────────────────
  try {
    await auditServerEvent(req, 'account.anonymization_initiated', 'account', { dataExportChecksum });
  } catch (auditErr) {
    logger.error('audit_event_failed', auditErr as Error, { action: 'account.anonymization_initiated' });
    captureRouteError(auditErr, 'account.anonymize.audit_init', { uid });
  }

  // ── 4. The irreversible scrub ─────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof anonymizeUser>>;
  try {
    result = await anonymizeUser({ authAdmin: admin.auth, db }, { uid, dataExportChecksum });
  } catch (scrubErr) {
    logger.error('account.anonymize scrub failed', scrubErr as Error, { uid });
    captureRouteError(scrubErr, 'account.anonymize.scrub', { uid });
    return res.status(500).json({ error: internalError(scrubErr) });
  }

  // ── 5. Audit completion (non-blocking) ────────────────────────────────────
  try {
    await auditServerEvent(req, 'account.anonymization_completed', 'account', {
      dataExportChecksum,
      fieldsRedacted: result.fieldsRedacted,
      safetyPostsRedacted: result.safetyPostsRedacted,
    });
  } catch (auditErr) {
    logger.error('audit_event_failed', auditErr as Error, { action: 'account.anonymization_completed' });
    captureRouteError(auditErr, 'account.anonymize.audit_done', { uid });
  }

  return res.status(200).json({
    success: true,
    anonymizedAt: result.anonymizedAt,
    dataExportChecksum,
    // The user's data, for download (Ley 21.719 right to portability).
    dataExport,
  });
});

export default accountRouter;
