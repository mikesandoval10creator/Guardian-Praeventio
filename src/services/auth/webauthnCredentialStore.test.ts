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
  updateCounter,
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
          };
        },
        where(field: string, op: '==', value: unknown) {
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
