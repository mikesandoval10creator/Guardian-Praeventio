// Praeventio Guard — dteSigner unit tests.

import { describe, expect, it } from 'vitest';
import { generateDte } from './dteGenerator';
import { buildSignChallenge, verifyAndSignDte } from './dteSigner';
import { SiiAdapterError } from './siiAdapter';
import {
  registerCredential,
  type MinimalCredentialsDb,
} from '../auth/webauthnCredentialStore';

/** In-memory MinimalCredentialsDb fake — mirrors the test pattern in webauthnCredentialStore.test.ts. */
function buildFakeCredsDb(): MinimalCredentialsDb {
  const store = new Map<string, Record<string, unknown>>();
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  function getCol(name: string) {
    let m = collections.get(name);
    if (!m) {
      m = store; // single namespace is fine for these tests
      collections.set(name, m);
    }
    return m;
  }
  return {
    now: () => 1_700_000_000_000,
    collection(name: string) {
      const col = getCol(name);
      return {
        doc(id: string) {
          return {
            async get() {
              const data = col.get(id);
              return {
                exists: data !== undefined,
                id,
                data: () => data,
              };
            },
            async set(data: Record<string, unknown>) {
              col.set(id, data);
            },
            async update(patch: Record<string, unknown>) {
              const cur = col.get(id) ?? {};
              col.set(id, { ...cur, ...patch });
            },
          };
        },
        where(field: string, _op: '==', value: unknown) {
          return {
            async get() {
              const docs = Array.from(col.entries())
                .filter(([, v]) => v[field] === value)
                .map(([id, data]) => ({ id, data: () => data }));
              return { empty: docs.length === 0, docs };
            },
          };
        },
      };
    },
  };
}

const SAMPLE_ITEMS = [{ description: 'Servicio test', quantity: 1, unitPrice: 10000 }];

function buildSampleDte() {
  return generateDte({
    type: 33,
    receptorRut: '76.123.456-7',
    receptorRazonSocial: 'Cliente SpA',
    fecha: '2026-05-05',
    folio: 5001,
    items: SAMPLE_ITEMS,
  });
}

describe('buildSignChallenge', () => {
  it('produces a 32-byte challenge bound to the dteHash', () => {
    const dte = buildSampleDte();
    const ch = buildSignChallenge(dte.hash);
    expect(ch.challenge.byteLength).toBe(32);
    expect(typeof ch.challengeB64u).toBe('string');
    expect(ch.dteHash).toBe(dte.hash);
  });

  it('throws when dteHash missing', () => {
    expect(() => buildSignChallenge('')).toThrow(SiiAdapterError);
  });
});

describe('verifyAndSignDte', () => {
  const uid = 'user-abc';
  const credentialId = 'cred-test-1';

  async function seedCred(db: MinimalCredentialsDb) {
    await registerCredential(
      uid,
      {
        credentialId,
        publicKey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        counter: 0,
      },
      db,
    );
  }

  it('firma con passkey válida → returns signedXml + cert publicKey', async () => {
    const db = buildFakeCredsDb();
    await seedCred(db);
    const dte = buildSampleDte();
    const result = await verifyAndSignDte(
      {
        xml: dte.xml,
        dteHash: dte.hash,
        credentialId,
        uid,
        signature: 'c2lnLWZha2U=',
        authenticatorData: 'YXV0aC1kYXRh',
        clientDataJSON: 'Y2RqLWZha2U=',
      },
      db,
    );
    expect(result.signedXml).toContain('<Signature');
    expect(result.signedXml).toContain('SignatureValue');
    expect(result.signedXml).toContain('</DTE>');
    expect(result.certPublicKey).toBeTruthy();
    expect(result.credentialId).toBe(credentialId);
    expect(result.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('credential desconocido → throws unknown_credential', async () => {
    const db = buildFakeCredsDb();
    const dte = buildSampleDte();
    await expect(
      verifyAndSignDte(
        {
          xml: dte.xml,
          dteHash: dte.hash,
          credentialId: 'never-registered',
          uid,
          signature: 's',
          authenticatorData: 'a',
          clientDataJSON: 'c',
        },
        db,
      ),
    ).rejects.toThrow(/unknown_credential/);
  });

  it('credencial pertenece a otro uid → throws unknown_credential (anti-enum)', async () => {
    const db = buildFakeCredsDb();
    await seedCred(db);
    const dte = buildSampleDte();
    await expect(
      verifyAndSignDte(
        {
          xml: dte.xml,
          dteHash: dte.hash,
          credentialId,
          uid: 'someone-else',
          signature: 's',
          authenticatorData: 'a',
          clientDataJSON: 'c',
        },
        db,
      ),
    ).rejects.toThrow(/unknown_credential/);
  });

  it('hash mismatch → reject', async () => {
    const db = buildFakeCredsDb();
    await seedCred(db);
    const dte = buildSampleDte();
    await expect(
      verifyAndSignDte(
        {
          xml: dte.xml,
          dteHash: 'deadbeef'.repeat(8), // wrong hash
          credentialId,
          uid,
          signature: 's',
          authenticatorData: 'a',
          clientDataJSON: 'c',
        },
        db,
      ),
    ).rejects.toThrow(/dte_hash_mismatch/);
  });

  it('payload WebAuthn incompleto → throws', async () => {
    const db = buildFakeCredsDb();
    await seedCred(db);
    const dte = buildSampleDte();
    await expect(
      verifyAndSignDte(
        {
          xml: dte.xml,
          dteHash: dte.hash,
          credentialId,
          uid,
          signature: '',
          authenticatorData: 'a',
          clientDataJSON: 'c',
        },
        db,
      ),
    ).rejects.toThrow(/webauthn_payload_incomplete/);
  });
});
