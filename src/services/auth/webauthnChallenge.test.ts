// Praeventio Guard — Round 17 (R5 agent): WebAuthn challenge cache.
//
// Closes the Round 16 R6 finding: the WebAuthn proof-of-presence flow
// in useBiometricAuth.ts generated its challenge client-side, which is
// trivially replay-vulnerable. ISO 27001 §A.9.4.1 requires a server-
// issued, single-use challenge bound to a TTL.
//
// Contract under test:
//   • generateWebAuthnChallenge() returns a fresh 32-byte random buffer
//     and a 64-char hex challengeId. Both are produced from
//     `crypto.randomBytes` so consecutive calls don't collide.
//   • storeWebAuthnChallenge writes a doc at
//     webauthn_challenges/{uid}_{challengeId} with the b64-encoded
//     challenge, server timestamp, consumed:false, and an absolute
//     `expiresAt` 5 minutes in the future.
//   • consumeWebAuthnChallenge:
//       * Reads the doc by id.
//       * Rejects valid:false with reason='unknown' when missing.
//       * Rejects valid:false with reason='expired' when now > expiresAt.
//       * Rejects valid:false with reason='consumed' when already used.
//       * Rejects valid:false with reason='mismatch' when the inbound
//         challenge byte string doesn't match.
//       * On success: marks consumed:true via a CONDITIONAL update
//         (precondition: consumed:false + matching id) so two concurrent
//         consume() calls can't both win — one sees `consumed:false → true`,
//         the other sees the post-update state and is rejected.
//
// We DO NOT mock firebase-admin globally; the service takes a
// `MinimalChallengesDb` injection so tests use an in-memory fake. This
// mirrors how curriculum/claims.ts is tested.

import { describe, it, expect, vi } from 'vitest';
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
  consumeWebAuthnChallenge,
  type MinimalChallengesDb,
} from './webauthnChallenge.js';

interface FakeDoc {
  data: Record<string, unknown>;
}

function makeFakeDb(now: () => number = () => Date.now()): {
  db: MinimalChallengesDb;
  store: Map<string, FakeDoc>;
} {
  const store = new Map<string, FakeDoc>();
  const db: MinimalChallengesDb = {
    collection(name: string) {
      expect(name).toBe('webauthn_challenges');
      return {
        doc(id: string) {
          return {
            async get() {
              const doc = store.get(id);
              return {
                exists: !!doc,
                id,
                data: () => doc?.data,
              };
            },
            async set(data: Record<string, unknown>) {
              store.set(id, { data: { ...data } });
            },
            // Conditional update: only succeeds when the precondition
            // checker returns true against the current data. Mimics
            // Firestore transaction semantics for our use case.
            async updateIf(
              precondition: (current: Record<string, unknown> | undefined) => boolean,
              patch: Record<string, unknown>,
            ): Promise<boolean> {
              const cur = store.get(id)?.data;
              if (!precondition(cur)) return false;
              store.set(id, { data: { ...(cur ?? {}), ...patch } });
              return true;
            },
          };
        },
      };
    },
    now,
  };
  return { db, store };
}

describe('generateWebAuthnChallenge', () => {
  it('returns a 32-byte challenge buffer + 64-char hex id', () => {
    const out = generateWebAuthnChallenge();
    expect(out.challenge).toBeInstanceOf(Uint8Array);
    expect(out.challenge.byteLength).toBe(32);
    expect(out.challengeId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns unique challengeIds across 1000 calls (256 bits of entropy)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateWebAuthnChallenge().challengeId);
    }
    expect(ids.size).toBe(1000);
  });
});

