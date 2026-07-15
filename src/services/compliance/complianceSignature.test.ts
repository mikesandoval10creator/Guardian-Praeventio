import { describe, expect, it } from 'vitest';
import type { ComplianceSigningIntentV1 } from '../auth/complianceSigningIntent.js';
import { buildWebAuthnComplianceSignature } from './complianceSignature.js';

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
