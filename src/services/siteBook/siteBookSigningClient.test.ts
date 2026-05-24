// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §D.X — client orchestrator tests.
//
// Mockea `fetch` + `navigator.credentials.get` para verificar el flow
// completo end-to-end SIN un browser real ni un servidor real.
//
// El test enfoca tres cosas:
//   1. El cliente POSTea el payloadHash correcto al issue-challenge.
//   2. El cliente llama `navigator.credentials.get` con el challenge
//      retornado por el server (NO uno random local).
//   3. El cliente POSTea la assertion al verify endpoint y devuelve la
//      entry firmada.

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signSiteBookEntryWithWebAuthn } from './siteBookSigningClient';
import type { SiteBookEntry } from './siteBookService';

function makeEntry(overrides: Partial<SiteBookEntry> = {}): SiteBookEntry {
  return {
    id: 'entry-42',
    projectId: 'proj-A',
    folio: 'SB-2026-000042',
    year: 2026,
    sequenceNumber: 42,
    kind: 'inspection',
    occurredAt: '2026-05-24T10:00:00.000Z',
    recordedAt: '2026-05-24T11:00:00.000Z',
    recordedByUid: 'uid-juan',
    recordedByRole: 'supervisor',
    description: 'Inspección rutinaria sin observaciones en el frente A',
    status: 'open',
    ...overrides,
  };
}

// ─── Mock navigator.credentials.get ───────────────────────────────────────
type AnyMock = ReturnType<typeof vi.fn>;
const credentialsGetMock: AnyMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    credentials: {
      get: credentialsGetMock,
    },
  });
  // jsdom no expone PublicKeyCredential — el client lo chequea para
  // gating de feature-detection.
  vi.stubGlobal('PublicKeyCredential', class FakePublicKeyCredential {});
  credentialsGetMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeAssertionPublicKeyCredential(): unknown {
  // Browser PublicKeyCredential shape — fields are ArrayBuffers. We use
  // small fixed buffers so the base64url encoding is predictable.
  const enc = (s: string) => new TextEncoder().encode(s).buffer;
  return {
    id: 'cred-id-fake',
    rawId: enc('cred-id-fake'),
    type: 'public-key',
    response: {
      clientDataJSON: enc('{"challenge":"abc"}'),
      authenticatorData: enc('auth-data-bytes'),
      signature: enc('sig-bytes'),
    },
    authenticatorAttachment: 'platform' as const,
    getClientExtensionResults: () => ({}),
  };
}

describe('signSiteBookEntryWithWebAuthn', () => {
  it('orquesta el flow: options → credentials.get → verify, devuelve entry firmada', async () => {
    const entry = makeEntry();
    const fetchMock = vi.fn();

    // Mock 1: /api/sitebook/sign/options → returns challenge + allowCredentials.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          challengeB64u: 'AAECAwQFBg', // 7 bytes of fake challenge
          challengeId: 'chal-id-1',
          allowCredentials: [
            { id: 'cred-id-fake', type: 'public-key', transports: ['internal'] },
          ],
          rpId: 'localhost',
          timeoutMs: 60000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    // navigator.credentials.get resolves with a fake PublicKeyCredential.
    credentialsGetMock.mockResolvedValueOnce(fakeAssertionPublicKeyCredential());

    // Mock 2: /api/sitebook/sign/verify → returns the signed entry.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entry: {
            ...entry,
            status: 'signed',
            signature: {
              signerUid: 'uid-juan',
              signedAt: '2026-05-24T11:30:00.000Z',
              algorithm: 'webauthn-ecdsa-p256',
              payloadHashHex: 'placeholder',
              credentialId: 'cred-id-fake',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const signed = await signSiteBookEntryWithWebAuthn(entry, {
      authHeader: 'Bearer token-xyz',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(signed.status).toBe('signed');
    expect(signed.signature?.algorithm).toBe('webauthn-ecdsa-p256');
    expect(signed.signature?.credentialId).toBe('cred-id-fake');

    // Verify request order + payloads.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // First call: /options with payloadHashHex
    const firstCall = fetchMock.mock.calls[0];
    expect(String(firstCall[0])).toContain('/api/sitebook/sign/options');
    const firstBody = JSON.parse((firstCall[1] as { body: string }).body);
    expect(firstBody.entryId).toBe('entry-42');
    expect(firstBody.projectId).toBe('proj-A');
    expect(firstBody.payloadHashHex).toMatch(/^[0-9a-f]{64}$/);

    // credentials.get must have used the challenge from the server.
    expect(credentialsGetMock).toHaveBeenCalledTimes(1);
    const credArg = credentialsGetMock.mock.calls[0][0] as {
      publicKey: { challenge: ArrayBuffer; allowCredentials: unknown[] };
    };
    expect(credArg.publicKey.challenge).toBeInstanceOf(ArrayBuffer);
    expect(credArg.publicKey.allowCredentials).toHaveLength(1);

    // Second call: /verify with the assertion
    const secondCall = fetchMock.mock.calls[1];
    expect(String(secondCall[0])).toContain('/api/sitebook/sign/verify');
    const secondBody = JSON.parse((secondCall[1] as { body: string }).body);
    expect(secondBody.challengeId).toBe('chal-id-1');
    expect(secondBody.entryId).toBe('entry-42');
    expect(secondBody.assertion.credentialId).toBe('cred-id-fake');
    expect(typeof secondBody.assertion.clientDataJSONB64u).toBe('string');
    expect(typeof secondBody.assertion.signatureB64u).toBe('string');
  });

  it('tira WebAuthnNotSupportedError si navigator.credentials ausente', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('PublicKeyCredential', undefined);
    await expect(
      signSiteBookEntryWithWebAuthn(makeEntry(), {
        authHeader: 'Bearer x',
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no soportad/i);
  });

  it('tira si el endpoint /options responde non-OK', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('forbidden', { status: 403 }),
    );
    await expect(
      signSiteBookEntryWithWebAuthn(makeEntry(), {
        authHeader: 'Bearer x',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/sign_options_failed:403/);
  });

  it('mapea NotAllowedError del browser a SignCancelledError', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          challengeB64u: 'AAECAwQFBg',
          challengeId: 'chal-1',
          allowCredentials: [],
        }),
        { status: 200 },
      ),
    );
    // DOMException(name) sets `name` via the constructor's second arg —
    // `name` is a getter, so Object.assign would throw. The constructor
    // form is the only way to set it.
    credentialsGetMock.mockRejectedValueOnce(
      new DOMException('user cancelled', 'NotAllowedError'),
    );
    await expect(
      signSiteBookEntryWithWebAuthn(makeEntry(), {
        authHeader: 'Bearer x',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: 'SignCancelledError' });
  });

  it('tira si /verify responde non-OK', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          challengeB64u: 'AAECAwQFBg',
          challengeId: 'chal-1',
          allowCredentials: [],
        }),
        { status: 200 },
      ),
    );
    credentialsGetMock.mockResolvedValueOnce(fakeAssertionPublicKeyCredential());
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ verified: false, reason: 'signature_invalid' }), {
        status: 400,
      }),
    );
    await expect(
      signSiteBookEntryWithWebAuthn(makeEntry(), {
        authHeader: 'Bearer x',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/sign_verify_failed/);
  });

  it('no permite firmar una entry que ya está signed', async () => {
    await expect(
      signSiteBookEntryWithWebAuthn(makeEntry({ status: 'signed' }), {
        authHeader: 'Bearer x',
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/ya está firmada|already signed/i);
  });
});
