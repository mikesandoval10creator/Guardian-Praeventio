import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createComplianceSigningIntent,
  deriveComplianceSigningChallenge,
  type ComplianceSigningContext,
} from '../../services/auth/complianceSigningIntent.js';
import {
  buildComplianceKmsSigningPayload,
  buildKmsComplianceSignature,
  buildWebAuthnComplianceSignature,
} from '../../services/compliance/complianceSignature.js';
import { verifyPersistedComplianceSignature } from './complianceSignatureVerification.js';
import {
  attestComplianceEvidence,
  verifyComplianceEvidenceAttestation,
  type ComplianceEvidenceAttestationKeyring,
} from './complianceEvidenceAttestation.js';

const PAYLOAD = new TextEncoder().encode('immutable regulatory PDF bytes');
const HASH = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const CONTEXT: ComplianceSigningContext = {
  tenantId: 'tenant-1',
  formId: 'form-1',
  documentKind: 'suseso',
  payloadHashHex: HASH,
  signerUid: 'user-1',
  signerRut: '12.345.678-5',
};
const ATTESTATION_KEYRING: ComplianceEvidenceAttestationKeyring = {
  currentKeyId: 'test-archive-key',
  keys: { 'test-archive-key': 'test-compliance-archive-secret-000001' },
};
const ATTESTATION_DEPS = {
  verifyEvidenceAttestation: (signature: unknown) =>
    verifyComplianceEvidenceAttestation(signature, { keyring: ATTESTATION_KEYRING }),
};

function archive<T extends object>(evidence: T): T & { archiveAttestation: {
  version: 1;
  keyId: string;
  macB64u: string;
} } {
  return {
    ...evidence,
    archiveAttestation: attestComplianceEvidence(evidence, { keyring: ATTESTATION_KEYRING }),
  };
}

function encodeEc2CosePublicKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  return Uint8Array.from([
    0xa5,
    0x01, 0x02,
    0x03, 0x26,
    0x20, 0x01,
    0x21, 0x58, 0x20, ...x,
    0x22, 0x58, 0x20, ...y,
  ]);
}

function webAuthnFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new Error('generated EC key lacks coordinates');
  const publicKeyCose = encodeEc2CosePublicKey(
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  );
  const intent = createComplianceSigningIntent(CONTEXT, {
    now: () => 1_000,
    randomBytes: () => new Uint8Array([1, 2, 3, 4]),
  }).intent;
  const origin = 'https://app.praeventio.net';
  const rpId = 'app.praeventio.net';
  const clientData = Buffer.from(JSON.stringify({
    type: 'webauthn.get',
    challenge: Buffer.from(deriveComplianceSigningChallenge(intent)).toString('base64url'),
    origin,
  }));
  const authenticatorData = Buffer.concat([
    crypto.createHash('sha256').update(rpId).digest(),
    Buffer.from([0x05]),
    Buffer.from([0, 0, 0, 1]),
  ]);
  const signatureBase = Buffer.concat([
    authenticatorData,
    crypto.createHash('sha256').update(clientData).digest(),
  ]);
  const assertion = {
    credentialId: 'credential-1',
    rawId: 'credential-1',
    clientDataJSON: clientData.toString('base64url'),
    authenticatorData: authenticatorData.toString('base64url'),
    signature: crypto.sign('sha256', signatureBase, privateKey).toString('base64url'),
  };
  const evidence = archive(buildWebAuthnComplianceSignature({
    intent,
    signer: { uid: CONTEXT.signerUid, rut: CONTEXT.signerRut, kind: 'human' },
    assertion,
    verifiedCredentialId: assertion.credentialId,
    verificationKey: {
      publicKeyB64: Buffer.from(publicKeyCose).toString('base64'),
      origin,
      rpId,
    },
    now: () => new Date('2026-07-18T20:00:00.000Z'),
  }));
  return { evidence, publicKeyB64: Buffer.from(publicKeyCose).toString('base64'), origin, rpId };
}

function kmsFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const context = { ...CONTEXT, signerUid: 'kms-signer' };
  const signatureB64 = crypto.sign('sha256', buildComplianceKmsSigningPayload(context), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString('base64');
  return {
    context,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    evidence: archive(buildKmsComplianceSignature({
      context,
      signer: { uid: 'kms-signer', rut: CONTEXT.signerRut, kind: 'kms' },
      signatureB64,
      keyVersion: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7',
      publicKeyPem: publicKey,
      now: () => new Date('2026-07-18T20:00:00.000Z'),
    })),
  };
}

