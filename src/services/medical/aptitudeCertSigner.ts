// Praeventio Guard — Sprint 35 Bucket — Medical Aptitude Certificate signer.
//
// CRITICAL POLICY (read before editing):
//   * Praeventio NO push a MUTUAL/SUSESO/IST. Empresa cliente entrega por su canal.
//   * MUTUAL/ACHS/IST pueden o no aceptar este modelo de firma electrónica
//     (huella biométrica WebAuthn passkey ligada al login Google del médico).
//     La empresa cliente puede usar este artefacto como evidencia interna
//     verificable + acompañar con firma manual del médico si la mutualidad
//     lo exige separadamente.
//
// SECURITY MODEL (F4, 2026-06-16 — hardened to the canonical pattern):
//   The WebAuthn assertion is verified by the CANONICAL server verifier
//   (`src/server/auth/webauthnAssertion.ts`), which looks the credential up by
//   id in the doctor's REGISTERED credentials, verifies the signature against
//   that REGISTERED public key, consumes the single-use server-issued challenge,
//   and checks counter monotonicity + origin/RPID. This module NEVER trusts a
//   client-supplied public key (the prior bespoke shape did — that accepted any
//   keypair). Here we own only the BUSINESS rules: doctor role gate, doctor-uid
//   binding, and the cert-hash (content) binding; the verified `credentialId`
//   from the canonical verifier is embedded as the signature's provenance.
//   Same hardened flow as the SUSESO / DS67 / DS76 / DTE sign routes (#765).
//
// Diseño: este module es PURO (no toca firebase-admin). El router le inyecta
// `verifyAssertion` (canonical verifier en prod; fake en tests).

import { z } from 'zod';
import type { AptitudeCertJson } from './aptitudeCertGenerator.js';
import { hashAptitudeCertJson } from './aptitudeCertGenerator.js';

// ─── Schema for the sign request (business inputs) ──────────────────────────
//
// The full WebAuthn assertion bundle (credentialId, clientDataJSON, ...) is
// validated + cryptographically verified by the route via the canonical
// verifier; this schema covers only the fields this pure module needs.

export const signCertRequestSchema = z.object({
  certHash: z.string().regex(/^[0-9a-f]{64}$/, 'invalid_cert_hash'),
  challengeId: z.string().min(1).max(256),
  signerRut: z.string().min(1).max(20),
  signedAt: z.string().min(1),
  /** base64 of the authenticator assertion signature — embedded as evidence. */
  signatureB64: z.string().min(1).max(8192),
});

export type SignCertRequest = z.infer<typeof signCertRequestSchema>;

export interface AptitudeCertSignature {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256';
  /** Authenticator assertion signature (evidence). */
  signatureB64: string;
  /** The REGISTERED WebAuthn credential id verified server-side (provenance). */
  credentialId: string;
  /** SHA-256 of the cert JSON the doctor signed — equals certHash. */
  payloadHashHex: string;
  challengeId: string;
}

export interface SignedAptitudeCert {
  json: AptitudeCertJson & { signature: AptitudeCertSignature };
  certHash: string;
}

// ─── Verification ───────────────────────────────────────────────────────────

export class AptitudeCertSignError extends Error {
  readonly code:
    | 'invalid_request'
    | 'cert_hash_mismatch'
    | 'doctor_role_required'
    | 'doctor_uid_mismatch'
    | 'signature_invalid';
  constructor(code: AptitudeCertSignError['code'], message?: string) {
    super(message ?? code);
    this.name = 'AptitudeCertSignError';
    this.code = code;
  }
}

/** Verdict from the canonical WebAuthn verifier (or a test fake). */
export interface AssertionVerdict {
  verified: boolean;
  /** The REGISTERED credential id that produced the assertion (only on success). */
  credentialId?: string;
  reason?: string;
}

export interface VerifyAndSignDeps {
  /** Caller's verified identity (from verifyAuth). */
  caller: { uid: string; role: string | undefined };
  /**
   * Verify the WebAuthn assertion against the doctor's REGISTERED credential.
   * In prod the route wires this to `verifyWebAuthnAssertion` (canonical:
   * consume challenge + registered-credential lookup + crypto verify + counter).
   * A test injects a fake. This module NEVER sees raw keys/signatures-to-verify.
   */
  verifyAssertion: () => Promise<AssertionVerdict>;
}

const ALLOWED_DOCTOR_ROLES = new Set(['admin', 'gerente', 'medico_ocupacional']);

/**
 * Apply the business rules and embed the signature. The caller MUST be a
 * doctor ('medico_ocupacional') or admin. The WebAuthn assertion MUST already
 * verify against the doctor's REGISTERED credential (via `deps.verifyAssertion`).
 *
 * Bindings enforced here:
 *   • Role gate: caller.role ∈ {admin, gerente, medico_ocupacional}.
 *   • Doctor-uid: a 'medico_ocupacional' can only sign their own cert
 *     (admins bypass for emergency re-signs; the audit row records it).
 *   • Content: certHash === sha256(cert) (the signed payload is THIS cert).
 *   • Assertion: deps.verifyAssertion() must return verified + a credentialId.
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

  // Doctor uid binding: a doctor can only sign their own cert. Admins bypass.
  if (deps.caller.role === 'medico_ocupacional' && deps.caller.uid !== cert.doctor.uid) {
    throw new AptitudeCertSignError('doctor_uid_mismatch');
  }

  // Content binding: recompute and compare. The signed payload IS this cert.
  const expectedHash = hashAptitudeCertJson(cert);
  if (request.certHash !== expectedHash) {
    throw new AptitudeCertSignError('cert_hash_mismatch');
  }

  // Cryptographic verification against the REGISTERED credential (canonical).
  const verdict = await deps.verifyAssertion();
  if (!verdict.verified || !verdict.credentialId) {
    throw new AptitudeCertSignError('signature_invalid');
  }

  const sig: AptitudeCertSignature = {
    // Identity from the VERIFIED token, never the request body.
    signerUid: deps.caller.uid,
    signerRut: request.signerRut,
    signedAt: request.signedAt,
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64: request.signatureB64,
    credentialId: verdict.credentialId,
    payloadHashHex: expectedHash,
    challengeId: request.challengeId,
  };

  return {
    json: { ...cert, signature: sig },
    certHash: expectedHash,
  };
}
