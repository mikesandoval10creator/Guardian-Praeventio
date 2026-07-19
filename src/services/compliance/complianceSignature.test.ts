import { describe, expect, it } from 'vitest';
import type { ComplianceSigningIntentV1 } from '../auth/complianceSigningIntent.js';
import {
  buildKmsComplianceSignature,
  buildWebAuthnComplianceSignature,
  classifyStoredComplianceSignatureEvidence,
  matchesPersistedComplianceSignatureContext,
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
const archiveAttestation = {
  version: 1 as const,
  keyId: 'test-archive-key',
  macB64u: 'a'.repeat(43),
};

describe('buildWebAuthnComplianceSignature', () => {
  it('constructs all legal and audit fields from verified server evidence', () => {
    const signature = buildWebAuthnComplianceSignature({
      intent,
      signer: { uid: 'user-1', rut: '12.345.678-5', kind: 'human' },
      assertion,
      verifiedCredentialId: 'credential-1',
      verificationKey: {
        publicKeyB64: 'cose-public-key',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
      now: () => new Date('2026-07-14T22:00:00.000Z'),
    });

    expect(signature).toEqual({
      signerUid: 'user-1',
      signerRut: '12.345.678-5',
      signedAt: '2026-07-14T22:00:00.000Z',
      algorithm: 'webauthn-ecdsa-p256',
      signatureB64: 'authenticator-signature-b64u',
      payloadHashHex: 'ab'.repeat(32),
      verificationVersion: 2,
      signingIntent: intent,
      credentialId: 'credential-1',
      rawId: 'credential-1',
      clientDataJSONB64u: 'client-data-b64u',
      authenticatorDataB64u: 'authenticator-data-b64u',
      verificationKey: {
        kind: 'webauthn-cose',
        credentialId: 'credential-1',
        publicKeyB64: 'cose-public-key',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
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
      verificationKey: {
        publicKeyB64: 'cose-public-key',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
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
      verificationKey: {
        publicKeyB64: 'cose-public-key',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
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
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----',
      now: () => new Date('2026-07-14T23:00:00.000Z'),
    });
    expect(signature).toMatchObject({
      signerUid: 'kms-signer', signerRut: '12.345.678-5',
      signedAt: '2026-07-14T23:00:00.000Z', algorithm: 'kms-sign-rsa',
      signatureB64: 'kms-signature', payloadHashHex: intent.payloadHashHex,
      verificationVersion: 2,
      kmsKeyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7',
      verificationKey: {
        kind: 'kms-rsa-pem',
        keyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----',
      },
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
      signatureB64: 'kms-signature', keyVersion: 'key/1', publicKeyPem: 'pem',
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
      verificationKey: {
        publicKeyB64: 'cose-public-key',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
    });
    expect(classifyStoredComplianceSignatureEvidence({
      ...bound,
      archiveAttestation,
    })).toBe('self-contained-evidence-v2');
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

  it('keeps complete v1 evidence readable for live-key fallback', () => {
    expect(classifyStoredComplianceSignatureEvidence({
      verificationVersion: 1,
      algorithm: 'webauthn-ecdsa-p256',
      signatureB64: assertion.signature,
      signingIntent: intent,
      credentialId: assertion.credentialId,
      rawId: assertion.rawId,
      clientDataJSONB64u: assertion.clientDataJSON,
      authenticatorDataB64u: assertion.authenticatorData,
    })).toBe('bound-evidence-v1');
  });

  it('does not claim KMS v1 authenticates mutable signer metadata', () => {
    expect(classifyStoredComplianceSignatureEvidence({
      verificationVersion: 1,
      algorithm: 'kms-sign-rsa',
      signatureB64: 'historical-signature',
      signingContext: {
        tenantId: 'tenant-1', formId: 'form-1', documentKind: 'suseso',
        payloadHashHex: intent.payloadHashHex, signerUid: 'kms', signerRut: intent.signerRut,
      },
      kmsKeyVersion: 'key/1',
    })).toBe('legacy-unverifiable');
  });

  it('classifies a v2 row without archive provenance as unverifiable legacy', () => {
    const unattested = buildWebAuthnComplianceSignature({
      intent,
      signer: { uid: 'user-1', rut: '12.345.678-5', kind: 'human' },
      assertion,
      verifiedCredentialId: 'credential-1',
      verificationKey: {
        publicKeyB64: 'cose-public-key',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
    });
    expect(classifyStoredComplianceSignatureEvidence(unattested)).toBe('legacy-unverifiable');
  });

  it('rejects v2 evidence whose key snapshot is incomplete or inconsistent', () => {
    expect(classifyStoredComplianceSignatureEvidence({
      verificationVersion: 2,
      algorithm: 'webauthn-ecdsa-p256',
      signatureB64: assertion.signature,
      signingIntent: intent,
      credentialId: assertion.credentialId,
      rawId: assertion.rawId,
      clientDataJSONB64u: assertion.clientDataJSON,
      authenticatorDataB64u: assertion.authenticatorData,
      verificationKey: {
        kind: 'webauthn-cose',
        credentialId: 'different-credential',
        publicKeyB64: 'cose-public-key',
        origin: 'https://app.praeventio.net',
        rpId: 'app.praeventio.net',
      },
    })).toBe('legacy-unverifiable');
  });
});

describe('matchesPersistedComplianceSignatureContext', () => {
  const context = {
    tenantId: intent.tenantId,
    formId: intent.formId,
    documentKind: intent.documentKind,
    payloadHashHex: intent.payloadHashHex,
    signerUid: intent.signerUid,
    signerRut: intent.signerRut,
  };

  const signature = {
    ...buildWebAuthnComplianceSignature({
    intent,
    signer: { uid: intent.signerUid, rut: intent.signerRut, kind: 'human' },
    assertion,
    verifiedCredentialId: assertion.credentialId,
    verificationKey: {
      publicKeyB64: 'cose-public-key',
      origin: 'https://app.praeventio.net',
      rpId: 'app.praeventio.net',
    },
    }),
    archiveAttestation,
  };

  it('accepts only the exact authoritative signing context', () => {
    expect(matchesPersistedComplianceSignatureContext(signature, context)).toBe(true);
    for (const patch of [
      { tenantId: 'other' },
      { formId: 'other' },
      { documentKind: 'ds67' as const },
      { payloadHashHex: 'cd'.repeat(32) },
      { signerUid: 'other' },
      { signerRut: '9.999.999-9' },
    ]) {
      expect(matchesPersistedComplianceSignatureContext(
        signature,
        { ...context, ...patch },
      )).toBe(false);
    }
  });

  it('rejects legacy and internally inconsistent evidence', () => {
    expect(matchesPersistedComplianceSignatureContext({
      ...signature,
      payloadHashHex: 'cd'.repeat(32),
    }, context)).toBe(false);
    expect(matchesPersistedComplianceSignatureContext({
      signatureB64: 'AAAA',
      algorithm: 'webauthn-ecdsa-p256',
    }, context)).toBe(false);
  });
});
