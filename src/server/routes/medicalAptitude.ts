// Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Certificate router.
//
// CRITICAL POLICY (read before editing):
//   * Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
//   * Endpoints below SOLO generan + firman biométricamente. No hay HTTP egress
//     a mutualidades, no hay validación contra base externa, no se bloquea
//     maquinaria.
//
// Surface (mounted at /api/medical):
//   POST /aptitude-cert/generate         — generate PDF + JSON + hash
//   POST /aptitude-cert/sign-challenge   — request server-bound challenge
//   POST /aptitude-cert/sign             — embed WebAuthn signature in JSON
//
// Role gate: doctor (medico_ocupacional) or admin/gerente.
// Audit rows:
//   medical.aptitude_cert.generated
//   medical.aptitude_cert.signed
// Sentry capture per stage so a generator/signer regression surfaces fast.

import { Router, type Request, type Response } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { isAdminRole, isDoctorRole } from '../../types/roles.js';
import {
  generateAptitudeCert,
  aptitudeCertInputSchema,
  type AptitudeCertJson,
} from '../../services/medical/aptitudeCertGenerator.js';
import {
  verifyAndSignCert,
  AptitudeCertSignError,
} from '../../services/medical/aptitudeCertSigner.js';
import { getWebauthnRpId, getWebauthnExpectedOrigin } from '../auth/rpId.js';

export const medicalAptitudeRouter = Router();

function captureStage(err: unknown, stage: string, req: Request): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      { endpoint: req.url, tags: { stage, route: 'medicalAptitude' } } as any,
    );
  } catch {
    /* observability MUST NEVER break the response path */
  }
}

async function resolveCallerRole(uid: string): Promise<string | undefined> {
  try {
    const rec = await admin.auth().getUser(uid);
    const role = rec.customClaims?.role;
    return typeof role === 'string' ? role : undefined;
  } catch (err) {
    // Fail-closed (undefined → 403) but NOT silent: a Firebase Admin outage
    // would otherwise invisibly block every doctor from signing/generating a
    // legal certificate. Surface it to logs + Sentry for on-call.
    logger.error('aptitude_resolve_role_failed', { uid, err: String(err) });
    getErrorTracker().captureException(err instanceof Error ? err : new Error(String(err)), {
      endpoint: 'medicalAptitude.resolveCallerRole',
    });
    return undefined;
  }
}

function isAllowedSignerRole(role: string | undefined): boolean {
  return isAdminRole(role) || isDoctorRole(role);
}

// â”€â”€â”€ POST /aptitude-cert/generate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

medicalAptitudeRouter.post(
  '/aptitude-cert/generate',
  verifyAuth,
  async (req: Request, res: Response) => {
    const callerUid = req.user?.uid as string | undefined;
    if (!callerUid) return res.status(401).json({ error: 'no_uid' });

    const role = await resolveCallerRole(callerUid);
    if (!isAllowedSignerRole(role)) {
      return res.status(403).json({ error: 'doctor_or_admin_required' });
    }

    // Zod validation surface — explicit so the route returns 400 with detail.
    const parsed = aptitudeCertInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'invalid_input', detail: parsed.error.issues[0]?.message ?? 'invalid' });
    }

    try {
      const result = await generateAptitudeCert(parsed.data);
      // P0 fix: audit emit is now awaited + Sentry-captured on failure.
      // Previously a Firestore outage would silently drop the row and the
      // medical-aptitude-cert generation event would not appear in
      // audit_logs at all — a compliance gap for the operational health
      // service. The cert itself is already persisted; we never block the
      // response, but we DO surface the gap so on-call sees it.
      try {
        await auditServerEvent(req, 'medical.aptitude_cert.generated', 'medical', {
          certId: result.certId,
          certHash: result.certHash,
          workerUid: result.json.worker.uid,
          doctorUid: result.json.doctor.uid,
          projectId: result.json.employer.projectId,
          fitness: result.json.verdict.fitness,
        });
      } catch (auditErr) {
        logger.error('audit_event_failed', {
          event: 'medical.aptitude_cert.generated',
          certId: result.certId,
          err: String(auditErr),
        });
        captureStage(auditErr, 'audit_generate', req);
      }
      return res.json({
        certId: result.certId,
        certHash: result.certHash,
        json: result.json,
        pdfBase64: result.pdf.toString('base64'),
      });
    } catch (err) {
      logger.error('aptitude_cert_generate_failed', { err: String(err) });
      captureStage(err, 'generate', req);
      return res.status(500).json({ error: 'aptitude_cert_generate_failed' });
    }
  },
);

