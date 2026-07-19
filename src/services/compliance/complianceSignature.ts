import type {
  ComplianceSigningContext,
  ComplianceSigningIntentV1,
} from '../auth/complianceSigningIntent.js';
import { matchesComplianceSigningContext } from '../auth/complianceSigningIntent.js';

export type ComplianceVerificationKey =
  | {
      kind: 'webauthn-cose';
      credentialId: string;
      publicKeyB64: string;
      origin: string;
      rpId: string;
    }
  | {
      kind: 'kms-rsa-pem';
      keyVersion: string;
      publicKeyPem: string;
    };

/** Optional on persisted models only so legacy signatures remain readable. */
export interface ComplianceSignatureAuditFields {
  verificationVersion?: 1 | 2;
  signingIntent?: ComplianceSigningIntentV1;
  credentialId?: string;
  rawId?: string;
  clientDataJSONB64u?: string;
  authenticatorDataB64u?: string;
  kmsKeyVersion?: string;
  signingContext?: ComplianceSigningContext;
  verificationKey?: ComplianceVerificationKey;
}

export interface WebAuthnComplianceAssertionEvidence {
  credentialId: string;
  rawId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export interface TrustedComplianceSigner {
  uid: string;
  rut: string;
  kind: 'human' | 'kms';
}

export interface VerifiedWebAuthnComplianceSignature extends ComplianceSignatureAuditFields {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'webauthn-ecdsa-p256';
  signatureB64: string;
  payloadHashHex: string;
  verificationVersion: 2;
  signingIntent: ComplianceSigningIntentV1;
  credentialId: string;
  rawId: string;
  clientDataJSONB64u: string;
  authenticatorDataB64u: string;
  verificationKey: Extract<ComplianceVerificationKey, { kind: 'webauthn-cose' }>;
}

export interface VerifiedKmsComplianceSignature extends ComplianceSignatureAuditFields {
  signerUid: string;
  signerRut: string;
  signedAt: string;
  algorithm: 'kms-sign-rsa';
  signatureB64: string;
  payloadHashHex: string;
  verificationVersion: 2;
  signingContext: ComplianceSigningContext;
  kmsKeyVersion: string;
  verificationKey: Extract<ComplianceVerificationKey, { kind: 'kms-rsa-pem' }>;
}

export type ComplianceSignatureEvidenceClass =
  | 'self-contained-evidence-v2'
  | 'bound-evidence-v1'
  | 'legacy-unverifiable';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasWebAuthnEvidence(signature: Record<string, unknown>): boolean {
  return Boolean(signature.signingIntent) &&
    isNonEmptyString(signature.credentialId) &&
    isNonEmptyString(signature.rawId) &&
    isNonEmptyString(signature.clientDataJSONB64u) &&
    isNonEmptyString(signature.authenticatorDataB64u);
}

function hasKmsEvidence(signature: Record<string, unknown>): boolean {
  return Boolean(signature.signingContext) && isNonEmptyString(signature.kmsKeyVersion);
}

/**
 * Classifies stored evidence without pretending to re-run cryptographic
 * verification. Legacy rows stay readable but must never be presented as a
 * verified v1 signature.
 */
export function classifyStoredComplianceSignatureEvidence(
  value: unknown,
): ComplianceSignatureEvidenceClass {
  if (!value || typeof value !== 'object') return 'legacy-unverifiable';
  const signature = value as Record<string, unknown>;
  if (
    (signature.verificationVersion !== 1 && signature.verificationVersion !== 2) ||
    !isNonEmptyString(signature.signatureB64)
  ) {
    return 'legacy-unverifiable';
  }
  if (signature.algorithm === 'webauthn-ecdsa-p256') {
    if (!hasWebAuthnEvidence(signature)) return 'legacy-unverifiable';
    if (signature.verificationVersion === 1) return 'bound-evidence-v1';
    const key = signature.verificationKey as Record<string, unknown> | undefined;
    return key?.kind === 'webauthn-cose' &&
      key.credentialId === signature.credentialId &&
      isNonEmptyString(key.publicKeyB64) &&
      isNonEmptyString(key.origin) &&
      isNonEmptyString(key.rpId)
      ? 'self-contained-evidence-v2'
      : 'legacy-unverifiable';
  }
  if (signature.algorithm === 'kms-sign-rsa') {
    if (!hasKmsEvidence(signature)) return 'legacy-unverifiable';
    if (signature.verificationVersion === 1) return 'bound-evidence-v1';
    const key = signature.verificationKey as Record<string, unknown> | undefined;
    return key?.kind === 'kms-rsa-pem' &&
      key.keyVersion === signature.kmsKeyVersion &&
      isNonEmptyString(key.publicKeyPem)
      ? 'self-contained-evidence-v2'
      : 'legacy-unverifiable';
  }
  return 'legacy-unverifiable';
}

/**
 * Validate the immutable legal context carried by persisted evidence. This is
 * intentionally structural; server-only cryptographic verification is a
 * separate step so browser-safe document services never import Node crypto.
 */
export function matchesPersistedComplianceSignatureContext(
  value: unknown,
  context: ComplianceSigningContext,
): boolean {
  if (classifyStoredComplianceSignatureEvidence(value) === 'legacy-unverifiable') {
    return false;
  }
  const signature = value as Record<string, unknown>;
  if (
    signature.payloadHashHex !== context.payloadHashHex ||
    signature.signerUid !== context.signerUid ||
    signature.signerRut !== context.signerRut
  ) {
    return false;
  }
  if (signature.algorithm === 'webauthn-ecdsa-p256') {
    return matchesComplianceSigningContext(
      signature.signingIntent as ComplianceSigningIntentV1,
      context,
    );
  }
  if (signature.algorithm === 'kms-sign-rsa') {
    const stored = signature.signingContext as ComplianceSigningContext;
    return stored.tenantId === context.tenantId &&
      stored.formId === context.formId &&
      stored.documentKind === context.documentKind &&
      stored.payloadHashHex === context.payloadHashHex &&
      stored.signerUid === context.signerUid &&
      stored.signerRut === context.signerRut;
  }
  return false;
}

export function buildWebAuthnComplianceSignature(input: {
  intent: ComplianceSigningIntentV1;
  signer: TrustedComplianceSigner;
  assertion: WebAuthnComplianceAssertionEvidence;
  verifiedCredentialId: string;
  verificationKey: {
    publicKeyB64: string;
    origin: string;
    rpId: string;
  };
  now?: () => Date;
}): VerifiedWebAuthnComplianceSignature {
  const { intent, signer, assertion, verifiedCredentialId } = input;
  if (signer.kind !== 'human') {
    throw new TypeError('WebAuthn compliance signatures require a human signer');
  }
  if (intent.signerUid !== signer.uid || intent.signerRut !== signer.rut) {
    throw new TypeError('verified signer identity does not match the signing intent');
  }
  if (
    !verifiedCredentialId ||
    verifiedCredentialId !== assertion.credentialId ||
    !assertion.rawId ||
    !assertion.clientDataJSON ||
    !assertion.authenticatorData ||
    !assertion.signature
  ) {
    throw new TypeError('verified WebAuthn evidence is incomplete or inconsistent');
  }
  if (!/^[0-9a-f]{64}$/.test(intent.payloadHashHex)) {
    throw new TypeError('signing intent payload hash is invalid');
  }
  if (
    !isNonEmptyString(input.verificationKey.publicKeyB64) ||
    !isNonEmptyString(input.verificationKey.origin) ||
    !isNonEmptyString(input.verificationKey.rpId)
  ) {
    throw new TypeError('verified WebAuthn public-key evidence is incomplete');
  }

  const signedAtDate = (input.now ?? (() => new Date()))();
  if (!(signedAtDate instanceof Date) || Number.isNaN(signedAtDate.getTime())) {
    throw new TypeError('server signing clock returned an invalid date');
  }

  return {
    signerUid: signer.uid,
    signerRut: signer.rut,
    signedAt: signedAtDate.toISOString(),
    algorithm: 'webauthn-ecdsa-p256',
    signatureB64: assertion.signature,
    payloadHashHex: intent.payloadHashHex,
    verificationVersion: 2,
    signingIntent: intent,
    credentialId: assertion.credentialId,
    rawId: assertion.rawId,
    clientDataJSONB64u: assertion.clientDataJSON,
    authenticatorDataB64u: assertion.authenticatorData,
    verificationKey: {
      kind: 'webauthn-cose',
      credentialId: verifiedCredentialId,
      publicKeyB64: input.verificationKey.publicKeyB64,
      origin: input.verificationKey.origin,
      rpId: input.verificationKey.rpId,
    },
  };
}

export function buildKmsComplianceSignature(input: {
  context: ComplianceSigningContext;
  signer: TrustedComplianceSigner;
  signatureB64: string;
  keyVersion: string;
  publicKeyPem: string;
  now?: () => Date;
}): VerifiedKmsComplianceSignature {
  const { context, signer } = input;
  if (signer.kind !== 'kms') {
    throw new TypeError('KMS compliance signatures require a configured KMS signer');
  }
  if (context.signerUid !== signer.uid || context.signerRut !== signer.rut) {
    throw new TypeError('configured KMS signer does not match the authoritative context');
  }
  if (!input.signatureB64 || !input.keyVersion || !input.publicKeyPem) {
    throw new TypeError('verified KMS signature and key version are required');
  }
  if (!/^[0-9a-f]{64}$/.test(context.payloadHashHex)) {
    throw new TypeError('KMS signing context payload hash is invalid');
  }
  const signedAtDate = (input.now ?? (() => new Date()))();
  if (!(signedAtDate instanceof Date) || Number.isNaN(signedAtDate.getTime())) {
    throw new TypeError('server signing clock returned an invalid date');
  }
  return {
    signerUid: signer.uid,
    signerRut: signer.rut,
    signedAt: signedAtDate.toISOString(),
    algorithm: 'kms-sign-rsa',
    signatureB64: input.signatureB64,
    payloadHashHex: context.payloadHashHex,
    verificationVersion: 2,
    signingContext: { ...context },
    kmsKeyVersion: input.keyVersion,
    verificationKey: {
      kind: 'kms-rsa-pem',
      keyVersion: input.keyVersion,
      publicKeyPem: input.publicKeyPem,
    },
  };
}
