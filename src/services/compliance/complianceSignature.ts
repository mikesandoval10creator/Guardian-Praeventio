import type { ComplianceSigningIntentV1 } from '../auth/complianceSigningIntent.js';

/** Optional on persisted models only so legacy signatures remain readable. */
export interface ComplianceSignatureAuditFields {
  verificationVersion?: 1;
  signingIntent?: ComplianceSigningIntentV1;
  credentialId?: string;
  rawId?: string;
  clientDataJSONB64u?: string;
  authenticatorDataB64u?: string;
  kmsKeyVersion?: string;
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
  verificationVersion: 1;
  signingIntent: ComplianceSigningIntentV1;
  credentialId: string;
  rawId: string;
  clientDataJSONB64u: string;
  authenticatorDataB64u: string;
}

export function buildWebAuthnComplianceSignature(input: {
  intent: ComplianceSigningIntentV1;
  signer: TrustedComplianceSigner;
  assertion: WebAuthnComplianceAssertionEvidence;
  verifiedCredentialId: string;
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
    verificationVersion: 1,
    signingIntent: intent,
    credentialId: assertion.credentialId,
    rawId: assertion.rawId,
    clientDataJSONB64u: assertion.clientDataJSON,
    authenticatorDataB64u: assertion.authenticatorData,
  };
}
