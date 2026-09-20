// Praeventio Guard — Round 19 (R19 A5 agent): WebAuthn credential store
// unit tests.
//
// Closes the M1 gap left by R18 R6: the /api/auth/webauthn/verify
// handler needs a per-uid credential lookup before it can call
// @simplewebauthn/server's `verifyAuthenticationResponse`. This suite
// pins the public-key persistence contract.
//
// Coverage matrix:
//   • registerCredential — happy path + validation errors
//   • registerCredential — idempotent re-register replaces the row
//   • getCredentialsByUid — returns empty array when uid has no creds
//   • getCredentialsByUid — returns N rows when N creds registered
//   • findByCredentialId — returns null for unknown id
//   • findByCredentialId — returns the registered credential
//   • updateCounter — writes counter + lastUsedAt
//   • updateCounter — validation errors
//   • decodePublicKey — round-trips bytes through base64
//
// Same dependency-injection pattern as webauthnChallenge.test.ts:
// in-memory fake DB so we don't need firebase-admin in unit tests.

import { describe, it, expect } from 'vitest';
import {
  registerCredential,
  getCredentialsByUid,
  findByCredentialId,
  deleteCredentialById,
  deleteCredentialsByUid,
  updateCounter,
  compareAndSwapCounter,
  decodePublicKey,
  type MinimalCredentialsDb,
} from './webauthnCredentialStore.js';

interface FakeDoc {
  data: Record<string, unknown>;
}

function makeFakeDb(now: () => number = () => Date.now()): {
  db: MinimalCredentialsDb;
  store: Map<string, FakeDoc>;
} {
  const store = new Map<string, FakeDoc>();
  const db: MinimalCredentialsDb = {
    collection(name: string) {
      expect(name).toBe('webauthn_credentials');
      return {
        doc(id: string) {
          return {
            __docId: id,
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
            async update(patch: Record<string, unknown>) {
              const cur = store.get(id);
              if (!cur) throw new Error('document does not exist');
              store.set(id, { data: { ...cur.data, ...patch } });
            },
            async delete() {
              store.delete(id);
            },
          };
        },
        where(field: string, _op: '==', value: unknown) {
          return {
            async get() {
              const docs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
              for (const [id, doc] of store.entries()) {
                if (doc.data[field] === value) {
                  docs.push({ id, data: () => doc.data });
                }
              }
              return { empty: docs.length === 0, docs };
            },
          };
        },
      };
    },
    async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
      // Simulated transaction: queue writes, apply atomically at the end
      // OR roll back if the body throws. Reads are inline against the
      // current store. This is NOT a true multi-process concurrency
      // simulation (single-threaded JS), but it pins the contract: the
      // CAS guard inside the txn sees a coherent pre-state.
      const writes: Array<{ id: string; patch?: Record<string, unknown>; set?: Record<string, unknown>; del?: boolean }> = [];
      const tx = {
        async get(ref: any) {
          const id = ref?.__docId;
          if (!id) throw new Error('tx.get requires a doc ref from db.collection(...).doc(...)');
          const doc = store.get(id);
          return { exists: !!doc, id, data: () => doc?.data };
        },
        async update(ref: any, patch: Record<string, unknown>) {
          const id = ref?.__docId;
          if (!id) throw new Error('tx.update requires a doc ref');
          writes.push({ id, patch });
        },
      };
      const result = await updateFn(tx);
      // Commit atomically.
      for (const w of writes) {
        if (w.del) { store.delete(w.id); continue; }
        if (w.set) { store.set(w.id, { data: { ...w.set } }); continue; }
        if (w.patch) {
          const cur = store.get(w.id);
          if (!cur) throw new Error('document does not exist');
          store.set(w.id, { data: { ...cur.data, ...w.patch } });
        }
      }
      return result;
    },
    now,
  };
  return { db, store };
}

