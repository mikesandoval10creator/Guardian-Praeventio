import { describe, expect, it, vi } from 'vitest';
import {
  ComplianceSigningFlowError,
  completeComplianceWebAuthnSigning,
  issueComplianceWebAuthnChallenge,
  type ComplianceSignableForm,
} from './complianceWebAuthnSigning.js';

const HASH = 'ab'.repeat(32);
const FORM: ComplianceSignableForm = {
  payloadHashHex: HASH,
  payloadRendererVersion: 1,
};
const signer = { uid: 'user-1', rut: '12.345.678-5', kind: 'human' as const };

function adapter(form: ComplianceSignableForm | null = FORM) {
  return {
    loadForm: vi.fn(async () => form),
    renderUnsignedPayload: vi.fn(async () => ({
      pdfBytes: new Uint8Array([1, 2, 3]),
      payloadHashHex: HASH,
      payloadRendererVersion: 1 as const,
    })),
    persistLegacyDigest: vi.fn(async () => undefined),
  };
}

describe('issueComplianceWebAuthnChallenge', () => {
  it('stores a five-minute challenge derived from the full authoritative intent', async () => {
    const documents = adapter();
    const storeChallenge = vi.fn(async () => undefined);
    const out = await issueComplianceWebAuthnChallenge({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-1', documentKind: 'ds67',
    }, {
      documents,
      resolveSigner: async () => signer,
      storeChallenge,
      newChallengeId: () => 'challenge-1',
      now: () => 10_000,
      randomBytes: () => new Uint8Array([1, 2, 3, 4]),
    });

    expect(out.intent).toMatchObject({
      tenantId: 'tenant-1', formId: 'form-1', documentKind: 'ds67',
      payloadHashHex: HASH, signerUid: 'user-1', signerRut: '12.345.678-5',
      issuedAtMs: 10_000, expiresAtMs: 310_000,
    });
    expect(out.challenge).toHaveLength(32);
    expect(storeChallenge).toHaveBeenCalledWith(
      'user-1', 'challenge-1', out.challenge,
      { metadata: out.intent, ttlMs: 300_000 },
    );
  });

  it('backfills only an unsigned legacy form with a deterministic digest', async () => {
    const documents = adapter({});
    await issueComplianceWebAuthnChallenge({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-1', documentKind: 'suseso',
    }, {
      documents,
      resolveSigner: async () => signer,
      storeChallenge: async () => undefined,
      newChallengeId: () => 'challenge-1',
    });
    expect(documents.persistLegacyDigest).toHaveBeenCalledWith(HASH, 1);
  });

  it.each([
    ['not_found', null],
    ['already_signed', { ...FORM, signature: {} }],
    ['payload_hash_mismatch', { ...FORM, payloadHashHex: 'cd'.repeat(32) }],
  ])('fails closed with %s', async (code, form) => {
    const error = await issueComplianceWebAuthnChallenge({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-1', documentKind: 'suseso',
    }, {
      documents: adapter(form),
      resolveSigner: async () => signer,
      storeChallenge: async () => undefined,
      newChallengeId: () => 'challenge-1',
    }).catch((value) => value);
    expect(error).toBeInstanceOf(ComplianceSigningFlowError);
    expect(error.code).toBe(code);
  });
});

describe('completeComplianceWebAuthnSigning', () => {
  const assertion = {
    challengeId: 'challenge-1', credentialId: 'credential-1', rawId: 'credential-1',
    clientDataJSON: 'client-data', authenticatorData: 'auth-data', signature: 'signature',
    type: 'public-key' as const, clientExtensionResults: {},
  };

  it('validates the stored intent against fresh context and returns server-built evidence', async () => {
    let validated = false;
    const verifyAssertion = vi.fn(async (validator: (metadata: unknown) => boolean) => {
      const issued = await issueComplianceWebAuthnChallenge({
        uid: 'user-1', tenantId: 'tenant-1', formId: 'form-1', documentKind: 'ds76',
      }, {
        documents: adapter(), resolveSigner: async () => signer,
        storeChallenge: async () => undefined, newChallengeId: () => 'challenge-1',
        now: () => 10_000, randomBytes: () => new Uint8Array([1, 2, 3, 4]),
      });
      validated = validator(issued.intent);
      return { verified: true, verifiedCredentialId: 'credential-1', challengeMetadata: issued.intent };
    });

    const signature = await completeComplianceWebAuthnSigning({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-1', documentKind: 'ds76', assertion,
    }, {
      documents: adapter(), resolveSigner: async () => signer, verifyAssertion,
      now: () => new Date('2026-07-14T22:00:00.000Z'),
    });

    expect(validated).toBe(true);
    expect(signature).toMatchObject({
      signerUid: 'user-1', signerRut: '12.345.678-5',
      signedAt: '2026-07-14T22:00:00.000Z', payloadHashHex: HASH,
      signatureB64: 'signature', credentialId: 'credential-1', verificationVersion: 1,
    });
  });

  it('rejects a cross-form intent even if a verifier claims success', async () => {
    const wrongIntent = (await issueComplianceWebAuthnChallenge({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-A', documentKind: 'ds67',
    }, {
      documents: adapter(), resolveSigner: async () => signer,
      storeChallenge: async () => undefined, newChallengeId: () => 'challenge-1',
    })).intent;

    await expect(completeComplianceWebAuthnSigning({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-B', documentKind: 'ds67', assertion,
    }, {
      documents: adapter(), resolveSigner: async () => signer,
      verifyAssertion: async (validator) => {
        expect(validator(wrongIntent)).toBe(false);
        return { verified: true, verifiedCredentialId: 'credential-1', challengeMetadata: wrongIntent };
      },
    })).rejects.toMatchObject({ code: 'intent_context_mismatch' });
  });

  it('rejects document mutation before WebAuthn verification', async () => {
    const verifyAssertion = vi.fn();
    await expect(completeComplianceWebAuthnSigning({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-1', documentKind: 'suseso', assertion,
    }, {
      documents: adapter({ ...FORM, payloadHashHex: 'cd'.repeat(32) }),
      resolveSigner: async () => signer, verifyAssertion,
    })).rejects.toMatchObject({ code: 'payload_hash_mismatch' });
    expect(verifyAssertion).not.toHaveBeenCalled();
  });

  it('does not build evidence when WebAuthn verification fails', async () => {
    await expect(completeComplianceWebAuthnSigning({
      uid: 'user-1', tenantId: 'tenant-1', formId: 'form-1', documentKind: 'suseso', assertion,
    }, {
      documents: adapter(), resolveSigner: async () => signer,
      verifyAssertion: async () => ({ verified: false, reason: 'signature_invalid' }),
    })).rejects.toMatchObject({ code: 'webauthn_failed', reason: 'signature_invalid' });
  });
});
