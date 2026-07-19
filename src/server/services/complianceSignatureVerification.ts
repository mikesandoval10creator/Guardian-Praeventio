import crypto from 'node:crypto';
import { getWebauthnRpId, getWebauthnExpectedOrigin } from '../auth/rpId.js';
import {
  parseAuthenticatorData,
  verifySignature,
} from '@simplewebauthn/server/helpers';
import {
  deriveComplianceSigningChallenge,
  type ComplianceSigningContext,
  type ComplianceSigningIntentV1,
} from '../../services/auth/complianceSigningIntent.js';
import {
  buildComplianceKmsSigningPayload,
  classifyStoredComplianceSignatureEvidence,
  matchesPersistedComplianceSignatureContext,
  type ComplianceSignatureVerificationOutcome,
  type ComplianceVerificationKey,
} from '../../services/compliance/complianceSignature.js';
import {
  verifyComplianceEvidenceAttestation,
  type ComplianceEvidenceAttestationVerification,
} from './complianceEvidenceAttestation.js';

export interface PersistedComplianceSignatureVerificationInput {
  context: ComplianceSigningContext;
  payloadBytes: Uint8Array;
  signature: unknown;
}

export interface PersistedComplianceSignatureVerificationDependencies {
  verifyEvidenceAttestation?(
    signature: unknown,
  ): ComplianceEvidenceAttestationVerification | Promise<ComplianceEvidenceAttestationVerification>;
  resolveWebAuthnCredential?(credentialId: string): Promise<{
    uid: string;
    publicKeyB64: string;
    origin: string;
    rpId: string;
  } | null>;
  resolveKmsPublicKey?(keyVersion: string): Promise<{ publicKeyPem: string } | null>;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function decodeBase64Url(value: unknown): Buffer | null {
  if (!nonEmptyString(value) || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

async function resolveWebAuthnKey(
  signature: Record<string, unknown>,
  evidenceClass: ReturnType<typeof classifyStoredComplianceSignatureEvidence>,
  deps: PersistedComplianceSignatureVerificationDependencies,
): Promise<
  | { kind: 'resolved'; publicKeyB64: string; origin: string; rpId: string; uid?: string }
  | { kind: 'unavailable'; serviceFailure: boolean }
> {
  if (evidenceClass === 'self-contained-evidence-v2') {
    const key = signature.verificationKey as Extract<
      ComplianceVerificationKey,
      { kind: 'webauthn-cose' }
    >;
    return {
      kind: 'resolved',
      publicKeyB64: key.publicKeyB64,
      origin: key.origin,
      rpId: key.rpId,
    };
  }
  if (!deps.resolveWebAuthnCredential || !nonEmptyString(signature.credentialId)) {
    return { kind: 'unavailable', serviceFailure: false };
  }
  try {
    const key = await deps.resolveWebAuthnCredential(signature.credentialId);
    return key ? { kind: 'resolved', ...key } : { kind: 'unavailable', serviceFailure: false };
  } catch {
    return { kind: 'unavailable', serviceFailure: true };
  }
}

async function verifyWebAuthn(
  signature: Record<string, unknown>,
  context: ComplianceSigningContext,
  evidenceClass: ReturnType<typeof classifyStoredComplianceSignatureEvidence>,
  deps: PersistedComplianceSignatureVerificationDependencies,
): Promise<ComplianceSignatureVerificationOutcome> {
  const resolved = await resolveWebAuthnKey(signature, evidenceClass, deps);
  if (resolved.kind === 'unavailable') {
    return {
      status: 'unverifiable',
      reason: resolved.serviceFailure
        ? 'verification_service_unavailable'
        : 'verification_key_unavailable',
    };
  }
  if (resolved.uid !== undefined && resolved.uid !== context.signerUid) {
    return { status: 'invalid', reason: 'context_mismatch' };
  }

  // [P0][seguridad] The relying-party binding must come from OUR configuration,
  // never from the record being verified. For `self-contained-evidence-v2` the
  // rpId/origin travel INSIDE the stored evidence, so verifying against them is
  // circular: forged evidence could name its own relying party and then satisfy
  // every check against it. Resolve the expected values from the server env
  // (fail-loud in production, see auth/rpId.ts) and refuse anything that names a
  // different RP.
  //
  // A mismatch is reported as `unverifiable`, not `invalid`: a document signed
  // under a previous deployment is indistinguishable here from a forgery, and
  // this system's rule is to never present something as verified when it cannot
  // be proven — while still not branding a possibly-legitimate archived document
  // as invalid.
  const expectedRpId = getWebauthnRpId();
  const expectedOrigin = getWebauthnExpectedOrigin();
  if (resolved.rpId !== expectedRpId || resolved.origin !== expectedOrigin) {
    return { status: 'unverifiable', reason: 'relying_party_mismatch' };
  }

  const clientDataBytes = decodeBase64Url(signature.clientDataJSONB64u);
  const authenticatorData = decodeBase64Url(signature.authenticatorDataB64u);
  const signatureBytes = decodeBase64Url(signature.signatureB64);
  const rawId = decodeBase64Url(signature.rawId);
  const credentialId = decodeBase64Url(signature.credentialId);
  const publicKey = nonEmptyString(resolved.publicKeyB64)
    ? Buffer.from(resolved.publicKeyB64, 'base64')
    : null;
  if (
    !clientDataBytes || !authenticatorData || !signatureBytes ||
    !rawId || !credentialId || !publicKey?.byteLength ||
    !equalBytes(rawId, credentialId)
  ) {
    return { status: 'invalid', reason: 'signature_invalid' };
  }

  let clientData: Record<string, unknown>;
  try {
    clientData = JSON.parse(clientDataBytes.toString('utf8')) as Record<string, unknown>;
  } catch {
    return { status: 'invalid', reason: 'signature_invalid' };
  }
  const expectedChallenge = Buffer.from(deriveComplianceSigningChallenge(
    signature.signingIntent as ComplianceSigningIntentV1,
  )).toString('base64url');
  if (
    clientData.type !== 'webauthn.get' ||
    clientData.challenge !== expectedChallenge ||
    clientData.origin !== expectedOrigin
  ) {
    return { status: 'invalid', reason: 'signature_invalid' };
  }

  try {
    const parsed = parseAuthenticatorData(authenticatorData);
    // SHA-256 is MANDATED by the WebAuthn spec, not a hashing choice:
    // authenticatorData carries `rpIdHash = SHA-256(rpId)` (W3C WebAuthn §6.1),
    // so the verifier must recompute exactly that to compare. `rpId` is a public
    // domain name ("app.praeventio.net"), never a secret — a slow KDF would
    // produce a different digest and break verification outright.
    //
    // The input is the SERVER-CONFIGURED rpId (validated against the stored one
    // above), never the value carried by the evidence under verification.
    const expectedRpIdHash = crypto.createHash('sha256').update(expectedRpId).digest();
    if (!equalBytes(parsed.rpIdHash, expectedRpIdHash) || !parsed.flags.up || !parsed.flags.uv) {
      return { status: 'invalid', reason: 'signature_invalid' };
    }
    const signatureBase = Buffer.concat([
      authenticatorData,
      crypto.createHash('sha256').update(clientDataBytes).digest(),
    ]);
    const verified = await verifySignature({
      signature: signatureBytes,
      data: signatureBase,
      credentialPublicKey: publicKey,
    });
    return verified
      ? { status: 'verified' }
      : { status: 'invalid', reason: 'signature_invalid' };
  } catch {
    return { status: 'invalid', reason: 'signature_invalid' };
  }
}

async function resolveKmsKey(
  signature: Record<string, unknown>,
  evidenceClass: ReturnType<typeof classifyStoredComplianceSignatureEvidence>,
  deps: PersistedComplianceSignatureVerificationDependencies,
): Promise<
  | { kind: 'resolved'; publicKeyPem: string }
  | { kind: 'unavailable'; serviceFailure: boolean }
> {
  if (evidenceClass === 'self-contained-evidence-v2') {
    const key = signature.verificationKey as Extract<
      ComplianceVerificationKey,
      { kind: 'kms-rsa-pem' }
    >;
    return { kind: 'resolved', publicKeyPem: key.publicKeyPem };
  }
  if (!deps.resolveKmsPublicKey || !nonEmptyString(signature.kmsKeyVersion)) {
    return { kind: 'unavailable', serviceFailure: false };
  }
  try {
    const key = await deps.resolveKmsPublicKey(signature.kmsKeyVersion);
    return key ? { kind: 'resolved', ...key } : { kind: 'unavailable', serviceFailure: false };
  } catch {
    return { kind: 'unavailable', serviceFailure: true };
  }
}

async function verifyKms(
  signature: Record<string, unknown>,
  payloadBytes: Uint8Array,
  context: ComplianceSigningContext,
  evidenceClass: ReturnType<typeof classifyStoredComplianceSignatureEvidence>,
  deps: PersistedComplianceSignatureVerificationDependencies,
): Promise<ComplianceSignatureVerificationOutcome> {
  const resolved = await resolveKmsKey(signature, evidenceClass, deps);
  if (resolved.kind === 'unavailable') {
    return {
      status: 'unverifiable',
      reason: resolved.serviceFailure
        ? 'verification_service_unavailable'
        : 'verification_key_unavailable',
    };
  }
  if (!nonEmptyString(signature.signatureB64)) {
    return { status: 'invalid', reason: 'signature_invalid' };
  }
  try {
    const signedBytes = evidenceClass === 'bound-evidence-v1'
      ? payloadBytes
      : buildComplianceKmsSigningPayload(context);
    const verified = crypto.verify('sha256', signedBytes, {
      key: resolved.publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, Buffer.from(signature.signatureB64, 'base64'));
    return verified
      ? { status: 'verified' }
      : { status: 'invalid', reason: 'signature_invalid' };
  } catch {
    return { status: 'invalid', reason: 'signature_invalid' };
  }
}

export async function verifyPersistedComplianceSignature(
  input: PersistedComplianceSignatureVerificationInput,
  deps: PersistedComplianceSignatureVerificationDependencies = {},
): Promise<ComplianceSignatureVerificationOutcome> {
  const evidenceClass = classifyStoredComplianceSignatureEvidence(input.signature);
  if (evidenceClass === 'legacy-unverifiable') {
    return { status: 'unverifiable', reason: 'legacy_unverifiable' };
  }
  if (evidenceClass === 'self-contained-evidence-v2') {
    let attestation: ComplianceEvidenceAttestationVerification;
    try {
      attestation = await (
        deps.verifyEvidenceAttestation?.(input.signature) ??
        verifyComplianceEvidenceAttestation(input.signature)
      );
    } catch {
      return { status: 'unverifiable', reason: 'verification_service_unavailable' };
    }
    if (attestation === 'invalid') {
      return { status: 'invalid', reason: 'evidence_attestation_invalid' };
    }
    if (attestation === 'unavailable') {
      return { status: 'unverifiable', reason: 'evidence_attestation_key_unavailable' };
    }
  }
  const computedHash = crypto.createHash('sha256').update(input.payloadBytes).digest('hex');
  if (computedHash !== input.context.payloadHashHex) {
    return { status: 'invalid', reason: 'payload_hash_mismatch' };
  }
  if (!matchesPersistedComplianceSignatureContext(input.signature, input.context)) {
    return { status: 'invalid', reason: 'context_mismatch' };
  }
  const signature = input.signature as Record<string, unknown>;
  if (signature.algorithm === 'webauthn-ecdsa-p256') {
    return verifyWebAuthn(signature, input.context, evidenceClass, deps);
  }
  if (signature.algorithm === 'kms-sign-rsa') {
    return verifyKms(signature, input.payloadBytes, input.context, evidenceClass, deps);
  }
  return { status: 'invalid', reason: 'signature_invalid' };
}