// â”€â”€â”€ POST /aptitude-cert/sign-challenge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// F4 (2026-06-16): issue a single-use, server-stored WebAuthn challenge
// (mirrors dte/suseso /sign-challenge). Random + consumed atomically by the
// canonical verifier at /sign — replay defense lives there. GET so the shared
// client helper `requestComplianceSignature` can drive it.
medicalAptitudeRouter.get(
  '/aptitude-cert/sign-challenge',
  verifyAuth,
  async (req: Request, res: Response) => {
    const callerUid = req.user?.uid as string | undefined;
    if (!callerUid) return res.status(401).json({ error: 'no_uid' });

    const role = await resolveCallerRole(callerUid);
    if (!isAllowedSignerRole(role)) {
      return res.status(403).json({ error: 'doctor_or_admin_required' });
    }

    try {
      const { generateWebAuthnChallenge, storeWebAuthnChallenge } = await import(
        '../../services/auth/webauthnChallenge.js'
      );
      const { buildWebAuthnDb } = await import('./curriculum.js');
      const { challengeId, challenge } = generateWebAuthnChallenge();
      await storeWebAuthnChallenge(callerUid, challengeId, challenge, buildWebAuthnDb());
      return res.json({ challengeId, challenge });
    } catch (err) {
      logger.error('aptitude_cert_sign_challenge_failed', { err: String(err) });
      captureStage(err, 'sign_challenge', req);
      return res.status(500).json({ error: 'sign_challenge_failed' });
    }
  },
);

// â”€â”€â”€ POST /aptitude-cert/sign â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const webauthnAssertionSchema = z.object({
  credentialId: z.string().min(1).max(512),
  rawId: z.string().min(1).max(512),
  clientDataJSON: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1).max(8192),
  challengeId: z.string().min(1).max(256),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});

const signRequestSchema = z.object({
  cert: z
    .object({
      certId: z.string(),
      doctor: z.object({ uid: z.string() }).passthrough(),
    })
    .passthrough(),
  certHash: z.string().regex(/^[0-9a-f]{64}$/),
  signerRut: z.string().min(1).max(20),
  // signedAt is NOT accepted from the client — a legal cert's timestamp must be
  // the server-verified moment of signing (stamped in the handler below).
  webauthnAssertion: webauthnAssertionSchema,
});

medicalAptitudeRouter.post(
  '/aptitude-cert/sign',
  verifyAuth,
  async (req: Request, res: Response) => {
    const callerUid = req.user?.uid as string | undefined;
    if (!callerUid) return res.status(401).json({ error: 'no_uid' });

    const role = await resolveCallerRole(callerUid);
    if (!isAllowedSignerRole(role)) {
      return res.status(403).json({ error: 'doctor_or_admin_required' });
    }

    const parsed = signRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    const { cert, certHash, signerRut, webauthnAssertion: asrt } = parsed.data;
    // Server-stamped signing moment (never the client body).
    const signedAt = new Date().toISOString();

    try {
      const signed = await verifyAndSignCert(
        cert as unknown as AptitudeCertJson,
        { certHash, challengeId: asrt.challengeId, signerRut, signedAt, signatureB64: asrt.signature },
        {
          caller: { uid: callerUid, role },
          // Canonical verifier (same one DTE/SUSESO/DS76 use): consumes the
          // single-use challenge, looks the credential up by id in the doctor's
          // REGISTERED credentials, verifies the signature against THAT key, and
          // checks origin/RPID/counter. Lazy-imported (dte.ts pattern). Invoked
          // by the signer only AFTER its role/uid/hash gates pass, so a rejected
          // request never burns the challenge.
          verifyAssertion: async () => {
            const { verifyWebAuthnAssertion } = await import('../auth/webauthnAssertion.js');
            const { buildWebAuthnDb, buildWebAuthnCredentialsDb } = await import('./curriculum.js');
            const v = await verifyWebAuthnAssertion({
              uid: callerUid,
              credentialId: asrt.credentialId,
              rawId: asrt.rawId,
              clientDataJSON: asrt.clientDataJSON,
              authenticatorData: asrt.authenticatorData,
              signature: asrt.signature,
              clientExtensionResults: asrt.clientExtensionResults,
              type: asrt.type,
              challengeId: asrt.challengeId,
              expectedOrigin: getWebauthnExpectedOrigin(),
              expectedRpId: getWebauthnRpId(),
              challengesDb: buildWebAuthnDb(),
              credentialsDb: buildWebAuthnCredentialsDb(),
            });
            return { verified: v.verified, credentialId: v.verifiedCredentialId, reason: v.reason };
          },
        },
      );
      // Audit must surface failures to Sentry (compliance gap), never silent.
      try {
        await auditServerEvent(req, 'medical.aptitude_cert.signed', 'medical', {
          certId: signed.json.certId,
          certHash: signed.certHash,
          signerUid: signed.json.signature.signerUid,
          credentialId: signed.json.signature.credentialId,
        });
      } catch (auditErr) {
        logger.error('audit_event_failed', {
          event: 'medical.aptitude_cert.signed',
          certId: signed.json.certId,
          err: String(auditErr),
        });
        captureStage(auditErr, 'audit_sign', req);
      }
      return res.json({
        certId: signed.json.certId,
        certHash: signed.certHash,
        json: signed.json,
        signedAt: signed.json.signature.signedAt,
      });
    } catch (err) {
      if (err instanceof AptitudeCertSignError) {
        logger.warn('aptitude_cert_sign_rejected', { code: err.code });
        const status =
          err.code === 'doctor_role_required' || err.code === 'doctor_uid_mismatch'
            ? 403
            : err.code === 'signature_invalid'
              ? 401
              : 400;
        return res.status(status).json({ error: err.code });
      }
      logger.error('aptitude_cert_sign_failed', { err: String(err) });
      captureStage(err, 'sign', req);
      return res.status(500).json({ error: 'aptitude_cert_sign_failed' });
    }
  },
);

export default medicalAptitudeRouter;
