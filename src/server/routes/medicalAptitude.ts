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
  buildSignChallengeHex,
  verifyAndSignCert,
  AptitudeCertSignError,
} from '../../services/medical/aptitudeCertSigner.js';

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
  } catch {
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
      try {
        void auditServerEvent(req, 'medical.aptitude_cert.generated', 'medical', {
          certId: result.certId,
          certHash: result.certHash,
          workerUid: result.json.worker.uid,
          doctorUid: result.json.doctor.uid,
          projectId: result.json.employer.projectId,
          fitness: result.json.verdict.fitness,
        });
      } catch {
        /* audit failure never breaks the response */
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

const challengeSchema = z.object({
  certHash: z.string().regex(/^[0-9a-f]{64}$/),
});

medicalAptitudeRouter.post(
  '/aptitude-cert/sign-challenge',
  verifyAuth,
  async (req: Request, res: Response) => {
    const callerUid = req.user?.uid as string | undefined;
    if (!callerUid) return res.status(401).json({ error: 'no_uid' });

    const role = await resolveCallerRole(callerUid);
    if (!isAllowedSignerRole(role)) {
      return res.status(403).json({ error: 'doctor_or_admin_required' });
    }

    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    return res.json({ challengeHex: buildSignChallengeHex(parsed.data.certHash) });
  },
);

// â”€â”€â”€ POST /aptitude-cert/sign â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const signRequestSchema = z.object({
  cert: z
    .object({
      certId: z.string(),
      doctor: z.object({ uid: z.string() }),
    })
    .passthrough(),
  certHash: z.string().regex(/^[0-9a-f]{64}$/),
  challengeId: z.string(),
  signature: z
    .object({
      signerUid: z.string(),
      signerRut: z.string(),
      signedAt: z.string(),
      algorithm: z.literal('webauthn-ecdsa-p256'),
      signatureB64: z.string(),
      credentialPublicKeyB64: z.string(),
      payloadHashHex: z.string(),
    })
    .passthrough(),
});

/**
 * Wire the signer to firestore-backed challenge consume + a real WebAuthn
 * verifier. In dev/test these are injected via the exported factory below;
 * production wires admin.firestore() and @simplewebauthn/server.
 */
export interface MedicalAptitudeSignerDeps {
  consumeChallenge: (
    uid: string,
    challengeId: string,
    expectedBytes: Uint8Array,
  ) => Promise<boolean>;
  verifyWebAuthnAssertion: (args: {
    signatureB64: string;
    credentialPublicKeyB64: string;
    challengeBytes: Uint8Array;
  }) => Promise<boolean>;
}

let injectedSignerDeps: MedicalAptitudeSignerDeps | null = null;
export function setMedicalAptitudeSignerDeps(deps: MedicalAptitudeSignerDeps | null): void {
  injectedSignerDeps = deps;
}

async function defaultConsumeChallenge(): Promise<boolean> {
  // Production wiring lands when WebAuthn verifier ships. Until then the
  // signer endpoint is gated behind a 503 unless the host injected deps.
  return false;
}
async function defaultVerifyAssertion(): Promise<boolean> {
  return false;
}

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

    const deps = injectedSignerDeps;
    if (!deps) {
      return res.status(503).json({ error: 'signer_not_configured' });
    }

    try {
      const signed = await verifyAndSignCert(
        parsed.data.cert as unknown as AptitudeCertJson,
        {
          certHash: parsed.data.certHash,
          challengeId: parsed.data.challengeId,
          signature: parsed.data.signature,
        },
        {
          caller: { uid: callerUid, role },
          consumeChallenge: (cid, bytes) => deps.consumeChallenge(callerUid, cid, bytes),
          verifyWebAuthnAssertion: deps.verifyWebAuthnAssertion,
        },
      );
      try {
        void auditServerEvent(req, 'medical.aptitude_cert.signed', 'medical', {
          certId: signed.json.certId,
          certHash: signed.certHash,
          signerUid: signed.json.signature.signerUid,
        });
      } catch {
        /* never break */
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
          err.code === 'doctor_role_required' || err.code === 'doctor_uid_mismatch' ? 403 : 400;
        return res.status(status).json({ error: err.code });
      }
      logger.error('aptitude_cert_sign_failed', { err: String(err) });
      captureStage(err, 'sign', req);
      return res.status(500).json({ error: 'aptitude_cert_sign_failed' });
    }
  },
);

export default medicalAptitudeRouter;
