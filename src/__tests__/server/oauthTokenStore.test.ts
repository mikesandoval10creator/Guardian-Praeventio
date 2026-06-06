// Unit tests for src/services/oauthTokenStore.ts — B17 default-ON envelope.
//
// The refresh_token is a long-lived bearer credential. As of B17 it is
// envelope-encrypted at rest BY DEFAULT (opt out with
// OAUTH_ENVELOPE_ENABLED=false). The KMS layer (kmsEnvelope + kmsAdapter) is
// REAL here — the default in-memory-dev adapter uses a deterministic AES key,
// so we can assert the stored shape and round-trip without any network/KMS.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

import { saveTokens, getValidAccessToken, type TokenIdentity } from '../../services/oauthTokenStore.ts';
import { isEnvelopeCiphertext } from '../../services/security/kmsEnvelope.ts';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const ID: TokenIdentity = { uid: 'uid-1', provider: 'google' };
const docKey = 'oauth_tokens/uid-1_google';

function storedRefreshToken(): unknown {
  return (H.db!._store.get(docKey) as Record<string, unknown> | undefined)?.refresh_token;
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('oauthTokenStore — envelope default-ON (B17)', () => {
  it('encrypts the refresh_token by default (no flag set) — stored value is an envelope, not plaintext', async () => {
    // No OAUTH_ENVELOPE_ENABLED set → default-ON.
    await saveTokens(ID, { access_token: 'at-1', refresh_token: 'super-secret-refresh', expires_in: 3600 });
    const stored = storedRefreshToken();
    expect(typeof stored).not.toBe('string');
    expect(isEnvelopeCiphertext(stored)).toBe(true);
    // The plaintext must NOT appear anywhere in the stored doc.
    expect(JSON.stringify(H.db!._store.get(docKey))).not.toContain('super-secret-refresh');
  });

  it('stores plaintext when explicitly opted out (OAUTH_ENVELOPE_ENABLED=false)', async () => {
    vi.stubEnv('OAUTH_ENVELOPE_ENABLED', 'false');
    await saveTokens(ID, { access_token: 'at-1', refresh_token: 'plain-refresh', expires_in: 3600 });
    expect(storedRefreshToken()).toBe('plain-refresh');
  });

  it('still encrypts when the flag is explicitly "true"', async () => {
    vi.stubEnv('OAUTH_ENVELOPE_ENABLED', 'true');
    await saveTokens(ID, { access_token: 'at-1', refresh_token: 'r', expires_in: 3600 });
    expect(isEnvelopeCiphertext(storedRefreshToken())).toBe(true);
  });

  it('degrades to plaintext (no throw) when envelope is on but the KMS adapter is unavailable', async () => {
    // cloud-kms is selected but KMS_KEY_RESOURCE_NAME is unset → adapter
    // isAvailable=false. Must NOT break the OAuth flow — fall back to plaintext.
    vi.stubEnv('KMS_ADAPTER', 'cloud-kms');
    await expect(
      saveTokens(ID, { access_token: 'at-1', refresh_token: 'degraded-refresh', expires_in: 3600 }),
    ).resolves.toBeUndefined();
    expect(storedRefreshToken()).toBe('degraded-refresh');
  });

  it('round-trips: an enveloped refresh_token is unwrapped to refresh an expired access_token', async () => {
    // Save with envelope (default-ON), then force a refresh by expiring the access token.
    await saveTokens(ID, { access_token: 'old-at', refresh_token: 'rt-roundtrip', expires_in: 3600 });
    expect(isEnvelopeCiphertext(storedRefreshToken())).toBe(true);
    // Expire the stored access token.
    H.db!._store.set(docKey, { ...(H.db!._store.get(docKey) as Record<string, unknown>), expiry_date: Date.now() - 1000 });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'new-at', expires_in: 3600 }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const token = await getValidAccessToken(ID, 'client-id', 'client-secret');
    expect(token).toBe('new-at');
    // The unwrapped plaintext refresh_token was sent to Google's token endpoint.
    const body = (fetchMock.mock.calls[0] as unknown[])[1] as { body: URLSearchParams };
    expect(body.body.toString()).toContain('refresh_token=rt-roundtrip');
  });

  it('reads a LEGACY plaintext refresh_token (backward compatible) to refresh', async () => {
    // Seed a pre-envelope doc: refresh_token as a plain string, expired access.
    H.db!._seed(docKey, {
      access_token: 'old-at',
      refresh_token: 'legacy-plain-rt',
      expiry_date: Date.now() - 1000,
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'new-at', expires_in: 3600 }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const token = await getValidAccessToken(ID, 'client-id', 'client-secret');
    expect(token).toBe('new-at');
    const body = (fetchMock.mock.calls[0] as unknown[])[1] as { body: URLSearchParams };
    expect(body.body.toString()).toContain('refresh_token=legacy-plain-rt');
  });
});
