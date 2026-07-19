import { describe, expect, it } from 'vitest';
import {
  attestComplianceEvidence,
  loadComplianceEvidenceAttestationKeyring,
  verifyComplianceEvidenceAttestation,
  type ComplianceEvidenceAttestationKeyring,
} from './complianceEvidenceAttestation.js';

const CURRENT: ComplianceEvidenceAttestationKeyring = {
  currentKeyId: 'archive-2026-07',
  keys: {
    'archive-2026-07': 'current-compliance-evidence-secret-0001',
    'archive-2026-06': 'previous-compliance-evidence-secret-001',
  },
};

function evidence() {
  return {
    signerUid: 'uid-1',
    signerRut: '12.345.678-5',
    signedAt: '2026-07-18T20:00:00.000Z',
    algorithm: 'kms-sign-rsa',
    signatureB64: 'c2lnbmF0dXJl',
    payloadHashHex: 'a'.repeat(64),
    verificationVersion: 2,
    signingContext: {
      tenantId: 'tenant-1',
      formId: 'form-1',
      documentKind: 'suseso',
      payloadHashHex: 'a'.repeat(64),
      signerUid: 'uid-1',
      signerRut: '12.345.678-5',
    },
    kmsKeyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
    verificationKey: {
      kind: 'kms-rsa-pem',
      keyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1',
      publicKeyPem: 'PUBLIC KEY',
    },
  };
}

describe('compliance evidence archive attestation', () => {
  it('loads an explicit current key and retained historical keys from env', () => {
    expect(loadComplianceEvidenceAttestationKeyring({
      COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID: 'archive-2026-07',
      COMPLIANCE_EVIDENCE_ATTESTATION_KEYS: JSON.stringify(CURRENT.keys),
    })).toEqual(CURRENT);
  });

  it('fails closed for missing, malformed or short production secrets', () => {
    expect(() => loadComplianceEvidenceAttestationKeyring({})).toThrow(/not_configured/);
    expect(() => loadComplianceEvidenceAttestationKeyring({
      COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID: 'key',
      COMPLIANCE_EVIDENCE_ATTESTATION_KEYS: '{bad-json',
    })).toThrow(/invalid_configuration/);
    expect(() => loadComplianceEvidenceAttestationKeyring({
      COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID: 'key',
      COMPLIANCE_EVIDENCE_ATTESTATION_KEYS: JSON.stringify({ key: 'too-short' }),
    })).toThrow(/invalid_configuration/);
  });

  it('authenticates every persisted evidence field with a domain-separated HMAC', () => {
    const unsigned = evidence();
    const archiveAttestation = attestComplianceEvidence(unsigned, { keyring: CURRENT });
    expect(archiveAttestation).toMatchObject({ version: 1, keyId: 'archive-2026-07' });
    expect(verifyComplianceEvidenceAttestation(
      { ...unsigned, archiveAttestation },
      { keyring: CURRENT },
    )).toBe('verified');
  });

  it.each([
    ['embedded public key', (value: ReturnType<typeof evidence>) => {
      value.verificationKey.publicKeyPem = 'ATTACKER PUBLIC KEY';
    }],
    ['legal signer identity', (value: ReturnType<typeof evidence>) => {
      value.signerRut = '11.111.111-1';
      value.signingContext.signerRut = '11.111.111-1';
    }],
    ['signature bytes', (value: ReturnType<typeof evidence>) => {
      value.signatureB64 = 'Zm9yZ2Vk';
    }],
  ])('rejects a valid attestation after tampering with %s', (_label, mutate) => {
    const unsigned = evidence();
    const archiveAttestation = attestComplianceEvidence(unsigned, { keyring: CURRENT });
    const tampered = structuredClone(unsigned);
    mutate(tampered);
    expect(verifyComplianceEvidenceAttestation(
      { ...tampered, archiveAttestation },
      { keyring: CURRENT },
    )).toBe('invalid');
  });

  it('verifies historical evidence with a retained previous key', () => {
    const previous: ComplianceEvidenceAttestationKeyring = {
      currentKeyId: 'archive-2026-06',
      keys: CURRENT.keys,
    };
    const unsigned = evidence();
    const archiveAttestation = attestComplianceEvidence(unsigned, { keyring: previous });
    expect(verifyComplianceEvidenceAttestation(
      { ...unsigned, archiveAttestation },
      { keyring: CURRENT },
    )).toBe('verified');
  });

  it('returns unavailable when the attestation key was not retained', () => {
    const unsigned = evidence();
    const archiveAttestation = attestComplianceEvidence(unsigned, { keyring: CURRENT });
    const withoutHistoricalKey: ComplianceEvidenceAttestationKeyring = {
      currentKeyId: 'new-key',
      keys: { 'new-key': 'new-compliance-evidence-secret-00000001' },
    };
    expect(verifyComplianceEvidenceAttestation(
      { ...unsigned, archiveAttestation },
      { keyring: withoutHistoricalKey },
    )).toBe('unavailable');
  });
});
