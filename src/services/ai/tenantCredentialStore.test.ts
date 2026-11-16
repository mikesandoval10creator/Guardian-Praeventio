import { describe, it, expect, beforeEach } from 'vitest';
import {
  FirestoreTenantCredentialResolver,
  credentialPath,
  deleteTenantCredential,
  isValidTenantId,
  saveTenantCredential,
  type CredentialFirestoreDb,
  type TenantCredentialDoc,
} from './tenantCredentialStore.js';
import { inMemoryKmsAdapter } from '../security/kmsAdapter.js';

/**
 * Fake Firestore: a plain Map keyed by `path/docId`. It never talks to a
 * real Firestore, so the whole suite is hermetic (F0 in the feasibility plan).
 */
class FakeFirestore implements CredentialFirestoreDb {
  readonly docs = new Map<string, unknown>();

  collection(path: string) {
    // NOTE: close over `docs` and `key` explicitly — arrow functions inside
    // `doc()` would otherwise lose `this` binding to the returned object.
    const docs = this.docs;
    const key = `${path}/`;
    return {
      doc(id: string) {
        const k = `${key}${id}`;
        return {
          async get() {
            const data = docs.get(k);
            return {
              exists: data !== undefined,
              data: () => data,
            };
          },
          async set(data: unknown) {
            docs.set(k, data);
          },
          async delete() {
            docs.delete(k);
          },
        };
      },
    };
  }
}

const TENANT_A = 'tenant-alpha';
const TENANT_B = 'tenant-beta';

describe('tenant credential path', () => {
  it('is tenant-scoped', () => {
    expect(credentialPath(TENANT_A)).toBe(`tenants/${TENANT_A}/llm_credentials`);
  });
});

describe('isValidTenantId', () => {
  it('accepts a normal tenant id', () => {
    expect(isValidTenantId(TENANT_A)).toBe(true);
  });

  it('rejects an empty or non-string id', () => {
    expect(isValidTenantId('')).toBe(false);
    expect(isValidTenantId(null)).toBe(false);
    expect(isValidTenantId(undefined)).toBe(false);
    expect(isValidTenantId(42)).toBe(false);
  });

  it('rejects ids that could escape the tenant path', () => {
    expect(isValidTenantId('tenant/other')).toBe(false);
    expect(isValidTenantId('../escape')).toBe(false);
    expect(isValidTenantId('..')).toBe(false);
  });

  it('rejects absurdly long ids', () => {
    expect(isValidTenantId('x'.repeat(129))).toBe(false);
  });
});

