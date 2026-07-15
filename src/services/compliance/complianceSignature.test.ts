import { describe, expect, it } from 'vitest';
import type { ComplianceSigningIntentV1 } from '../auth/complianceSigningIntent.js';
import {
  buildKmsComplianceSignature,
  buildWebAuthnComplianceSignature,
  classifyStoredComplianceSignatureEvidence,
} from './complianceSignature.js';

const intent: ComplianceSigningIntentV1 = {
  version: 1,
  purpose: 'compliance-document-sign',
  tenantId: 'tenant-1',
  formId: 'form-1',
  documentKind: 'suseso',
  action: 'sign',
  payloadHashHex: 'ab'.repeat(32),
  signerUid: 'user-1',
  signerRut: '12.345.678-5',
  issuedAtMs: 1_000,
  expiresAtMs: 301_000,
  nonceB64u: 'AQIDBA',
};

const assertion = {
  credentialId: 'credential-1',
  rawId: 'credential-1',
  clientDataJSON: 'client-data-b64u',
  authenticatorData: 'authenticator-data-b64u',
  signature: 'authenticator-signature-b64u',
};

describe('buildWebAuthnComplianceSignature', () => {
  it('constructs all legal and audit fields from verified server evidence', () => {
    const signature = buildWebAuthnComplianceSignature({
      intent,
      signer: { uid: 'user-1', rut: '12.345.678-5', kind: 'human' },
      assertion,
      verifiedCredentialId: 'credential-1',
      now: () => new Date('2026-07-14T22:00:00.000Z'),
    });

    expect(signature).toEqual({
      signerUid: 'user-1',
      signerRut: '12.345.678-5',
      signedAt: '2026-07-14T22:00:00.000Z',
      algorithm: 'webauthn-ecdsa-p256',
      signatureB64: 'authenticator-signature-b64u',
      payloadHashHex: 'ab'.repeat(32),
      verificationVersion: 1,
      signingIntent: intent,
      credentialId: 'credential-1',
      rawId: 'credential-1',
      clientDataJSONB64u: 'client-data-b64u',
      authenticatorDataB64u: 'authenticator-data-b64u',
    });
  });

  it.each([
    ['verified credential mismatch', { verifiedCredentialId: 'credential-x' }],
    ['signer uid mismatch', { signer: { uid: 'user-x', rut: intent.signerRut, kind: 'human' as const } }],
    ['signer RUT mismatch', { signer: { uid: intent.signerUid, rut: '9.999.999-9', kind: 'human' as const } }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => buildWebAuthnComplianceSignature({
      intent,
      signer: { uid: 'user-1', rut: '12.345.678-5', kind: 'human' },
      assertion,
      verifiedCredentialId: 'credential-1',
      now: () => new Date('2026-07-14T22:00:00.000Z'),
      ...overrides,
    })).toThrow();
  });

  it('rejects invalid server clock output', () => {
    expect(() => buildWebAuthnComplianceSignature({
      intent,
      signer: { uid: 'user-1', rut: '12.345.678-5', kind: 'human' },
      assertion,
      verifiedCredentialId: 'credential-1',
      now: () => new Date('invalid'),
    })).toThrow();
  });
});

describe('buildKmsComplianceSignature', () => {
  it('constructs machine evidence from trusted context and locally verified KMS output', () => {
    const signature = buildKmsComplianceSignature({
      context: {
        tenantId: intent.tenantId, formId: intent.formId, documentKind: intent.documentKind,
        payloadHashHex: intent.payloadHashHex, signerUid: 'kms-signer', signerRut: '12.345.678-5',
      },
      signer: { uid: 'kms-signer', rut: '12.345.678-5', kind: 'kms' },
      signatureB64: 'kms-signature',
      keyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7',
      now: () => new Date('2026-07-14T23:00:00.000Z'),
    });
    expect(signature).toMatchObject({
      signerUid: 'kms-signer', signerRut: '12.345.678-5',
      signedAt: '2026-07-14T23:00:00.000Z', algorithm: 'kms-sign-rsa',
      signatureB64: 'kms-signature', payloadHashHex: intent.payloadHashHex,
      verificationVersion: 1,
      kmsKeyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7',
    });
    expect(signature.signingContext?.formId).toBe(intent.formId);
  });

  it('rejects a human identity on the KMS path', () => {
    expect(() => buildKmsComplianceSignature({
      context: {
        tenantId: intent.tenantId, formId: intent.formId, documentKind: intent.documentKind,
        payloadHashHex: intent.payloadHashHex, signerUid: 'user-1', signerRut: intent.signerRut,
      },
      signer: { uid: 'user-1', rut: intent.signerRut, kind: 'human' },
      signatureB64: 'kms-signature', keyVersion: 'key/1',
    })).toThrow();
  });
});

describe('classifyStoredComplianceSignatureEvidence', () => {
  it('distinguishes new bound evidence from readable legacy signatures', () => {
    const bound = buildWebAuthnComplianceSignature({
      intent,
      signer: { uid: 'user-1', rut: '12.345.678-5', kind: 'human' },
      assertion,
      verifiedCredentialId: 'credential-1',
    });
    expect(classifyStoredComplianceSignatureEvidence(bound)).toBe('bound-evidence-v1');
    expect(classifyStoredComplianceSignatureEvidence({
      signerUid: 'legacy-user',
      algorithm: 'webauthn-ecdsa-p256',
      signatureB64: 'legacy-value',
    })).toBe('legacy-unverifiable');
  });

  it('does not classify incomplete v1-shaped evidence as bound', () => {
    expect(classifyStoredComplianceSignatureEvidence({
      verificationVersion: 1,
      algorithm: 'webauthn-ecdsa-p256',
      signingIntent: intent,
    })).toBe('legacy-unverifiable');
  });
});
