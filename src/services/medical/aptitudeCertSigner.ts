// Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Certificate signer.
//
// CRITICAL POLICY (read before editing):
//   * Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
//   * MUTUAL/ACHS/IST pueden o no aceptar este modelo de firma electrónica
//     (huella biométrica WebAuthn passkey ligada al login Google del médico).
//     La empresa cliente puede usar este artefacto como evidencia interna
//     verificable + acompañar con firma manual del médico si la mutualidad
//     lo exige separadamente.
//   * Replica el patrón Sprint 34 / Sprint 31 ds67Service.signForm: challenge
//     server-issued ligado al hash, single-use, embebe { signerUid, signerRut,
//     algorithm, signatureB64, payloadHashHex, attestedAt } dentro del JSON
//     del certificado.
//
// Diseño: este module es PURO (no toca firebase-admin). El router le inyecta
// las dependencias (verifyChallenge, persistSignedCert) para que tests
// unitarios funcionen sin GCP.

import { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { AptitudeCertJson } from './aptitudeCertGenerator.js';
import { hashAptitudeCertJson } from './aptitudeCertGenerator.js';

// ─── Schema for the WebAuthn assertion bundle ───────────────────────────────

export const signCertRequestSchema = z.object({
  certHash: z.string().regex(/^[0-9a-f]{64}$/, 'invalid_cert_hash'),
  challengeId: z.string().min(1).max(256),
  signature: z.object({
    signerUid: z.string().min(1).max(128),
    signerRut: z.string().min(1).max(20),
    signedAt: z.string().min(1),
    algorithm: z.literal('webauthn-ecdsa-p256'),
    /** base64-encoded WebAuthn assertion signature. */
    signatureB64: z.string().min(1).max(8192),
    /** base64-encoded credential public key (CBOR/COSE). */
    credentialPublicKeyB64: z.string().min(1).max(2048),
    /** SHA-256 of the JSON the user actually saw — must equal certHash. */
    payloadHashHex: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});

export type SignCertRequest = z.infer<typeof signCertRequestSchema>;

export interface AptitudeCertSignature {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256';
  signatureB64: string;
  credentialPublicKeyB64: string;
  payloadHashHex: string;
  challengeId: string;
}

export interface SignedAptitudeCert {
  json: AptitudeCertJson & { signature: AptitudeCertSignature };
  certHash: string;
}

// ─── Challenge construction ─────────────────────────────────────────────────

/**
 * Build a server challenge bound to the certificate hash. The bytes the
 * client must sign are the SHA-256 of `(domain || ":" || certHash)` so
 * a captured WebAuthn assertion for one cert cannot be replayed against
 * another.
 *
 * The challenge is independent from the WebAuthn challenge (which still
 * lives in `webauthnChallenge.ts` and provides single-use replay defense):
 * here we only ensure the *content* of what was signed is the cert hash.
 */
export function buildSignChallenge(certHash: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(certHash)) {
    throw new Error('invalid_cert_hash');
  }
  const domain = 'praeventio.aptitude-cert.v1';
  return sha256(new TextEncoder().encode(`${domain}:${certHash}`));
}

export function buildSignChallengeHex(certHash: string): string {
  return bytesToHex(buildSignChallenge(certHash));
}

// ─── Verification ───────────────────────────────────────────────────────────

export class AptitudeCertSignError extends Error {
  readonly code:
    | 'invalid_request'
    | 'cert_hash_mismatch'
    | 'doctor_role_required'
    | 'doctor_uid_mismatch'
    | 'challenge_failed'
    | 'signature_invalid';
  constructor(code: AptitudeCertSignError['code'], message?: string) {
    super(message ?? code);
    this.name = 'AptitudeCertSignError';
    this.code = code;
  }
}

export interface VerifyAndSignDeps {
  /** Caller's verified identity (from verifyAuth). */
  caller: { uid: string; role: string | undefined };
  /**
   * Single-use challenge consume (e.g. webauthnChallenge.consumeWebAuthnChallenge).
   * Must atomically mark the challenge consumed; returning true => valid + consumed.
   */
  consumeChallenge: (challengeId: string, expectedBytes: Uint8Array) => Promise<boolean>;
  /**
   * WebAuthn assertion verifier — adapter around @simplewebauthn/server or a
   * test fake. Must verify that signatureB64 was produced by the
   * credentialPublicKeyB64 over `challengeBytes`.
   */
  verifyWebAuthnAssertion: (args: {
    signatureB64: string;
    credentialPublicKeyB64: string;
    challengeBytes: Uint8Array;
  }) => Promise<boolean>;
}

const ALLOWED_DOCTOR_ROLES = new Set(['admin', 'gerente', 'medico_ocupacional']);

/**
 * Validate a sign-cert request, verify the WebAuthn assertion is over the
 * cert hash, and embed the signature into the JSON. The caller MUST be a
 * doctor (role 'medico_ocupacional') or admin.
 *
 * Hash binding: rejects when payloadHashHex !== certHash !== sha256(json).
 * Doctor binding: rejects when caller.uid !== json.doctor.uid (a doctor
 * cannot sign someone else's cert).
 */
export async function verifyAndSignCert(
  cert: AptitudeCertJson,
  rawRequest: unknown,
  deps: VerifyAndSignDeps,
): Promise<SignedAptitudeCert> {
  let request: SignCertRequest;
  try {
    request = signCertRequestSchema.parse(rawRequest);
  } catch {
    throw new AptitudeCertSignError('invalid_request');
  }

  // Role gate.
  if (!deps.caller.role || !ALLOWED_DOCTOR_ROLES.has(deps.caller.role)) {
    throw new AptitudeCertSignError('doctor_role_required');
  }

  // Doctor uid binding: the caller must match the doctor on the cert.
  // Admins bypass this for emergency re-signs (audit row records the override).
  if (deps.caller.role === 'medico_ocupacional' && deps.caller.uid !== cert.doctor.uid) {
    throw new AptitudeCertSignError('doctor_uid_mismatch');
  }

  // Hash binding: recompute and compare. Three-way match.
  const expectedHash = hashAptitudeCertJson(cert);
  if (request.certHash !== expectedHash) {
    throw new AptitudeCertSignError('cert_hash_mismatch');
  }
  if (request.signature.payloadHashHex !== expectedHash) {
    throw new AptitudeCertSignError('cert_hash_mismatch');
  }

  // Challenge consume (single-use). The server-issued challenge bytes are
  // sha256(domain : certHash) — see buildSignChallenge above.
  const challengeBytes = buildSignChallenge(expectedHash);
  const ok = await deps.consumeChallenge(request.challengeId, challengeBytes);
  if (!ok) {
    throw new AptitudeCertSignError('challenge_failed');
  }

  const sigOk = await deps.verifyWebAuthnAssertion({
    signatureB64: request.signature.signatureB64,
    credentialPublicKeyB64: request.signature.credentialPublicKeyB64,
    challengeBytes,
  });
  if (!sigOk) {
    throw new AptitudeCertSignError('signature_invalid');
  }

  const sig: AptitudeCertSignature = {
    signerUid: request.signature.signerUid,
    signerRut: request.signature.signerRut,
    signedAt: request.signature.signedAt,
    algorithm: request.signature.algorithm,
    signatureB64: request.signature.signatureB64,
    credentialPublicKeyB64: request.signature.credentialPublicKeyB64,
    payloadHashHex: request.signature.payloadHashHex,
    challengeId: request.challengeId,
  };

  return {
    json: { ...cert, signature: sig },
    certHash: expectedHash,
  };
}
