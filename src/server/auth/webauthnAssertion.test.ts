// Tests para verifyWebAuthnAssertion — Regla #3 cierre del DIAT WebAuthn
// ceremony end-to-end.
//
// Verifica el routing entre las capas de falla (challenge no encontrado,
// signature inválida, counter no monotónico) sin depender del SDK real
// — los tests cubren TODOS los failure paths sin tener que generar
// assertions WebAuthn reales (que requieren hardware authenticator).

import { describe, it, expect, vi } from 'vitest';

// Mock @simplewebauthn/server para evitar pull de @peculiar/asn1-rsa
// que tiene un peer-dep issue en el harness de tests. La verificación
// real está cubierta por __tests__/server/webauthnVerify.test.ts.
vi.mock('@simplewebauthn/server', () => ({
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: false,
    authenticationInfo: { newCounter: 0 },
  })),
}));

import { verifyWebAuthnAssertion } from './webauthnAssertion';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';

const mockVerify = vi.mocked(verifyAuthenticationResponse);

const VALID_INPUT = {
  uid: 'user-1',
  credentialId: 'cred-abc',
  rawId: 'cred-abc',
  clientDataJSON: Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: 'YWFhYWFhYWFhYWFhYWFhYQ', // base64url("aaaaaaaaaaaaaaaa")
      origin: 'http://localhost:5173',
    }),
  ).toString('base64'),
  authenticatorData: 'authData',
  signature: 'sigB64',
  clientExtensionResults: {},
  type: 'public-key',
  challengeId: 'challenge-1',
  expectedOrigin: 'http://localhost:5173',
  expectedRpId: 'localhost',
};

// Mocks ligeros — `consumeWebAuthnChallenge` necesita `.collection().doc()`
// que no proveemos para los tests que paran antes de llegar a esa capa.
function mockChallengesDb() {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => undefined }),
        set: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      }),
    }),
  } as any;
}

function mockCredentialsDb() {
  return mockChallengesDb();
}

describe('verifyWebAuthnAssertion — shape validation (Layer 0)', () => {
  // Estos tests verifican las capas de validación inicial. Las capas más
  // profundas (crypto verification end-to-end con keys reales) están
  // cubiertas por src/__tests__/server/webauthnVerify.test.ts que monta
  // un Express harness completo con InMemoryFirestore.

  it('rechaza si falta credentialId', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      credentialId: '',
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si falta clientDataJSON', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      clientDataJSON: '',
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si falta authenticatorData', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      authenticatorData: '',
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si falta signature', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      signature: '',
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si falta challengeId', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      challengeId: '',
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si type no es "public-key"', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      type: 'invalid' as any,
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si clientExtensionResults es array (no objeto plano)', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,

      clientExtensionResults: [] as any,
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si clientExtensionResults es null', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,

      clientExtensionResults: null as any,
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'missing_field' });
  });

  it('rechaza si clientDataJSON es malformado (no es base64-JSON válido)', async () => {
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      // Base64 que decodea a string no-JSON
      clientDataJSON: Buffer.from('not json at all').toString('base64'),
      challengesDb: mockChallengesDb(),
      credentialsDb: mockCredentialsDb(),
    });
    expect(result).toEqual({ verified: false, reason: 'malformed_client_data' });
  });
});

// ─── Layer 5: counter monotonicity / clone-detection ────────────────────
//
// Drives the full happy path (challenge consumed, credential found+owned,
// signature verified) so the ONLY variable is the authenticator counter.
// The signed-challenge bytes must match VALID_INPUT's clientDataJSON
// challenge ("aaaaaaaaaaaaaaaa") so consumeWebAuthnChallenge succeeds.
const CHALLENGE_B64 = Buffer.from('aaaaaaaaaaaaaaaa').toString('base64');

function consumableChallengesDb() {
  return {
    now: () => 1000,
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ expiresAt: 100000, consumed: false, challengeB64: CHALLENGE_B64 }),
        }),
        updateIf: async () => true,
        set: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      }),
    }),
  } as any;
}

function credentialsDbWithCounter(storedCounter: number) {
  return {
    now: () => 1000,
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: true,
          id: 'cred-abc',
          data: () => ({
            credentialId: 'cred-abc',
            uid: 'user-1',
            publicKey: Buffer.from([1, 2, 3]).toString('base64'),
            counter: storedCounter,
            transports: ['internal'],
            registeredAt: 1,
            lastUsedAt: null,
          }),
        }),
        set: async () => undefined,
        update: async () => undefined,
        delete: async () => undefined,
      }),
    }),
  } as any;
}

describe('verifyWebAuthnAssertion — counter clone-detection (Layer 5)', () => {
  it('REJECTS a replayed counter of 0 when the stored counter is > 0 (clone bypass)', async () => {
    // A real authenticator advanced its counter to 5. An attacker replays a
    // cloned assertion reporting counter 0. The old `&& newCounter !== 0`
    // carve-out skipped the check for counter 0 → the clone was ACCEPTED.
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    } as any);
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      challengesDb: consumableChallengesDb(),
      credentialsDb: credentialsDbWithCounter(5),
    });
    expect(result).toEqual({ verified: false, reason: 'counter_not_monotonic' });
  });

  it('REJECTS an equal counter (classic replay)', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    } as any);
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      challengesDb: consumableChallengesDb(),
      credentialsDb: credentialsDbWithCounter(5),
    });
    expect(result).toEqual({ verified: false, reason: 'counter_not_monotonic' });
  });

  it('ACCEPTS a monotonically increasing counter', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    } as any);
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      challengesDb: consumableChallengesDb(),
      credentialsDb: credentialsDbWithCounter(5),
    });
    expect(result).toEqual({
      verified: true,
      newCounter: 6,
      verifiedCredentialId: 'cred-abc',
    });
  });

  it('ACCEPTS counter 0 when the authenticator never implemented a counter (stored 0)', async () => {
    mockVerify.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    } as any);
    const result = await verifyWebAuthnAssertion({
      ...VALID_INPUT,
      challengesDb: consumableChallengesDb(),
      credentialsDb: credentialsDbWithCounter(0),
    });
    expect(result).toEqual({
      verified: true,
      newCounter: 0,
      verifiedCredentialId: 'cred-abc',
    });
  });
});