describe('storeWebAuthnChallenge', () => {
  it('writes the challenge to webauthn_challenges/{uid}_{challengeId}', async () => {
    const { db, store } = makeFakeDb();
    const challenge = new Uint8Array([1, 2, 3, 4]);
    await storeWebAuthnChallenge('uid-1', 'cid-A', challenge, db, { ttlMs: 5 * 60 * 1000 });
    const doc = store.get('uid-1_cid-A');
    expect(doc).toBeDefined();
    expect(doc!.data.uid).toBe('uid-1');
    expect(doc!.data.consumed).toBe(false);
    expect(typeof doc!.data.challengeB64).toBe('string');
    // base64 of [1,2,3,4]
    expect(doc!.data.challengeB64).toBe(Buffer.from(challenge).toString('base64'));
    expect(doc!.data.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('consumeWebAuthnChallenge', () => {
  it('returns valid:true when challenge matches, not expired, not consumed', async () => {
    const { db } = makeFakeDb();
    const challenge = new Uint8Array([7, 7, 7]);
    await storeWebAuthnChallenge('uid-2', 'cid-B', challenge, db);
    const out = await consumeWebAuthnChallenge('uid-2', 'cid-B', challenge, db);
    expect(out.valid).toBe(true);
  });

  it('rejects with reason=unknown when the challengeId does not exist', async () => {
    const { db } = makeFakeDb();
    const out = await consumeWebAuthnChallenge(
      'uid-3',
      'never-stored',
      new Uint8Array([0]),
      db,
    );
    expect(out).toEqual({ valid: false, reason: 'unknown' });
  });

  it('rejects with reason=expired when now > expiresAt', async () => {
    let fakeNow = 1_000_000_000_000;
    const { db } = makeFakeDb(() => fakeNow);
    const challenge = new Uint8Array([1]);
    await storeWebAuthnChallenge('uid-4', 'cid-X', challenge, db, { ttlMs: 1000 });
    fakeNow += 5000; // 5s later — past TTL.
    const out = await consumeWebAuthnChallenge('uid-4', 'cid-X', challenge, db);
    expect(out).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects with reason=mismatch when the inbound bytes differ', async () => {
    const { db } = makeFakeDb();
    await storeWebAuthnChallenge('uid-5', 'cid-Y', new Uint8Array([1, 2, 3]), db);
    const out = await consumeWebAuthnChallenge(
      'uid-5',
      'cid-Y',
      new Uint8Array([9, 9, 9]),
      db,
    );
    expect(out).toEqual({ valid: false, reason: 'mismatch' });
  });

  it('rejects with reason=consumed on a second consume of the same challenge', async () => {
    const { db } = makeFakeDb();
    const challenge = new Uint8Array([5, 5, 5]);
    await storeWebAuthnChallenge('uid-6', 'cid-Z', challenge, db);
    const first = await consumeWebAuthnChallenge('uid-6', 'cid-Z', challenge, db);
    expect(first.valid).toBe(true);
    const second = await consumeWebAuthnChallenge('uid-6', 'cid-Z', challenge, db);
    expect(second).toEqual({ valid: false, reason: 'consumed' });
  });

  it('marks the doc consumed:true on success (cleanup-on-consume)', async () => {
    const { db, store } = makeFakeDb();
    const challenge = new Uint8Array([2, 4, 6]);
    await storeWebAuthnChallenge('uid-7', 'cid-W', challenge, db);
    expect(store.get('uid-7_cid-W')!.data.consumed).toBe(false);
    await consumeWebAuthnChallenge('uid-7', 'cid-W', challenge, db);
    expect(store.get('uid-7_cid-W')!.data.consumed).toBe(true);
  });

  it('honours the TTL boundary — exactly-at-expiry counts as expired', async () => {
    let fakeNow = 2_000_000_000_000;
    const { db } = makeFakeDb(() => fakeNow);
    const challenge = new Uint8Array([1]);
    await storeWebAuthnChallenge('uid-8', 'cid-T', challenge, db, { ttlMs: 1000 });
    fakeNow += 1000; // exactly equal to expiresAt — treat as expired.
    const out = await consumeWebAuthnChallenge('uid-8', 'cid-T', challenge, db);
    expect(out).toEqual({ valid: false, reason: 'expired' });
  });

  it('serialises concurrent consumes — exactly one wins (race condition)', async () => {
    // Both calls observe consumed:false, but only one's conditional
    // update should succeed. The other gets reason='consumed' (or
    // 'race' — either is acceptable per the contract; we assert that
    // exactly ONE valid:true result is observed).
    const { db } = makeFakeDb();
    const challenge = new Uint8Array([3, 1, 4, 1, 5, 9]);
    await storeWebAuthnChallenge('uid-9', 'cid-R', challenge, db);
    const [a, b] = await Promise.all([
      consumeWebAuthnChallenge('uid-9', 'cid-R', challenge, db),
      consumeWebAuthnChallenge('uid-9', 'cid-R', challenge, db),
    ]);
    const wins = [a, b].filter((r) => r.valid).length;
    expect(wins).toBe(1);
  });

  it('does not crash when the db throws — propagates the error', async () => {
    const brokenDb: MinimalChallengesDb = {
      now: () => Date.now(),
      collection() {
        return {
          doc() {
            return {
              get: vi.fn(async () => {
                throw new Error('firestore unreachable');
              }),
              set: vi.fn(),
              updateIf: vi.fn(async () => false),
            };
          },
        };
      },
    };
    await expect(
      consumeWebAuthnChallenge('uid-X', 'cid-X', new Uint8Array([1]), brokenDb),
    ).rejects.toThrow(/firestore unreachable/);
  });
});
