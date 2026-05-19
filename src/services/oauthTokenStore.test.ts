// SPDX-License-Identifier: MIT
//
// Unit tests for oauthTokenStore.getValidAccessToken focused on:
//   1. Per-identity lock (coalesce concurrent refresh calls)
//   2. Idempotency-Key header on the refresh POST
//
// Rationale: Without a lock, N concurrent calls for the same {uid,provider}
// each fire their own POST to googleapis. Worst case: Google rate-limits us
// or invalidates an in-flight refresh_token. Best case: just wasted bandwidth
// and an extra docRef.update race (last-write-wins).
//
// The test isolates the function from Firebase Admin + KMS so it can run as
// pure logic; it then drives concurrency via a manually-controlled fetch
// promise.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Firebase Admin mock ────────────────────────────────────────────────
const docGetMock = vi.fn();
const docUpdateMock = vi.fn();

vi.mock('firebase-admin', () => {
  const firestoreFn = Object.assign(
    () => ({
      collection: () => ({
        doc: () => ({
          get: docGetMock,
          update: docUpdateMock,
          set: vi.fn(),
          delete: vi.fn(),
        }),
      }),
    }),
    {
      FieldValue: { serverTimestamp: () => 'TS' },
    },
  );
  return {
    default: { firestore: firestoreFn },
  };
});

// ─── KMS stubs (we don't exercise the envelope path here) ──────────────
vi.mock('./security/kmsEnvelope.ts', () => ({
  envelopeEncrypt: vi.fn(),
  envelopeDecrypt: vi.fn(),
  isEnvelopeCiphertext: () => false,
}));
vi.mock('./security/kmsAdapter.ts', () => ({
  getKmsAdapter: vi.fn(),
}));

// ─── Import AFTER mocks are registered ─────────────────────────────────
import { getValidAccessToken } from './oauthTokenStore';

describe('getValidAccessToken — per-identity lock + idempotency', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    docGetMock.mockReset();
    docUpdateMock.mockReset();
    docUpdateMock.mockResolvedValue(undefined);
    // Snapshot of an expired token — forces the refresh path.
    docGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        access_token: 'expired_at_token',
        expiry_date: Date.now() - 1000,
        refresh_token: 'plaintext_refresh_token_legacy',
      }),
    });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('coalesces concurrent refresh calls for the same identity into a single POST', async () => {
    // Build a controllable fetch promise — resolves only when we say so.
    let resolveFetch!: (r: Response) => void;
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchPromise);

    const id = { uid: 'u1', provider: 'google' as const };

    // Fire two concurrent calls before the fetch promise resolves.
    const a = getValidAccessToken(id, 'cid', 'csec');
    const b = getValidAccessToken(id, 'cid', 'csec');

    // Yield a tick so the function bodies can advance to the fetch call.
    await new Promise((r) => setImmediate(r));

    // Release the upstream.
    resolveFetch(
      new Response(JSON.stringify({ access_token: 'fresh_token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const [tokenA, tokenB] = await Promise.all([a, b]);

    expect(tokenA).toBe('fresh_token');
    expect(tokenB).toBe('fresh_token');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // docRef.update should also fire once (not twice).
    expect(docUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock after refresh completes so subsequent calls refresh again if needed', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ access_token: 'fresh_token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const id = { uid: 'u1', provider: 'google' as const };

    // First call refreshes.
    await getValidAccessToken(id, 'cid', 'csec');
    // Second call — token still expired in our mock — refreshes again
    // because the in-flight lock has been released.
    await getValidAccessToken(id, 'cid', 'csec');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('releases the lock on failure too (no permanent deadlock)', async () => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'recovered_token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const id = { uid: 'u1', provider: 'google' as const };

    const first = await getValidAccessToken(id, 'cid', 'csec');
    const second = await getValidAccessToken(id, 'cid', 'csec');

    expect(first).toBeNull(); // failure path returns null
    expect(second).toBe('recovered_token'); // lock was released; recovery works
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps locks independent per identity (different uid_provider keys do not block each other)', async () => {
    let resolveU1!: (r: Response) => void;
    let resolveU2!: (r: Response) => void;

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const body = init?.body?.toString() ?? '';
      // Different refresh_tokens → distinct upstream calls.
      if (body.includes('refresh_token=plaintext_refresh_token_legacy')) {
        return new Promise<Response>((res) => {
          // First call (u1).
          if (!resolveU1) resolveU1 = res;
          else resolveU2 = res;
        });
      }
      return Promise.resolve(new Response('', { status: 500 }));
    });

    const idA = { uid: 'u1', provider: 'google' as const };
    const idB = { uid: 'u2', provider: 'google' as const };

    const a = getValidAccessToken(idA, 'cid', 'csec');
    const b = getValidAccessToken(idB, 'cid', 'csec');

    await new Promise((r) => setImmediate(r));

    // Both should be in-flight independently — verify by resolving in
    // inverse order and confirming both complete.
    resolveU2!(
      new Response(JSON.stringify({ access_token: 'token_u2', expires_in: 3600 }), {
        status: 200,
      }),
    );
    resolveU1!(
      new Response(JSON.stringify({ access_token: 'token_u1', expires_in: 3600 }), {
        status: 200,
      }),
    );

    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toBe('token_u1');
    expect(resB).toBe('token_u2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('attaches an Idempotency-Key header to the refresh POST', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
        status: 200,
      }),
    );

    await getValidAccessToken({ uid: 'u1', provider: 'google' }, 'cid', 'csec');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeDefined();
    expect(typeof headers['Idempotency-Key']).toBe('string');
    expect(headers['Idempotency-Key'].length).toBeGreaterThan(8);
  });
});