describe('FirestoreTenantCredentialResolver', () => {
  let db: FakeFirestore;
  let resolver: FirestoreTenantCredentialResolver;

  beforeEach(() => {
    db = new FakeFirestore();
    resolver = new FirestoreTenantCredentialResolver(db, inMemoryKmsAdapter);
  });

  it('returns null when the tenant has no credential', async () => {
    expect(await resolver.resolve(TENANT_A, 'gemini')).toBeNull();
  });

  it('round-trips a credential through envelope encryption', async () => {
    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', 'super-secret-key');

    const resolved = await resolver.resolve(TENANT_A, 'gemini');
    expect(resolved).not.toBeNull();
    expect(resolved?.secret).toBe('super-secret-key');
    expect(resolved?.provider).toBe('gemini');
  });

  it('stores the credential ENCRYPTED, never in clear', async () => {
    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', 'super-secret-key');

    const raw = JSON.stringify([...db.docs.entries()]);
    expect(raw).not.toContain('super-secret-key');
  });

  it('persists non-secret provider settings in clear', async () => {
    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'selfhosted', 'tok', {
      baseUrl: 'http://llm.internal:8000/v1',
      model: 'mimo-7b',
    });

    const doc = db.docs.get(`${credentialPath(TENANT_A)}/selfhosted`) as TenantCredentialDoc;
    expect(doc.baseUrl).toBe('http://llm.internal:8000/v1');
    expect(doc.model).toBe('mimo-7b');

    const resolved = await resolver.resolve(TENANT_A, 'selfhosted');
    expect(resolved?.baseUrl).toBe('http://llm.internal:8000/v1');
    expect(resolved?.model).toBe('mimo-7b');
  });

  // ── the isolation guarantee ────────────────────────────────────────────
  it('NEVER returns tenant A credential to tenant B', async () => {
    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', 'key-of-A');

    const asB = await resolver.resolve(TENANT_B, 'gemini');
    expect(asB).toBeNull();

    const asA = await resolver.resolve(TENANT_A, 'gemini');
    expect(asA?.secret).toBe('key-of-A');
  });

  it('keeps providers isolated within the same tenant', async () => {
    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', 'gemini-key');

    const asSelfHosted = await resolver.resolve(TENANT_A, 'selfhosted');
    expect(asSelfHosted).toBeNull();
  });

  it('fails closed on an invalid tenant id instead of returning anything', async () => {
    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', 'key-of-A');

    expect(await resolver.resolve('', 'gemini')).toBeNull();
    expect(await resolver.resolve('../other', 'gemini')).toBeNull();
  });

  it('returns null for a malformed envelope rather than throwing', async () => {
    db.docs.set(`${credentialPath(TENANT_A)}/gemini`, {
      provider: 'gemini',
      envelope: { nonsense: true },
      updatedAt: new Date().toISOString(),
    });

    expect(await resolver.resolve(TENANT_A, 'gemini')).toBeNull();
  });

  it('surfaces a Firestore read failure instead of silently returning null', async () => {
    const brokenDb: CredentialFirestoreDb = {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw new Error('firestore unavailable');
          },
          set: async () => undefined,
          delete: async () => undefined,
        }),
      }),
    };
    const brokenResolver = new FirestoreTenantCredentialResolver(brokenDb, inMemoryKmsAdapter);

    await expect(brokenResolver.resolve(TENANT_A, 'gemini')).rejects.toThrow('firestore unavailable');
  });

  it('surfaces a decrypt failure instead of silently returning null', async () => {
    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', 'key-of-A');

    // Tamper with the ciphertext — GCM must reject it.
    const doc = db.docs.get(`${credentialPath(TENANT_A)}/gemini`) as TenantCredentialDoc;
    doc.envelope.ciphertext = Buffer.from('tampered').toString('base64');
    db.docs.set(`${credentialPath(TENANT_A)}/gemini`, doc);

    await expect(resolver.resolve(TENANT_A, 'gemini')).rejects.toThrow();
  });
});

describe('saveTenantCredential', () => {
  let db: FakeFirestore;

  beforeEach(() => {
    db = new FakeFirestore();
  });

  it('rejects an invalid tenant id', async () => {
    await expect(
      saveTenantCredential(db, inMemoryKmsAdapter, '', 'gemini', 'k'),
    ).rejects.toThrow('invalid_tenant_id');
  });

  it('rejects an empty credential', async () => {
    await expect(
      saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', '   '),
    ).rejects.toThrow('empty_credential');
  });
});

describe('deleteTenantCredential', () => {
  it('removes the credential', async () => {
    const db = new FakeFirestore();
    const resolver = new FirestoreTenantCredentialResolver(db, inMemoryKmsAdapter);

    await saveTenantCredential(db, inMemoryKmsAdapter, TENANT_A, 'gemini', 'k');
    expect(await resolver.resolve(TENANT_A, 'gemini')).not.toBeNull();

    await deleteTenantCredential(db, TENANT_A, 'gemini');
    expect(await resolver.resolve(TENANT_A, 'gemini')).toBeNull();
  });

  it('rejects an invalid tenant id', async () => {
    const db = new FakeFirestore();
    await expect(deleteTenantCredential(db, '../x', 'gemini')).rejects.toThrow('invalid_tenant_id');
  });
});