describe('registerCredential', () => {
  it('writes the credential to webauthn_credentials/{credentialId}', async () => {
    const { db, store } = makeFakeDb(() => 1_700_000_000_000);
    const pubkey = new Uint8Array([1, 2, 3, 4, 5]);
    await registerCredential(
      'uid-1',
      { credentialId: 'cred-A', publicKey: pubkey, counter: 0, transports: ['internal'] },
      db,
    );
    const doc = store.get('cred-A');
    expect(doc).toBeDefined();
    expect(doc!.data.uid).toBe('uid-1');
    expect(doc!.data.credentialId).toBe('cred-A');
    expect(doc!.data.publicKey).toBe(Buffer.from(pubkey).toString('base64'));
    expect(doc!.data.counter).toBe(0);
    expect(doc!.data.transports).toEqual(['internal']);
    expect(doc!.data.registeredAt).toBe(1_700_000_000_000);
    expect(doc!.data.lastUsedAt).toBeNull();
  });

  it('rejects empty uid', async () => {
    const { db } = makeFakeDb();
    await expect(
      registerCredential(
        '',
        { credentialId: 'cred-A', publicKey: new Uint8Array([1]), counter: 0 },
        db,
      ),
    ).rejects.toThrow(/uid/);
  });

  it('rejects empty credentialId', async () => {
    const { db } = makeFakeDb();
    await expect(
      registerCredential(
        'uid-1',
        { credentialId: '', publicKey: new Uint8Array([1]), counter: 0 },
        db,
      ),
    ).rejects.toThrow(/credentialId/);
  });

  it('rejects empty publicKey', async () => {
    const { db } = makeFakeDb();
    await expect(
      registerCredential(
        'uid-1',
        { credentialId: 'cred-A', publicKey: new Uint8Array([]), counter: 0 },
        db,
      ),
    ).rejects.toThrow(/publicKey/);
  });

  it('rejects negative counter', async () => {
    const { db } = makeFakeDb();
    await expect(
      registerCredential(
        'uid-1',
        { credentialId: 'cred-A', publicKey: new Uint8Array([1]), counter: -1 },
        db,
      ),
    ).rejects.toThrow(/[Cc]ounter/);
  });

  it('overwrites prior credential on re-register (idempotent)', async () => {
    const { db, store } = makeFakeDb();
    await registerCredential(
      'uid-1',
      { credentialId: 'cred-A', publicKey: new Uint8Array([1, 1, 1]), counter: 5 },
      db,
    );
    await registerCredential(
      'uid-1',
      { credentialId: 'cred-A', publicKey: new Uint8Array([2, 2, 2]), counter: 0 },
      db,
    );
    const doc = store.get('cred-A');
    expect(doc!.data.publicKey).toBe(Buffer.from([2, 2, 2]).toString('base64'));
    expect(doc!.data.counter).toBe(0);
  });

  // H25b.1 audit (2026-05-19) — pin base64url-without-padding contract.
  // Catches encoding drift between register-time (simplewebauthn output) and
  // assert-time (browser PublicKeyCredential.id) that would otherwise show
  // up as opaque "unknown_credential" 401s on every later sign-in.
  describe('credentialId base64url contract', () => {
    it('rejects credentialId with base64 standard "+" character', async () => {
      const { db } = makeFakeDb();
      await expect(
        registerCredential(
          'uid-1',
          { credentialId: 'cred+plus', publicKey: new Uint8Array([1]), counter: 0 },
          db,
        ),
      ).rejects.toThrow(/base64url/);
    });

    it('rejects credentialId with base64 standard "/" character', async () => {
      const { db } = makeFakeDb();
      await expect(
        registerCredential(
          'uid-1',
          { credentialId: 'cred/slash', publicKey: new Uint8Array([1]), counter: 0 },
          db,
        ),
      ).rejects.toThrow(/base64url/);
    });

    it('rejects credentialId with padding "="', async () => {
      const { db } = makeFakeDb();
      await expect(
        registerCredential(
          'uid-1',
          { credentialId: 'credPadded==', publicKey: new Uint8Array([1]), counter: 0 },
          db,
        ),
      ).rejects.toThrow(/base64url/);
    });

    it('rejects credentialId with leading/trailing whitespace', async () => {
      const { db } = makeFakeDb();
      await expect(
        registerCredential(
          'uid-1',
          { credentialId: ' credA ', publicKey: new Uint8Array([1]), counter: 0 },
          db,
        ),
      ).rejects.toThrow(/base64url/);
    });

    it('accepts realistic base64url credentialIds (alphanumeric + - + _)', async () => {
      const { db } = makeFakeDb();
      // Mirrors what @simplewebauthn/server returns via isoBase64URL.fromBuffer.
      const realistic = 'AQIDBAUGBwgJ-_AwMTIzNDU2Nzg5';
      await expect(
        registerCredential(
          'uid-1',
          { credentialId: realistic, publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
          db,
        ),
      ).resolves.not.toThrow();
    });

    it('roundtrips: id used at register === id queried at assert', async () => {
      const { db } = makeFakeDb();
      const id = 'roundtrip_id-test_AQIDBA';
      await registerCredential(
        'uid-1',
        { credentialId: id, publicKey: new Uint8Array([9, 8, 7]), counter: 0 },
        db,
      );
      const found = await findByCredentialId(id, db);
      expect(found).not.toBeNull();
      expect(found!.uid).toBe('uid-1');
      expect(found!.credential.credentialId).toBe(id);
    });
  });
});

describe('getCredentialsByUid', () => {
  it('returns empty array when uid has no credentials', async () => {
    const { db } = makeFakeDb();
    const out = await getCredentialsByUid('uid-empty', db);
    expect(out).toEqual([]);
  });

  it('returns all credentials for the uid', async () => {
    const { db } = makeFakeDb();
    await registerCredential(
      'uid-1',
      { credentialId: 'cred-A', publicKey: new Uint8Array([1]), counter: 0 },
      db,
    );
    await registerCredential(
      'uid-1',
      { credentialId: 'cred-B', publicKey: new Uint8Array([2]), counter: 0 },
      db,
    );
    await registerCredential(
      'uid-2',
      { credentialId: 'cred-C', publicKey: new Uint8Array([3]), counter: 0 },
      db,
    );
    const out = await getCredentialsByUid('uid-1', db);
    expect(out.length).toBe(2);
    expect(out.map((c) => c.credentialId).sort()).toEqual(['cred-A', 'cred-B']);
    expect(out.every((c) => c.uid === 'uid-1')).toBe(true);
  });
});

describe('findByCredentialId', () => {
  it('returns null when the credentialId does not exist', async () => {
    const { db } = makeFakeDb();
    const out = await findByCredentialId('never-stored', db);
    expect(out).toBeNull();
  });

  it('returns null when credentialId is empty', async () => {
    const { db } = makeFakeDb();
    const out = await findByCredentialId('', db);
    expect(out).toBeNull();
  });

  it('returns the credential + uid for a registered id', async () => {
    const { db } = makeFakeDb();
    const pubkey = new Uint8Array([9, 9, 9]);
    await registerCredential(
      'uid-find',
      { credentialId: 'cred-find', publicKey: pubkey, counter: 7 },
      db,
    );
    const out = await findByCredentialId('cred-find', db);
    expect(out).not.toBeNull();
    expect(out!.uid).toBe('uid-find');
    expect(out!.credential.credentialId).toBe('cred-find');
    expect(out!.credential.counter).toBe(7);
    expect(out!.credential.publicKey).toBe(Buffer.from(pubkey).toString('base64'));
  });
});

describe('deleteCredentialById', () => {
  it('deletes a registered credential and returns true', async () => {
    const { db, store } = makeFakeDb();
    await registerCredential(
      'uid-del',
      { credentialId: 'cred-del', publicKey: new Uint8Array([1, 2]), counter: 0 },
      db,
    );
    expect(store.has('cred-del')).toBe(true);
    const deleted = await deleteCredentialById('cred-del', db);
    expect(deleted).toBe(true);
    expect(store.has('cred-del')).toBe(false);
  });

  it('returns false when the credentialId is not registered (no read-then-404 needed)', async () => {
    const { db } = makeFakeDb();
    const deleted = await deleteCredentialById('never-stored', db);
    expect(deleted).toBe(false);
  });

  it('rejects an empty credentialId', async () => {
    const { db } = makeFakeDb();
    await expect(deleteCredentialById('', db)).rejects.toThrow(/credentialId is required/);
  });
});

describe('updateCounter', () => {
  it('updates the counter + lastUsedAt fields', async () => {
    const { db, store } = makeFakeDb(() => 1_800_000_000_000);
    await registerCredential(
      'uid-cnt',
      { credentialId: 'cred-cnt', publicKey: new Uint8Array([1]), counter: 3 },
      db,
    );
    await updateCounter('cred-cnt', 4, db);
    const doc = store.get('cred-cnt');
    expect(doc!.data.counter).toBe(4);
    expect(doc!.data.lastUsedAt).toBe(1_800_000_000_000);
  });

  it('rejects empty credentialId', async () => {
    const { db } = makeFakeDb();
    await expect(updateCounter('', 1, db)).rejects.toThrow(/credentialId/);
  });

  it('rejects negative counter', async () => {
    const { db } = makeFakeDb();
    await expect(updateCounter('cred-X', -1, db)).rejects.toThrow(/[Cc]ounter/);
  });

  // [Hy3-audit] Adversarial: compareAndSwapCounter — atomic monotony guard.
  // Resolves [Audit-2026-08-31] WebAuthn \u2014 counter read-then-write is not
  // atomic under concurrency. Without this guard, two simultaneous valid
  // assertions can both observe stored=N, both validate newCounter=N+1>N,
  // and both write N+1 \u2014 leaving the counter regressing when the order
  // is reversed. We split updateCounter into a non-atomic helper (legacy)
  // and a strict compareAndSwapCounter that enforces monotonicity inside
  // a single transaction.
  describe('compareAndSwapCounter', () => {
    it('allows update when stored counter is 0 (authenticator without counter)', async () => {
      const { db, store } = makeFakeDb();
      await registerCredential(
        'uid-cas',
        { credentialId: 'cred-cas', publicKey: new Uint8Array([1]), counter: 0 },
        db,
      );
      // stored=0 \u2192 any newCounter allowed (current policy; mirrors
      // curriculum.ts:838 and webauthnAssertion.ts:224).
      await compareAndSwapCounter('cred-cas', 0, db);
      expect(store.get('cred-cas')!.data.counter).toBe(0);
      await compareAndSwapCounter('cred-cas', 5, db);
      expect(store.get('cred-cas')!.data.counter).toBe(5);
    });

    it('updates when newCounter > stored counter (normal happy path)', async () => {
      const { db, store } = makeFakeDb(() => 1_900_000_000_000);
      await registerCredential(
        'uid-cas-happy',
        { credentialId: 'cred-cas-happy', publicKey: new Uint8Array([1]), counter: 7 },
        db,
      );
      await compareAndSwapCounter('cred-cas-happy', 8, db);
      const doc = store.get('cred-cas-happy');
      expect(doc!.data.counter).toBe(8);
      expect(doc!.data.lastUsedAt).toBe(1_900_000_000_000);
    });

    it('THROWS counter_not_monotonic when newCounter <= stored (replay/cloning detected)', async () => {
      const { db } = makeFakeDb();
      await registerCredential(
        'uid-cas-replay',
        { credentialId: 'cred-cas-replay', publicKey: new Uint8Array([1]), counter: 10 },
        db,
      );
      await expect(
        compareAndSwapCounter('cred-cas-replay', 10, db),
      ).rejects.toThrow(/counter_not_monotonic/);
      await expect(
        compareAndSwapCounter('cred-cas-replay', 9, db),
      ).rejects.toThrow(/counter_not_monotonic/);
      await expect(
        compareAndSwapCounter('cred-cas-replay', 0, db),
      ).rejects.toThrow(/counter_not_monotonic/);
    });

    it('serializes two updates so the LATER (higher) counter always wins', async () => {
      // This test pins the SEQUENTIAL behavior the fakeDb enforces. The
      // real concurrency guarantee is exercised against the Firestore
      // emulator in the integration test suite (TODO: add when emulator
      // harness is wired for this module).
      const { db, store } = makeFakeDb();
      await registerCredential(
        'uid-cas-seq',
        { credentialId: 'cred-cas-seq', publicKey: new Uint8Array([1]), counter: 5 },
        db,
      );
      await compareAndSwapCounter('cred-cas-seq', 6, db);
      await compareAndSwapCounter('cred-cas-seq', 7, db);
      expect(store.get('cred-cas-seq')!.data.counter).toBe(7);
      // A REPLAY attempt after a higher value has landed must be rejected.
      await expect(
        compareAndSwapCounter('cred-cas-seq', 6, db),
      ).rejects.toThrow(/counter_not_monotonic/);
    });

    it('rejects negative counter (parity with updateCounter contract)', async () => {
      const { db } = makeFakeDb();
      await registerCredential(
        'uid-cas-neg',
        { credentialId: 'cred-cas-neg', publicKey: new Uint8Array([1]), counter: 0 },
        db,
      );
      await expect(
        compareAndSwapCounter('cred-cas-neg', -1, db),
      ).rejects.toThrow(/non-negative/);
    });
  });
});

describe('decodePublicKey', () => {
  it('round-trips bytes through base64', () => {
    const original = new Uint8Array([10, 20, 30, 40, 50]);
    const b64 = Buffer.from(original).toString('base64');
    const decoded = decodePublicKey(b64);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});

describe('deleteCredentialsByUid (anonymization cleanup)', () => {
  // [Hy3-audit] Resolves [Audit-2026-08-31] WebAuthn lifecycle —
  // anonymization deja credentials y challenges huérfanos. Without
  // this helper, the anonymizeUser.ts workflow can disable a Firebase
  // Auth account but leave every registered public-key credential
  // untouched in `webauthn_credentials/{credentialId}` — those rows
  // include the original uid, the public key, the counter, and the
  // lastUsedAt timestamp, so they would outlive the anonymized
  // account indefinitely and let a new tenant who recycled the uid
  // inherit the credentials.
  it('removes every credential whose uid matches, regardless of credentialId', async () => {
    const { db, store } = makeFakeDb();
    await registerCredential(...reg('uid-orphan', 'cred-A', db));
    await registerCredential(...reg('uid-orphan', 'cred-B', db));
    await registerCredential(...reg('uid-other', 'cred-9', db));

    const deleted = await deleteCredentialsByUid('uid-orphan', db);
    expect(deleted).toBe(2);

    expect(store.has('cred-A')).toBe(false);
    expect(store.has('cred-B')).toBe(false);
    expect(store.has('cred-9')).toBe(true);
  });

  it('returns 0 when the uid has no credentials', async () => {
    const { db } = makeFakeDb();
    await registerCredential(...reg('uid-real', 'cred-A', db));
    const deleted = await deleteCredentialsByUid('uid-nobody', db);
    expect(deleted).toBe(0);
  });

  it('rejects an empty uid', async () => {
    const { db } = makeFakeDb();
    await expect(deleteCredentialsByUid('', db)).rejects.toThrow(/uid is required/i);
  });

  it('is idempotent: a second call after the first is a no-op', async () => {
    const { db } = makeFakeDb();
    await registerCredential(...reg('uid-x', 'cred-A', db));
    const first = await deleteCredentialsByUid('uid-x', db);
    const second = await deleteCredentialsByUid('uid-x', db);
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});

// (uid, credential, db) tuple-shape that matches registerCredential's
// positional signature. Spreading a credential object would not satisfy
// the type and would fail with "uid is required" because the first
// positional argument is the uid string, not the credential record.
//
// The transports array is intentionally mutable (`['usb']` rather than
// `['usb'] as const`) so it matches the `RegisterCredentialInput.transports`
// type — the legacy contract pins `string[]`, not `readonly ["usb"]`.
function reg(uid: string, credentialId: string, db: MinimalCredentialsDb) {
  return [
    uid,
    {
      credentialId,
      // publicKey must be a Uint8Array (the contract pins bytes, not
      // base64). The legacy tests use a plain new Uint8Array([...])
      // and we mirror that shape.
      publicKey: new Uint8Array([1, 2, 3, 4, 5]),
      counter: 0,
      transports: ['usb'] as string[],
    },
    db,
  ] as [string, { credentialId: string; publicKey: Uint8Array; counter: number; transports: string[]; }, MinimalCredentialsDb];
}