describe('verifyPersistedComplianceSignature', () => {
  it('verifies a self-contained WebAuthn signature with real P-256 crypto', async () => {
    const { evidence } = webAuthnFixture();
    await expect(verifyPersistedComplianceSignature({
      context: CONTEXT,
      payloadBytes: PAYLOAD,
      signature: evidence,
    }, ATTESTATION_DEPS)).resolves.toEqual({ status: 'verified' });
  });

  it('rejects document, context and signature tampering', async () => {
    const { evidence } = webAuthnFixture();
    await expect(verifyPersistedComplianceSignature({
      context: CONTEXT,
      payloadBytes: new TextEncoder().encode('tampered PDF'),
      signature: evidence,
    }, ATTESTATION_DEPS)).resolves.toEqual({ status: 'invalid', reason: 'payload_hash_mismatch' });
    await expect(verifyPersistedComplianceSignature({
      context: { ...CONTEXT, formId: 'other-form' },
      payloadBytes: PAYLOAD,
      signature: evidence,
    }, ATTESTATION_DEPS)).resolves.toEqual({ status: 'invalid', reason: 'context_mismatch' });
    await expect(verifyPersistedComplianceSignature({
      context: CONTEXT,
      payloadBytes: PAYLOAD,
      signature: { ...evidence, signatureB64: Buffer.from('fabricated').toString('base64url') },
    }, ATTESTATION_DEPS)).resolves.toEqual({
      status: 'invalid', reason: 'evidence_attestation_invalid',
    });
  });

  it('verifies a self-contained KMS signature with real RSA-PSS crypto', async () => {
    const { context, evidence } = kmsFixture();
    await expect(verifyPersistedComplianceSignature({
      context,
      payloadBytes: PAYLOAD,
      signature: evidence,
    }, ATTESTATION_DEPS)).resolves.toEqual({ status: 'verified' });
  });

  it('rejects a fabricated KMS signature', async () => {
    const { context, evidence } = kmsFixture();
    await expect(verifyPersistedComplianceSignature({
      context,
      payloadBytes: PAYLOAD,
      signature: { ...evidence, signatureB64: Buffer.from('fabricated').toString('base64') },
    }, ATTESTATION_DEPS)).resolves.toEqual({
      status: 'invalid', reason: 'evidence_attestation_invalid',
    });
  });

  it('rejects a self-signed attacker key without trusted archive provenance', async () => {
    const { context, evidence } = kmsFixture();
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const forged = {
      ...evidence,
      signatureB64: crypto.sign('sha256', buildComplianceKmsSigningPayload(context), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      }).toString('base64'),
      verificationKey: { ...evidence.verificationKey, publicKeyPem: publicKey },
    };
    await expect(verifyPersistedComplianceSignature({
      context,
      payloadBytes: PAYLOAD,
      signature: forged,
    }, ATTESTATION_DEPS)).resolves.toEqual({
      status: 'invalid', reason: 'evidence_attestation_invalid',
    });
  });

  it('does not accept signer identity rewritten alongside its stored context', async () => {
    const { context, evidence } = kmsFixture();
    const forgedContext = { ...context, signerUid: 'attacker', signerRut: '11.111.111-1' };
    const forged = {
      ...evidence,
      signerUid: forgedContext.signerUid,
      signerRut: forgedContext.signerRut,
      signingContext: forgedContext,
    };
    await expect(verifyPersistedComplianceSignature({
      context: forgedContext,
      payloadBytes: PAYLOAD,
      signature: forged,
    }, ATTESTATION_DEPS)).resolves.toEqual({
      status: 'invalid', reason: 'evidence_attestation_invalid',
    });
  });

  it('verifies v1 WebAuthn evidence through an ownership-checked key resolver', async () => {
    const { evidence, publicKeyB64, origin, rpId } = webAuthnFixture();
    const legacyV1 = { ...evidence, verificationVersion: 1 as const };
    delete (legacyV1 as Partial<typeof legacyV1>).verificationKey;
    await expect(verifyPersistedComplianceSignature({
      context: CONTEXT,
      payloadBytes: PAYLOAD,
      signature: legacyV1,
    }, {
      resolveWebAuthnCredential: async () => ({
        uid: CONTEXT.signerUid,
        publicKeyB64,
        origin,
        rpId,
      }),
    })).resolves.toEqual({ status: 'verified' });
  });

  it('does not claim historical KMS v1 authenticates mutable UID/RUT metadata', async () => {
    const { context, evidence, publicKeyPem, privateKeyPem } = kmsFixture();
    const legacyV1 = {
      ...evidence,
      verificationVersion: 1 as const,
      signatureB64: crypto.sign('sha256', PAYLOAD, {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      }).toString('base64'),
    };
    delete (legacyV1 as Partial<typeof legacyV1>).verificationKey;
    delete (legacyV1 as Partial<typeof legacyV1>).archiveAttestation;
    await expect(verifyPersistedComplianceSignature({
      context,
      payloadBytes: PAYLOAD,
      signature: legacyV1,
    }, {
      resolveKmsPublicKey: async () => ({ publicKeyPem }),
    })).resolves.toEqual({ status: 'unverifiable', reason: 'legacy_unverifiable' });
  });

  it('does not claim validity when historical key evidence is unavailable', async () => {
    const { evidence } = webAuthnFixture();
    const legacyV1 = { ...evidence, verificationVersion: 1 as const };
    delete (legacyV1 as Partial<typeof legacyV1>).verificationKey;
    await expect(verifyPersistedComplianceSignature({
      context: CONTEXT,
      payloadBytes: PAYLOAD,
      signature: legacyV1,
    }, {
      resolveWebAuthnCredential: async () => null,
    })).resolves.toEqual({ status: 'unverifiable', reason: 'verification_key_unavailable' });
  });

  it('maps resolver outages without leaking provider errors', async () => {
    const { evidence } = webAuthnFixture();
    const legacyV1 = { ...evidence, verificationVersion: 1 as const };
    delete (legacyV1 as Partial<typeof legacyV1>).verificationKey;
    await expect(verifyPersistedComplianceSignature({
      context: CONTEXT,
      payloadBytes: PAYLOAD,
      signature: legacyV1,
    }, {
      resolveWebAuthnCredential: async () => { throw new Error('provider secret detail'); },
    })).resolves.toEqual({ status: 'unverifiable', reason: 'verification_service_unavailable' });
  });

  it('classifies old unbound signatures as legacy instead of valid', async () => {
    await expect(verifyPersistedComplianceSignature({
      context: CONTEXT,
      payloadBytes: PAYLOAD,
      signature: {
        signerUid: CONTEXT.signerUid,
        signerRut: CONTEXT.signerRut,
        algorithm: 'webauthn-ecdsa-p256',
        signatureB64: 'AAAA',
        payloadHashHex: HASH,
      },
    })).resolves.toEqual({ status: 'unverifiable', reason: 'legacy_unverifiable' });
  });
});
